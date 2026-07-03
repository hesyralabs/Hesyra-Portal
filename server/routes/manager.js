const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requirePermission } = require('../middleware/auth');
const { logAudit, AUDIT_ACTIONS } = require('../lib/auditLogger');
const paymentEngine = require('../lib/paymentEngine');
const config = require('../lib/config');
const { runMonthlyInvoicing } = require('../lib/strikeScheduler');

const router = express.Router();

// All manager routes require authentication. Individual routes add permission checks.
router.use(authenticate);

// ═══════════════════════════════════════════════════════════════
// CASE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ─── GET /api/manager/cases ────────────────────────────────────
// All cases in the system with full details (manager-level view)
router.get('/cases', requirePermission('cases.view_all'), async (req, res) => {
  try {
    const cases = await prisma.case.findMany({
      include: {
        doctor:          { select: { id: true, name: true, username: true, clinic: true } },
        assignedTech:    { select: { id: true, name: true, username: true } },
        assignedDesigner:{ select: { id: true, name: true, username: true } },
        timeline:        { orderBy: { createdAt: 'asc' } },
        supportTickets:  { where: { status: { not: 'closed' } } },
      },
      orderBy: [{ priorityFlag: 'desc' }, { createdAt: 'desc' }],
    });

    res.json(cases);
  } catch (err) {
    console.error('GET /manager/cases error:', err);
    res.status(500).json({ error: 'Failed to fetch cases' });
  }
});

// ─── PUT /api/manager/cases/:id/assign ─────────────────────────
// Assign technician and/or CAD designer to a case.
// IMPORTANT: Assigning a CAD designer auto-advances status to 'cad_assigned'
// if the case is still at 'submitted'. This is the handoff trigger.
router.put('/cases/:id/assign', requirePermission('cases.assign_tech'), async (req, res) => {
  try {
    const { techId, designerId } = req.body;
    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const updateData = {};
    const timelineEntries = [];

    if (techId !== undefined) {
      if (techId === null || techId === '') {
        const productionStatuses = ['design_approved', 'batched', 'printing', 'printed', 'finishing', 'post_processing', 'qa', 'ready_for_dispatch', 'packaged'];
        if (productionStatuses.includes(c.status)) {
          return res.status(400).json({ error: 'Cannot unassign technician — case is already in production' });
        }
        updateData.assignedTechId = null;
        updateData.tech = 'Unassigned';
        timelineEntries.push({ caseId: c.id, label: 'Technician unassigned' });
      } else {
        const tech = await prisma.user.findUnique({ where: { id: techId } });
        if (!tech || tech.role !== 'technician') {
          return res.status(400).json({ error: 'Invalid technician ID' });
        }
        updateData.assignedTechId = techId;
        updateData.tech = tech.name; // keep legacy display field in sync
        timelineEntries.push({ caseId: c.id, label: `Assigned to ${tech.name}` });
      }
    }

    if (designerId !== undefined) {
      if (designerId === null || designerId === '') {
        const cadStatuses = ['cad_assigned', 'design_ready', 'design_revision', 'blocked'];
        if (cadStatuses.includes(c.status)) {
          return res.status(400).json({ error: 'Cannot unassign designer — case is in CAD stage' });
        }
        if (c.assignedDesignerId) {
          const { incrementActiveCount } = require('../lib/assignmentEngine');
          incrementActiveCount(c.assignedDesignerId, -1).catch(() => {});
        }
        updateData.assignedDesignerId = null;
        updateData.claimedBy = null;
        updateData.claimedAt = null;
        updateData.assignmentMethod = null;
        timelineEntries.push({ caseId: c.id, label: 'Designer unassigned' });
      } else {
        const designer = await prisma.user.findUnique({ where: { id: designerId } });
        if (!designer || designer.role !== 'cad_designer') {
          return res.status(400).json({ error: 'Invalid CAD designer ID' });
        }

        const { incrementActiveCount } = require('../lib/assignmentEngine');

        // Decrement previous designer's count if we're reassigning
        if (c.assignedDesignerId && c.assignedDesignerId !== designerId) {
          incrementActiveCount(c.assignedDesignerId, -1).catch(() => {});
        }
        // Increment new designer's count (only if not same person)
        if (c.assignedDesignerId !== designerId) {
          incrementActiveCount(designerId, +1).catch(() => {});
        }

        updateData.assignedDesignerId = designerId;
        updateData.assignmentMethod = 'manager_assign';
        // Fix #6: set claim timestamps and clear pool so scheduler ignores it
        updateData.claimedAt = new Date();
        updateData.claimedBy = designerId;
        updateData.poolEnteredAt = null;
        timelineEntries.push({ caseId: c.id, label: `👤 Assigned to ${designer.name} by manager` });

        // ─── Auto-advance: submitted → cad_assigned ─────────────
        // When a designer is assigned, the case formally enters the CAD pipeline.
        // Without this, the designer sees the case but can't upload (status guard blocks it).
        if (['submitted', 'action_required'].includes(c.status)) {
          updateData.status = 'cad_assigned';
          timelineEntries.push({ caseId: c.id, label: '🔄 Status auto-advanced to CAD Assigned' });
        }
      }
    }

    await prisma.case.update({ where: { customId: req.params.id }, data: updateData });

    // Batch create timeline entries
    for (const entry of timelineEntries) {
      await prisma.timeline.create({ data: entry });
    }

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.id, newStatus: updateData.status || c.status });

    res.json({ success: true, newStatus: updateData.status || c.status });
  } catch (err) {
    console.error('PUT /manager/cases/:id/assign error:', err);
    res.status(500).json({ error: 'Failed to assign case' });
  }
});

// ─── PUT /api/manager/cases/:id/priority ───────────────────────
// Toggle priority flag on a case
router.put('/cases/:id/priority', requirePermission('cases.flag_priority'), async (req, res) => {
  try {
    const { priorityFlag } = req.body;
    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    await prisma.case.update({
      where: { customId: req.params.id },
      data: { priorityFlag: Boolean(priorityFlag) },
    });

    if (priorityFlag) {
      await prisma.timeline.create({
        data: { caseId: c.id, label: '⚡ Flagged as priority' },
      });
    }

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.id });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /manager/cases/:id/priority error:', err);
    res.status(500).json({ error: 'Failed to update priority flag' });
  }
});

// ─── PUT /api/manager/cases/:id/notes ──────────────────────────
// Add/update internal notes (never visible to clinic)
router.put('/cases/:id/notes', requirePermission('cases.internal_notes'), async (req, res) => {
  try {
    const { notes } = req.body;
    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: 'Notes cannot be empty' });
    }

    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    await prisma.case.update({
      where: { customId: req.params.id },
      data: { internalNotes: notes.trim() },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /manager/cases/:id/notes error:', err);
    res.status(500).json({ error: 'Failed to update notes' });
  }
});

// ─── PUT /api/manager/cases/:id/state ──────────────────────────
// Force-override a case state. Audit-logged. Reason is mandatory.
// GUARD: Cannot move to production statuses without proper assignment.
router.put('/cases/:id/state', requirePermission('cases.force_state'), async (req, res) => {
  try {
    const { newStatus, reason, timelineLabel } = req.body;

    if (!newStatus) return res.status(400).json({ error: 'newStatus is required' });
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'reason is mandatory for manual state overrides' });
    }

    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // ─── Assignment guards ────────────────────────────────────
    // Cannot enter CAD pipeline without a designer assigned
    const cadStatuses = ['cad_assigned', 'design_ready', 'design_revision', 'blocked'];
    if (cadStatuses.includes(newStatus) && !c.assignedDesignerId) {
      return res.status(400).json({
        error: 'Cannot move to CAD stage — assign a designer first',
      });
    }

    // Cannot enter production pipeline without a technician assigned
    const productionStatuses = ['design_approved', 'batched', 'printing', 'printed', 'finishing', 'post_processing', 'qa', 'ready_for_dispatch', 'packaged'];
    if (productionStatuses.includes(newStatus) && !c.assignedTechId) {
      return res.status(400).json({
        error: 'Cannot move to production stage — assign a technician first',
      });
    }

    await prisma.case.update({
      where: { customId: req.params.id },
      data: { status: newStatus },
    });

    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: timelineLabel || `Status overridden → ${newStatus}`,
        info: `Manager override. Reason: ${reason}`,
      },
    });

    // Immutable audit entry
    await logAudit({
      req,
      action:     AUDIT_ACTIONS.CASE_STATE_FORCE,
      entityType: 'case',
      entityId:   c.id,
      beforeState:{ status: c.status },
      afterState: { status: newStatus },
      reason,
    });

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.id, newStatus });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /manager/cases/:id/state error:', err);
    res.status(500).json({ error: 'Failed to override case state' });
  }
});

// ═══════════════════════════════════════════════════════════════
// WORKLOAD VIEW
// ═══════════════════════════════════════════════════════════════

// ─── GET /api/manager/workload ─────────────────────────────────
// Technician workload summary: how many cases assigned per tech
router.get('/workload', requirePermission('cases.view_all'), async (req, res) => {
  try {
    const technicians = await prisma.user.findMany({
      where: { role: 'technician', status: 'active' },
      select: {
        id: true, name: true, username: true,
        techCases: {
          where: {
            status: { notIn: ['completed', 'archived', 'cancelled'] },
          },
          select: { customId: true, status: true, priorityFlag: true, due: true, caseType: true },
        },
      },
    });

    const workload = technicians.map(t => ({
      id:           t.id,
      name:         t.name,
      username:     t.username,
      activeCases:  t.techCases.length,
      priorityCases:t.techCases.filter(c => c.priorityFlag).length,
      cases:        t.techCases,
    }));

    res.json(workload);
  } catch (err) {
    console.error('GET /manager/workload error:', err);
    res.status(500).json({ error: 'Failed to fetch workload' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SUPPORT TICKETS
// ═══════════════════════════════════════════════════════════════

// ─── GET /api/manager/tickets ──────────────────────────────────
router.get('/tickets', requirePermission('tickets.view_all'), async (req, res) => {
  try {
    const { status } = req.query;

    const tickets = await prisma.supportTicket.findMany({
      where: status ? { status } : {},
      include: {
        user:    { select: { id: true, name: true, email: true, role: true } },
        assignee:{ select: { id: true, name: true } },
        case:    { select: { customId: true, caseType: true, status: true } },
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    res.json(tickets);
  } catch (err) {
    console.error('GET /manager/tickets error:', err);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// ─── PUT /api/manager/tickets/:id ─────────────────────────────
// Respond, close, or escalate a ticket
router.put('/tickets/:id', requirePermission('tickets.respond'), async (req, res) => {
  try {
    const { status, resolution, escalatedToAdmin, priority, assignedTo } = req.body;
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const updateData = {};
    if (status)            updateData.status = status;
    if (resolution)        updateData.resolution = resolution;
    if (escalatedToAdmin !== undefined) updateData.escalatedToAdmin = Boolean(escalatedToAdmin);
    if (priority)          updateData.priority = priority;
    if (assignedTo)        updateData.assignedTo = assignedTo;

    if (escalatedToAdmin) {
      updateData.status = 'escalated';
      await logAudit({
        req,
        action:     AUDIT_ACTIONS.TICKET_ESCALATED,
        entityType: 'ticket',
        entityId:   ticket.id,
        beforeState:{ status: ticket.status },
        afterState: { status: 'escalated', escalatedToAdmin: true },
        reason:     resolution || 'Escalated by manager',
      });
    }

    await prisma.supportTicket.update({ where: { id: req.params.id }, data: updateData });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /manager/tickets/:id error:', err);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// ═══════════════════════════════════════════════════════════════
// WALLET VIEW (read-only for manager)
// ═══════════════════════════════════════════════════════════════

// ─── GET /api/manager/clinics/:userId/wallet ───────────────────
router.get('/clinics/:userId/wallet', requirePermission('wallet.view_any_clinic'), async (req, res) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { userId: req.params.userId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });

    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    // Manager gets read-only — balance and transaction history only
    res.json({
      balancePaise:     wallet.balancePaise,
      totalLoadedPaise: wallet.totalLoadedPaise,
      totalSpentPaise:  wallet.totalSpentPaise,
      transactions:     wallet.transactions,
      readOnly:         true,
    });
  } catch (err) {
    console.error('GET /manager/clinics/:userId/wallet error:', err);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// ─── GET /api/manager/clinics ──────────────────────────────────
// List all clinic accounts with trust tier (for manager oversight)
router.get('/clinics', requirePermission('wallet.view_any_clinic'), async (req, res) => {
  try {
    const clinics = await prisma.user.findMany({
      where: { role: 'clinic' },
      select: {
        id: true, name: true, email: true, username: true,
        clinic: true, status: true, strikeCount: true, trustLevel: true,
        joinDate: true,
        wallet: { select: { balancePaise: true } },
        cases: { where: { status: { notIn: ['archived', 'cancelled'] } }, select: { id: true } },
      },
      orderBy: { joinDate: 'desc' },
    });

    res.json(clinics);
  } catch (err) {
    console.error('GET /manager/clinics error:', err);
    res.status(500).json({ error: 'Failed to fetch clinics' });
  }
});

// ─── GET /api/manager/designers ────────────────────────────────
// List CAD designers and their current assignment load
router.get('/designers', requirePermission('cases.assign_designer'), async (req, res) => {
  try {
    const designers = await prisma.user.findMany({
      where: { role: 'cad_designer', status: 'active' },
      select: {
        id: true, name: true, username: true, lastActiveAt: true,
        designerCases: {
          where: { status: { notIn: ['completed', 'archived', 'cancelled'] } },
          select: { customId: true, status: true, due: true },
        },
      },
    });

    res.json(designers.map(d => ({
      ...d,
      activeCases: d.designerCases.length,
    })));
  } catch (err) {
    console.error('GET /manager/designers error:', err);
    res.status(500).json({ error: 'Failed to fetch designers' });
  }
});

// ─── PUT /api/manager/cases/:id/advance ────────────────────────
// Advance a case through the normal state machine (no force, no bypass).
// Manager uses this for standard pipeline moves like submitted→cad_assigned.
const VALID_TRANSITIONS = {
  draft:             ['submitted', 'cancelled'],
  submitted:         ['cad_assigned', 'action_required', 'cancelled'],
  action_required:   ['submitted', 'cancelled'],
  cad_assigned:      ['design_ready', 'blocked', 'cancelled'],
  blocked:           ['cad_assigned', 'cancelled'],
  design_ready:      ['design_approved', 'design_revision', 'cancelled'],
  design_revision:   ['design_ready', 'cancelled'],
  design_approved:   ['batched', 'post_processing', 'cancelled'],
  // Batch production
  batched:           ['printing', 'design_approved', 'cancelled'],
  printed:           ['finishing', 'cancelled'],
  finishing:         ['qa', 'cancelled'],
  // Legacy production
  post_processing:   ['qa', 'cad_assigned', 'cancelled'],
  qa:                ['ready_for_dispatch', 'post_processing', 'cancelled'],
  ready_for_dispatch:['packaged', 'payment_pending', 'cancelled'],
  payment_pending:   ['packaged', 'overdue', 'cancelled'],
  overdue:           ['packaged', 'payment_pending', 'cancelled'],
  packaged:          ['dispatched', 'cancelled'],
  dispatched:        ['completed', 'archived'],
  completed:         ['archived'],
  archived:          [],
  cancelled:         [],
  // legacy
  designing:         ['design_ready', 'blocked', 'action_required', 'cancelled'],
  pending_approval:  ['design_approved', 'design_revision', 'cancelled'],
  printing:          ['printed', 'qa', 'post_processing', 'cancelled'],
  shipped:           ['completed', 'archived'],
};

router.put('/cases/:id/advance', requirePermission('cases.advance_state'), async (req, res) => {
  try {
    const { newStatus, timelineLabel } = req.body;
    if (!newStatus) return res.status(400).json({ error: 'newStatus is required' });

    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    const allowed = VALID_TRANSITIONS[c.status] || [];
    if (!allowed.includes(newStatus)) {
      return res.status(400).json({
        error: `Invalid transition: ${c.status} → ${newStatus}`,
        allowed,
      });
    }

    // Cannot enter production pipeline without a technician assigned
    const productionStatuses = ['design_approved', 'batched', 'printing', 'printed', 'finishing', 'post_processing', 'qa', 'ready_for_dispatch', 'packaged'];
    if (productionStatuses.includes(newStatus) && !c.assignedTechId) {
      return res.status(400).json({
        error: 'Cannot move to production stage — a technician must be assigned first',
      });
    }

    await prisma.case.update({ where: { customId: req.params.id }, data: { status: newStatus } });

    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: timelineLabel || `Status → ${newStatus}`,
        info: `Advanced by manager`,
      },
    });

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.id, newStatus });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /manager/cases/:id/advance error:', err);
    res.status(500).json({ error: 'Failed to advance case' });
  }
});

// ─── PUT /api/manager/cases/:id/design-action ──────────────────
// Approve or request revision on a design_ready case.
// action: 'approve' | 'revise'
router.put('/cases/:id/design-action', requirePermission('cases.advance_state'), async (req, res) => {
  try {
    const { action, reason } = req.body;

    if (!['approve', 'revise'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "revise"' });
    }
    if (action === 'revise' && (!reason || !reason.trim())) {
      return res.status(400).json({ error: 'reason is required when requesting revision' });
    }

    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    if (c.status !== 'design_ready') {
      return res.status(400).json({ error: `Cannot review design from status '${c.status}'. Case must be in design_ready.` });
    }

    if (action === 'approve' && !c.assignedTechId) {
      return res.status(400).json({ error: 'Cannot approve design — a technician must be assigned to the case first' });
    }

    const newStatus = action === 'approve' ? 'design_approved' : 'design_revision';

    await prisma.case.update({
      where: { customId: req.params.id },
      data: {
        status: newStatus,
        ...(action === 'revise' ? { rejectionReason: reason.trim() } : { rejectionReason: null }),
      },
    });

    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: action === 'approve' ? '✅ Design Approved by Manager' : '↩️ Revision Requested by Manager',
        info:  action === 'revise' ? reason.trim() : undefined,
      },
    });

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.id, newStatus });

    res.json({ success: true, newStatus });
  } catch (err) {
    console.error('PUT /manager/cases/:id/design-action error:', err);
    res.status(500).json({ error: 'Failed to process design action' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CREDIT / BILLING TERM MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ─── PUT /api/manager/clinics/:id/billing ──────────────────────
// Grant or revoke net-30 credit terms for a clinic.
// Body: { billingMode, creditLimitPaise }
router.put('/clinics/:id/billing', requirePermission('wallet.view_any_clinic'), async (req, res) => {
  try {
    const { billingMode, creditLimitPaise } = req.body;

    if (!['prepaid', 'net_30'].includes(billingMode)) {
      return res.status(400).json({ error: 'billingMode must be "prepaid" or "net_30"' });
    }
    if (billingMode === 'net_30' && (!creditLimitPaise || creditLimitPaise <= 0)) {
      return res.status(400).json({ error: 'creditLimitPaise is required for net_30 billing' });
    }

    const clinic = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!clinic || clinic.role !== 'clinic') {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    // Safety guard: cannot grant credit to a striked or suspended clinic
    if (billingMode === 'net_30' && ['strike_1', 'strike_2', 'suspended', 'banned'].includes(clinic.trustLevel)) {
      return res.status(400).json({
        error: `Cannot grant credit terms to a clinic with trust level '${clinic.trustLevel}'. Resolve their account first.`,
      });
    }

    const updateData = {
      billingMode,
      creditLimitPaise: billingMode === 'net_30' ? creditLimitPaise : 0,
      creditApprovedBy: billingMode === 'net_30' ? req.user.id : null,
      creditApprovedAt: billingMode === 'net_30' ? new Date() : null,
    };

    await prisma.user.update({ where: { id: req.params.id }, data: updateData });

    // Audit log — credit grants must be traceable
    await logAudit({
      req,
      action: AUDIT_ACTIONS.CASE_STATE_FORCE, // Reusing closest audit action type
      entityType: 'user',
      entityId: clinic.id,
      beforeState: { billingMode: clinic.billingMode, creditLimitPaise: clinic.creditLimitPaise },
      afterState: { billingMode, creditLimitPaise: updateData.creditLimitPaise },
      reason: billingMode === 'net_30'
        ? `Credit terms granted: limit ₹${config.paiseToINR(creditLimitPaise)}`
        : 'Credit terms revoked — downgraded to prepaid',
    });

    const io = req.app.get('io');
    if (io) io.emit('clinic:billing_updated', { userId: clinic.id, billingMode });

    res.json({
      success: true,
      billingMode,
      creditLimitPaise: updateData.creditLimitPaise,
      creditLimitINR: config.paiseToINR(updateData.creditLimitPaise),
    });
  } catch (err) {
    console.error('PUT /manager/clinics/:id/billing error:', err);
    res.status(500).json({ error: 'Failed to update billing terms' });
  }
});

// ─── GET /api/manager/clinics/:id/credit ───────────────────────
// Live credit dashboard for a single clinic: outstanding, limit, recent invoices
router.get('/clinics/:id/credit', requirePermission('wallet.view_any_clinic'), async (req, res) => {
  try {
    const clinic = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, name: true, clinic: true,
        billingMode: true, creditLimitPaise: true, outstandingPaise: true,
        creditApprovedAt: true, creditApprovedBy: true, trustLevel: true,
      },
    });
    if (!clinic || (await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true } }))?.role !== 'clinic') {
      return res.status(404).json({ error: 'Clinic not found' });
    }

    // Recent monthly invoices
    const invoices = await prisma.invoice.findMany({
      where: { userId: req.params.id, invoiceType: 'monthly' },
      orderBy: { createdAt: 'desc' },
      take: 12, // Last 12 months
      select: {
        id: true, customId: true, amount: true, status: true,
        billingPeriod: true, dueDate: true, paidAt: true, createdAt: true,
      },
    });

    // Uninvoiced credit cases (current month's running tab)
    const pendingCases = await prisma.case.count({
      where: { doctorId: req.params.id, dispatchedOnCredit: true, creditInvoiceId: null },
    });

    res.json({
      ...clinic,
      creditLimitINR: config.paiseToINR(clinic.creditLimitPaise),
      outstandingINR: config.paiseToINR(clinic.outstandingPaise),
      utilizationPct: clinic.creditLimitPaise > 0
        ? Math.round((clinic.outstandingPaise / clinic.creditLimitPaise) * 100)
        : 0,
      pendingCasesThisMonth: pendingCases,
      invoices,
    });
  } catch (err) {
    console.error('GET /manager/clinics/:id/credit error:', err);
    res.status(500).json({ error: 'Failed to fetch credit info' });
  }
});

// ─── POST /api/manager/invoices/generate ───────────────────────
// Manually trigger monthly invoice generation for a billing period.
// Body: { billingPeriod } — e.g. "2026-05". Defaults to last month.
router.post('/invoices/generate', requirePermission('wallet.view_any_clinic'), async (req, res) => {
  try {
    const { billingPeriod } = req.body; // Optional — auto-defaults to last month in runMonthlyInvoicing
    const io = req.app.get('io');
    const result = await runMonthlyInvoicing(io, billingPeriod);

    res.json({
      success: true,
      invoicesGenerated: result.invoicesGenerated,
      billingPeriod: result.billingPeriod,
    });
  } catch (err) {
    console.error('POST /manager/invoices/generate error:', err);
    res.status(500).json({ error: 'Failed to generate invoices: ' + err.message });
  }
});

module.exports = router;
