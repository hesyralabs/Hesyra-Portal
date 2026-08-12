const express = require('express');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit, AUDIT_ACTIONS } = require('../lib/auditLogger');
const config = require('../lib/config');

const router = express.Router();
router.use(authenticate);

// ═══════════════════════════════════════════════════════════════
// AUTO-SEGMENTATION — Group ready-to-print cases by caseType → material
// This is the tech's primary inbox view.
// ═══════════════════════════════════════════════════════════════

// GET /api/batch/segments
// Returns cases at 'design_approved' grouped by caseType, then material.
router.get('/segments', requireRole('technician'), async (req, res) => {
  try {
    const cases = await prisma.case.findMany({
      where: { status: 'design_approved', printBatchId: null },
      include: {
        files: { where: { category: 'design' }, select: { id: true, filename: true, path: true, size: true } },
        doctor: { select: { name: true, clinic: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group: caseType → materialSkuId (or material name for legacy) → [cases]
    const segments = {};
    for (const c of cases) {
      const type = c.caseType || 'other';
      const matKey = c.material || 'unspecified';
      if (!segments[type]) segments[type] = {};
      if (!segments[type][matKey]) segments[type][matKey] = [];
      segments[type][matKey].push({
        id: c.customId,
        _dbId: c.id,
        patient: c.patient,
        material: c.material,
        materialSkuId: c.materialSkuId,
        shade: c.shade,
        due: c.due,
        clinic: c.doctor?.clinic || c.doctor?.name,
        priorityFlag: c.priorityFlag,
        finishingTier: c.finishingTier || 'standard',
        designFiles: c.files.map(f => ({
          id: f.id,
          name: f.filename,
          url: `/uploads/${path.basename(f.path)}`,
          size: f.size,
        })),
        createdAt: c.createdAt,
      });
    }

    res.json({ segments, totalCases: cases.length });
  } catch (err) {
    console.error('GET /batch/segments error:', err);
    res.status(500).json({ error: 'Failed to load segments' });
  }
});

// ═══════════════════════════════════════════════════════════════
// BATCH CRUD
// ═══════════════════════════════════════════════════════════════

// GET /api/batch — list all batches (with case counts)
router.get('/', requireRole('technician'), async (req, res) => {
  try {
    const batches = await prisma.printBatch.findMany({
      include: {
        cases: {
          select: {
            customId: true, status: true, patient: true,
            shade: true, assignedCeramistId: true, priorityFlag: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(batches.map(b => ({
      id: b.customId,
      _dbId: b.id,
      name: b.name,
      status: b.status,
      material: b.material,
      caseType: b.caseType,
      machine: b.machine,
      caseCount: b.cases.length,
      cases: b.cases,
      startedAt: b.startedAt,
      completedAt: b.completedAt,
      createdAt: b.createdAt,
    })));
  } catch (err) {
    console.error('GET /batch error:', err);
    res.status(500).json({ error: 'Failed to fetch batches' });
  }
});

// POST /api/batch — Create a batch from a segment (list of case IDs)
// Body: { caseIds: [...customIds], material, caseType, machine?, name? }
router.post('/', requireRole('technician'), async (req, res) => {
  try {
    const { caseIds, material, caseType, machine, name } = req.body;
    if (!caseIds || caseIds.length === 0) {
      return res.status(400).json({ error: 'No cases provided' });
    }

    // Verify all cases are at design_approved and not already batched
    const cases = await prisma.case.findMany({
      where: { customId: { in: caseIds }, status: 'design_approved', printBatchId: null },
    });
    if (cases.length !== caseIds.length) {
      return res.status(400).json({
        error: `Only ${cases.length} of ${caseIds.length} cases are eligible for batching (must be at design_approved and not already batched).`,
      });
    }

    // Generate batch ID: PB-YYMM-XXX
    const now = new Date();
    const prefix = `PB-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const existing = await prisma.printBatch.count({ where: { customId: { startsWith: prefix } } });
    const batchId = `${prefix}-${String(existing + 1).padStart(3, '0')}`;

    const batch = await prisma.$transaction(async (tx) => {
      const b = await tx.printBatch.create({
        data: {
          customId: batchId,
          name: name || `${caseType || ''} ${material || ''} Batch`.trim(),
          status: 'preparing',
          material: material || null,
          caseType: caseType || null,
          machine: machine || null,
          createdBy: req.user.id,
        },
      });

      // Move all cases to 'batched' and link to this batch
      await tx.case.updateMany({
        where: { id: { in: cases.map(c => c.id) } },
        data: { printBatchId: b.id, status: 'batched' },
      });

      // Timeline entries
      const entries = cases.map(c => ({
        caseId: c.id,
        label: `📦 Added to Print Batch ${batchId}`,
        info: `Material: ${material || '—'} · Machine: ${machine || 'TBD'}`,
      }));
      await tx.timeline.createMany({ data: entries });

      return b;
    });

    const io = req.app.get('io');
    if (io) io.emit('batch:created', { batchId, caseCount: cases.length });

    res.json({ success: true, batchId, caseCount: cases.length });
  } catch (err) {
    console.error('POST /batch error:', err);
    res.status(500).json({ error: 'Failed to create batch' });
  }
});

// PUT /api/batch/:id/start — Start printing a batch
router.put('/:id/start', requireRole('technician'), async (req, res) => {
  try {
    const batch = await prisma.printBatch.findUnique({
      where: { customId: req.params.id },
      include: { cases: true },
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (batch.status !== 'preparing') {
      return res.status(400).json({ error: `Cannot start batch in '${batch.status}' status` });
    }

    await prisma.$transaction(async (tx) => {
      await tx.printBatch.update({
        where: { id: batch.id },
        data: { status: 'printing', startedAt: new Date(), machine: req.body.machine || batch.machine },
      });

      await tx.case.updateMany({
        where: { printBatchId: batch.id },
        data: { status: 'printing' },
      });

      const entries = batch.cases.map(c => ({
        caseId: c.id,
        label: '🖨️ Print started',
        info: `Batch ${batch.customId} · Machine: ${req.body.machine || batch.machine || '—'}`,
      }));
      await tx.timeline.createMany({ data: entries });
    });

    const io = req.app.get('io');
    if (io) io.emit('batch:started', { batchId: batch.customId });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /batch/:id/start error:', err);
    res.status(500).json({ error: 'Failed to start batch' });
  }
});

// PUT /api/batch/:id/complete — Print done, cases ready for ceramist assignment
router.put('/:id/complete', requireRole('technician'), async (req, res) => {
  try {
    const batch = await prisma.printBatch.findUnique({
      where: { customId: req.params.id },
      include: { cases: true },
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (batch.status !== 'printing') {
      return res.status(400).json({ error: `Cannot complete batch in '${batch.status}' status` });
    }

    // Split by what the appliance is made of, not by which upsell was
    // bought. See CERAMIC_FINISHING_CASE_TYPES in lib/config.
    const ceramicTypes = config.CERAMIC_FINISHING_CASE_TYPES || [];
    const needsFinishing = batch.cases.filter(c => ceramicTypes.includes(c.caseType));
    const straightToQc   = batch.cases.filter(c => !ceramicTypes.includes(c.caseType));

    // Pick the ceramist with the lightest bench so the work actually
    // moves. Parking cases on `printed` and waiting for someone to
    // remember to assign them is how they went missing: nothing in the
    // portal surfaced a case in that state, and the ceramist's queue
    // only ever shows `finishing`.
    let assignee = null;
    if (needsFinishing.length) {
      const ceramists = await prisma.user.findMany({
        where: { role: 'ceramist', status: 'active' },
        select: { id: true, name: true, username: true },
      });
      if (ceramists.length) {
        const loads = await prisma.case.groupBy({
          by: ['assignedCeramistId'],
          where: { status: 'finishing', assignedCeramistId: { in: ceramists.map(c => c.id) } },
          _count: true,
        });
        const loadById = Object.fromEntries(loads.map(l => [l.assignedCeramistId, l._count]));
        assignee = ceramists.reduce((best, c) =>
          (loadById[c.id] || 0) < (loadById[best.id] || 0) ? c : best, ceramists[0]);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.printBatch.update({
        where: { id: batch.id },
        // Nothing left to assign by hand once the bench is allocated.
        data: { status: assignee ? 'completed' : 'printed', completedAt: new Date() },
      });

      if (straightToQc.length) {
        await tx.case.updateMany({
          where: { id: { in: straightToQc.map(c => c.id) } },
          data: { status: 'qa' },
        });
      }

      if (needsFinishing.length) {
        await tx.case.updateMany({
          where: { id: { in: needsFinishing.map(c => c.id) } },
          data: assignee
            ? { status: 'finishing', assignedCeramistId: assignee.id }
            : { status: 'printed' },   // no ceramist on staff — see below
        });
      }

      const who = assignee ? `${assignee.name} (${assignee.username})` : null;
      const entries = [
        ...straightToQc.map(c => ({
          caseId: c.id,
          label: '✅ Print complete — sent to QC',
          info: 'No ceramic finishing stage for this appliance.',
        })),
        ...needsFinishing.map(c => ({
          caseId: c.id,
          label: who
            ? `🎨 Print complete — assigned to ${who} for finishing`
            : '⚠️ Print complete — waiting for a ceramist',
          info: who
            ? (c.finishingTier === 'premium'
                ? 'Signature Match: hand-stained characterisation.'
                : 'Studio finish: glaze and polish.')
            : 'No active ceramist account. Assign one from the print floor to release this case.',
        })),
      ];
      await tx.timeline.createMany({ data: entries });
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('batch:completed', { batchId: batch.customId });
      if (assignee) io.emit('ceramist:assigned', { ceramistId: assignee.id, count: needsFinishing.length });
    }

    res.json({
      success: true,
      toFinishing: needsFinishing.length,
      toQc: straightToQc.length,
      assignedTo: assignee ? assignee.name : null,
      // True only in the edge case where the lab has no active ceramist.
      awaitingCeramist: !assignee && needsFinishing.length > 0,
    });
  } catch (err) {
    console.error('PUT /batch/:id/complete error:', err);
    res.status(500).json({ error: 'Failed to complete batch' });
  }
});

// PUT /api/batch/:id/assign-ceramists — Assign ceramists to cases after printing
// Body: { assignments: [{ caseCustomId, ceramistId }] } OR { ceramistId } for bulk assign all
router.put('/:id/assign-ceramists', requireRole('technician'), async (req, res) => {
  try {
    const batch = await prisma.printBatch.findUnique({
      where: { customId: req.params.id },
      include: { cases: true },
    });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (!['printed', 'completed'].includes(batch.status)) {
      return res.status(400).json({ error: 'Batch must be printed first' });
    }

    const { assignments, ceramistId } = req.body;

    if (ceramistId) {
      // Bulk assign all cases in batch to one ceramist
      const ceramist = await prisma.user.findUnique({ where: { id: ceramistId } });
      if (!ceramist || ceramist.role !== 'ceramist') {
        return res.status(400).json({ error: 'Invalid ceramist ID' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.case.updateMany({
          where: { printBatchId: batch.id, status: 'printed' },
          data: { assignedCeramistId: ceramistId, status: 'finishing' },
        });

        const entries = batch.cases.filter(c => c.status === 'printed').map(c => ({
          caseId: c.id,
          label: `🎨 Assigned to ceramist: ${ceramist.name}`,
        }));
        await tx.timeline.createMany({ data: entries });

        await tx.printBatch.update({ where: { id: batch.id }, data: { status: 'completed' } });
      });
    } else if (assignments && Array.isArray(assignments)) {
      // Individual assignments
      for (const a of assignments) {
        const caseRecord = batch.cases.find(c => c.customId === a.caseCustomId);
        if (!caseRecord) continue;

        const ceramist = await prisma.user.findUnique({ where: { id: a.ceramistId } });
        if (!ceramist || ceramist.role !== 'ceramist') continue;

        await prisma.case.update({
          where: { id: caseRecord.id },
          data: { assignedCeramistId: a.ceramistId, status: 'finishing' },
        });
        await prisma.timeline.create({
          data: { caseId: caseRecord.id, label: `🎨 Assigned to ceramist: ${ceramist.name}` },
        });
      }

      // If all cases are now assigned, mark batch as completed
      const remaining = await prisma.case.count({
        where: { printBatchId: batch.id, status: 'printed' },
      });
      if (remaining === 0) {
        await prisma.printBatch.update({ where: { id: batch.id }, data: { status: 'completed' } });
      }
    }

    const io = req.app.get('io');
    if (io) io.emit('batch:ceramists_assigned', { batchId: batch.customId });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /batch/:id/assign-ceramists error:', err);
    res.status(500).json({ error: 'Failed to assign ceramists' });
  }
});

// PUT /api/batch/:id/remove-case — Remove a case from a batch (back to design_approved)
router.put('/:id/remove-case', requireRole('technician'), async (req, res) => {
  try {
    const { caseCustomId } = req.body;
    const batch = await prisma.printBatch.findUnique({ where: { customId: req.params.id } });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (batch.status !== 'preparing') {
      return res.status(400).json({ error: 'Can only remove cases from batches in preparing status' });
    }

    const c = await prisma.case.findUnique({ where: { customId: caseCustomId } });
    if (!c || c.printBatchId !== batch.id) {
      return res.status(404).json({ error: 'Case not in this batch' });
    }

    await prisma.case.update({
      where: { id: c.id },
      data: { printBatchId: null, status: 'design_approved' },
    });
    await prisma.timeline.create({
      data: { caseId: c.id, label: `↩ Removed from batch ${batch.customId}` },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /batch/:id/remove-case error:', err);
    res.status(500).json({ error: 'Failed to remove case' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CERAMIST ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// GET /api/batch/ceramist/queue — Cases assigned to the logged-in ceramist
router.get('/ceramist/queue', requireRole('ceramist'), async (req, res) => {
  try {
    const cases = await prisma.case.findMany({
      where: { assignedCeramistId: req.user.id, status: 'finishing' },
      include: {
        files: { where: { category: 'design' }, select: { id: true, filename: true, path: true, size: true } },
        doctor: { select: { name: true, clinic: true } },
        timeline: { orderBy: { createdAt: 'desc' }, take: 5 },
        messages: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
      orderBy: [{ priorityFlag: 'desc' }, { createdAt: 'asc' }],
    });

    res.json(cases.map(c => ({
      id: c.customId,
      _dbId: c.id,
      patient: c.patient,
      caseType: c.caseType,
      type: c.type,
      material: c.material,
      shade: c.shade,
      due: c.due,
      instructions: c.instructions,
      priorityFlag: c.priorityFlag,
      finishingTier: c.finishingTier || 'standard',
      referencePhotoUrl: c.referencePhotoUrl,
      clinic: c.doctor?.clinic || c.doctor?.name,
      designFiles: c.files.map(f => ({
        id: f.id,
        name: f.filename,
        url: `/uploads/${path.basename(f.path)}`,
        size: f.size,
      })),
      timeline: c.timeline.map(t => ({ label: t.label, time: t.createdAt })),
      messages: c.messages.map(m => ({ from: m.from, text: m.text, time: m.createdAt })),
      createdAt: c.createdAt,
    })));
  } catch (err) {
    console.error('GET /batch/ceramist/queue error:', err);
    res.status(500).json({ error: 'Failed to load ceramist queue' });
  }
});

// PUT /api/batch/ceramist/complete/:caseCustomId — Ceramist marks finishing complete → qa
router.put('/ceramist/complete/:caseCustomId', requireRole('ceramist'), async (req, res) => {
  try {
    const c = await prisma.case.findUnique({ where: { customId: req.params.caseCustomId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (c.assignedCeramistId !== req.user.id) {
      return res.status(403).json({ error: 'This case is not assigned to you' });
    }
    if (c.status !== 'finishing') {
      return res.status(400).json({ error: 'Case is not in finishing status' });
    }

    // The JWT carries id, role and email but no display name, so this
    // wrote "Ceramist: undefined" onto the case timeline.
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { name: true, username: true },
    });
    const whoAmI = me?.name
      ? `${me.name}${me.username ? ` (${me.username})` : ''}`
      : req.user.email || 'ceramist';

    await prisma.case.update({
      where: { id: c.id },
      data: { status: 'qa' },
    });
    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: `🎨 Finishing complete — sent to QC`,
        info: `Ceramist: ${whoAmI}`,
      },
    });

    // Finishing is a production handoff that was leaving no audit row:
    // this route bypasses PUT /cases/:id/status, so the case moved
    // bench-to-bench with nothing recording who released it.
    await logAudit({
      req,
      action:     AUDIT_ACTIONS.CASE_STATUS_CHANGE,
      entityType: 'case',
      entityId:   c.id,
      beforeState:{ status: 'finishing' },
      afterState: { status: 'qa' },
      reason:     `Ceramic finishing completed by ${whoAmI}`,
      metadata:   { customId: c.customId, finishingTier: c.finishingTier },
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('case:updated', { customId: c.customId, newStatus: 'qa' });
    }

    res.json({ success: true, newStatus: 'qa' });
  } catch (err) {
    console.error('PUT /batch/ceramist/complete error:', err);
    res.status(500).json({ error: 'Failed to complete finishing' });
  }
});

// GET /api/batch/ceramist/completed — What this ceramist has finished
// Once a case leaves `finishing` it vanished from the only screen a
// ceramist had, so there was no way to confirm a piece was released, or
// to look up what was done last week when QC sends something back.
router.get('/ceramist/completed', requireRole('ceramist'), async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 180);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const cases = await prisma.case.findMany({
      where: {
        assignedCeramistId: req.user.id,
        status: { not: 'finishing' },   // anything past this bench
        updatedAt: { gte: since },
      },
      include: {
        doctor: { select: { name: true, clinic: true } },
        // The handoff entry this ceramist wrote when releasing it.
        timeline: {
          where: { label: { contains: 'Finishing complete' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });

    res.json(cases.map(c => ({
      id: c.customId,
      patient: c.patient,
      caseType: c.caseType,
      type: c.type,
      material: c.material,
      shade: c.shade,
      finishingTier: c.finishingTier || 'standard',
      priorityFlag: c.priorityFlag,
      clinic: c.doctor?.clinic || c.doctor?.name,
      status: c.status,
      // Null when the case was moved on by someone else rather than
      // released from this bench — worth being able to tell apart.
      finishedAt: c.timeline[0]?.createdAt || null,
      dispatchedAt: c.dispatchedAt,
    })));
  } catch (err) {
    console.error('GET /batch/ceramist/completed error:', err);
    res.status(500).json({ error: 'Failed to load completed work' });
  }
});

// GET /api/batch/ceramists — List all ceramist users (for assignment dropdowns)
router.get('/ceramists', requireRole('technician'), async (req, res) => {
  try {
    const ceramists = await prisma.user.findMany({
      where: { role: 'ceramist', status: 'active' },
      select: { id: true, name: true, customId: true },
    });
    res.json(ceramists);
  } catch (err) {
    console.error('GET /batch/ceramists error:', err);
    res.status(500).json({ error: 'Failed to fetch ceramists' });
  }
});

module.exports = router;
