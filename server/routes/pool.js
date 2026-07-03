// ═══════════════════════════════════════════════════════════════════
// Open Case Pool — /api/pool
//
// Designers browse unclaimed 'submitted' cases and self-select.
// Cases enter the pool as soon as they are submitted.
// After 1 hour unclaimed the scheduler handles auto-assignment.
//
// Routes:
//   GET  /api/pool/cases                — list open pool
//   PUT  /api/pool/cases/:id/claim      — claim a case (atomic)
//   PUT  /api/pool/cases/:id/unclaim    — return to pool (within 15 min)
//   GET  /api/pool/stats                — pool summary (for manager dashboard)
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { incrementActiveCount, MAX_ACTIVE_CASES } = require('../lib/assignmentEngine');

const router = express.Router();

// ─── Max unclaim window ──────────────────────────────────────────
const UNCLAIM_WINDOW_MINUTES = 15;

// ─── Blind pool case data for designers ─────────────────────────
// IMPORTANT: Patient name, clinic, doctor, and financials are NEVER
// exposed in the pool — same blinding rules as cad_designer role.
function blindPoolCase(c) {
  let toothNumbers = [];
  try { toothNumbers = JSON.parse(c.toothNumbers || '[]'); } catch {}

  const age = c.poolEnteredAt
    ? Math.floor((Date.now() - new Date(c.poolEnteredAt).getTime()) / 60000)
    : null;

  const timeoutMinutes = 60;
  const minutesLeft = age !== null ? Math.max(0, timeoutMinutes - age) : null;

  return {
    id: c.customId,
    _dbId: c.id,
    caseType: c.caseType,
    type: c.type,
    due: c.due,
    priorityFlag: c.priorityFlag,
    shade: c.shade,
    toothNumbers,
    archTarget: c.archTarget,
    implantSystem: c.implantSystem,
    instructions: c.instructions,
    // File counts only — no URLs or filenames visible in pool
    scanFileCount: (c.files || []).filter(f => f.category === 'scan').length,
    poolEnteredAt: c.poolEnteredAt,
    minutesInPool: age,
    minutesLeft,
    isUrgent: age !== null && age >= 45, // Warn designer: 15 min left before auto-assign
    createdAt: c.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/pool/cases — Open pool listing (cad_designer only)
// ═══════════════════════════════════════════════════════════════════
router.get('/cases', authenticate, requireRole('cad_designer'), async (req, res) => {
  try {
    const cases = await prisma.case.findMany({
      where: {
        status: 'submitted',
        poolEnteredAt: { not: null },
        assignedDesignerId: null,
      },
      include: {
        files: { select: { id: true, category: true } },
      },
      orderBy: [
        { priorityFlag: 'desc' },
        { poolEnteredAt: 'asc' }, // Oldest first — FIFO fairness
      ],
    });

    res.json(cases.map(blindPoolCase));
  } catch (err) {
    console.error('GET /pool/cases error:', err);
    res.status(500).json({ error: 'Failed to fetch open pool' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pool/cases/:id/claim — Atomic claim (cad_designer only)
// ═══════════════════════════════════════════════════════════════════
router.put('/cases/:id/claim', authenticate, requireRole('cad_designer'), async (req, res) => {
  try {
    const designerId = req.user.id;

    // ─── 1. Check designer's current active load ──────────────
    const activeCount = await prisma.case.count({
      where: {
        assignedDesignerId: designerId,
        status: { in: ['cad_assigned', 'design_ready', 'design_revision', 'blocked', 'designing'] },
      },
    });

    if (activeCount >= MAX_ACTIVE_CASES) {
      return res.status(429).json({
        error: `You have reached the maximum active case limit (${MAX_ACTIVE_CASES}). Complete some cases before claiming new ones.`,
        activeCount,
        limit: MAX_ACTIVE_CASES,
      });
    }

    // ─── 2. Find the case — must still be unassigned in pool ──
    const c = await prisma.case.findUnique({
      where: { customId: req.params.id },
    });

    if (!c) return res.status(404).json({ error: 'Case not found' });

    if (c.status !== 'submitted') {
      return res.status(409).json({
        error: `Case is no longer available (status: ${c.status}). Another designer may have claimed it.`,
      });
    }

    if (c.assignedDesignerId) {
      return res.status(409).json({
        error: 'This case has already been claimed by another designer.',
      });
    }

    if (!c.poolEnteredAt) {
      return res.status(400).json({ error: 'This case is not in the open pool.' });
    }

    // ─── 3. Atomic assignment ─────────────────────────────────
    // Use updateMany with a WHERE guard to prevent race conditions:
    // Only succeeds if assignedDesignerId is STILL null at update time.
    const result = await prisma.case.updateMany({
      where: {
        id: c.id,
        assignedDesignerId: null,  // ← Atomic guard: fail if already claimed
        status: 'submitted',
      },
      data: {
        assignedDesignerId: designerId,
        status: 'cad_assigned',
        claimedAt: new Date(),
        claimedBy: designerId,
        assignmentMethod: 'self_select',
      },
    });

    // If count = 0, someone else won the race
    if (result.count === 0) {
      return res.status(409).json({
        error: 'This case was just claimed by another designer. Please pick a different one.',
      });
    }

    // ─── 4. Timeline entry ────────────────────────────────────
    const designer = await prisma.user.findUnique({ where: { id: designerId }, select: { name: true } });
    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: `🎯 Self-selected by ${designer?.name || 'Designer'}`,
        info: 'Designer chose this case from the open pool.',
      },
    });

    // ─── 5. Update workload count ─────────────────────────────
    await incrementActiveCount(designerId, +1);

    // ─── 6. Socket events ─────────────────────────────────────
    const io = req.app.get('io');
    if (io) {
      // Remove from every other designer's pool view
      io.emit('pool:case_claimed', { customId: c.customId, designerId });
      // Update the case list for manager
      io.emit('case:updated', { customId: c.customId, newStatus: 'cad_assigned' });
    }

    // Fix #19: Audit log for self-claim event
    try {
      await prisma.auditLog.create({
        data: {
          actorId:    designerId,
          actorRole:  'cad_designer',
          action:     'POOL_SELF_CLAIM',
          entityType: 'case',
          entityId:   c.id,
          beforeState: JSON.stringify({ status: 'submitted', assignedDesignerId: null }),
          afterState:  JSON.stringify({ status: 'cad_assigned', assignedDesignerId: designerId }),
          reason: 'Designer self-selected from open pool.',
        },
      });
    } catch { /* audit log failures never block operations */ }

    res.json({
      success: true,
      customId: c.customId,
      newStatus: 'cad_assigned',
      assignmentMethod: 'self_select',
    });
  } catch (err) {
    console.error('PUT /pool/cases/:id/claim error:', err);
    res.status(500).json({ error: 'Failed to claim case' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pool/cases/:id/unclaim — Return to pool (within 15 min)
// ═══════════════════════════════════════════════════════════════════
router.put('/cases/:id/unclaim', authenticate, requireRole('cad_designer'), async (req, res) => {
  try {
    const designerId = req.user.id;
    const { reason } = req.body;

    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Ownership check
    if (c.assignedDesignerId !== designerId) {
      return res.status(403).json({ error: 'You can only unclaim your own cases.' });
    }

    // Only self-selected cases can be unclaimed (not auto-assigned or manager-assigned)
    if (c.assignmentMethod !== 'self_select') {
      return res.status(400).json({
        error: 'Only self-selected cases can be returned to the pool. Contact the manager to reassign auto-assigned cases.',
      });
    }

    // Status must still be cad_assigned (no work started)
    if (c.status !== 'cad_assigned') {
      return res.status(400).json({
        error: `Cannot unclaim a case in status '${c.status}'. Once you upload files, you must complete the case.`,
      });
    }

    // 15-minute unclaim window
    if (c.claimedAt) {
      const minutesSinceClaim = (Date.now() - new Date(c.claimedAt).getTime()) / 60000;
      if (minutesSinceClaim > UNCLAIM_WINDOW_MINUTES) {
        return res.status(400).json({
          error: `The ${UNCLAIM_WINDOW_MINUTES}-minute unclaim window has expired. Contact the manager if you cannot work this case.`,
          minutesSinceClaim: Math.floor(minutesSinceClaim),
        });
      }
    }

    // Return to pool
    await prisma.case.update({
      where: { id: c.id },
      data: {
        assignedDesignerId: null,
        status: 'submitted',
        claimedAt: null,
        claimedBy: null,
        assignmentMethod: null,
        // Keep poolEnteredAt — reset its timer so it gets another 1-hour window
        poolEnteredAt: new Date(),
      },
    });

    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: '↩️ Returned to open pool by designer',
        info: reason?.trim() || 'Designer returned case to the pool.',
      },
    });

    // Update workload count
    await incrementActiveCount(designerId, -1);

    const io = req.app.get('io');
    if (io) {
      io.emit('pool:case_returned', { customId: c.customId });
      io.emit('case:updated', { customId: c.customId, newStatus: 'submitted' });
    }

    // Fix #19: Audit log for unclaim event
    try {
      await prisma.auditLog.create({
        data: {
          actorId:    designerId,
          actorRole:  'cad_designer',
          action:     'POOL_UNCLAIM',
          entityType: 'case',
          entityId:   c.id,
          beforeState: JSON.stringify({ status: 'cad_assigned', assignedDesignerId: designerId }),
          afterState:  JSON.stringify({ status: 'submitted', assignedDesignerId: null }),
          reason: reason?.trim() || 'Designer returned case to pool.',
        },
      });
    } catch { /* silent */ }

    res.json({ success: true, message: 'Case returned to the open pool.' });
  } catch (err) {
    console.error('PUT /pool/cases/:id/unclaim error:', err);
    res.status(500).json({ error: 'Failed to unclaim case' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/pool/stats — Pool summary for manager dashboard
// Fix #4: Use requireRole middleware consistently (not a manual check)
// ═══════════════════════════════════════════════════════════════════
router.get('/stats', authenticate, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const fortyFiveMinAgo = new Date(now.getTime() - 45 * 60 * 1000);

    const poolCases = await prisma.case.findMany({
      where: {
        status: 'submitted',
        poolEnteredAt: { not: null },
        assignedDesignerId: null,
      },
      select: { customId: true, caseType: true, poolEnteredAt: true, priorityFlag: true },
    });

    // Overdue = in pool > 1 hour (auto-assign should have fired but didn't)
    const overdue = poolCases.filter(c => new Date(c.poolEnteredAt) < oneHourAgo);
    // Urgent = in pool between 45 min and 1 hour
    const urgent = poolCases.filter(c => {
      const entered = new Date(c.poolEnteredAt);
      return entered >= oneHourAgo && entered < fortyFiveMinAgo;
    });

    res.json({
      totalInPool: poolCases.length,
      urgentCount: urgent.length,      // Approaching auto-assign threshold
      overdueCount: overdue.length,    // Should have been auto-assigned — edge case
      cases: poolCases.map(c => ({
        id: c.customId,
        caseType: c.caseType,
        priorityFlag: c.priorityFlag,
        minutesInPool: Math.floor((now - new Date(c.poolEnteredAt)) / 60000),
      })),
    });
  } catch (err) {
    console.error('GET /pool/stats error:', err);
    res.status(500).json({ error: 'Failed to fetch pool stats' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/pool/cases/:id/return-to-pool — Manager force-return
// Fix #8: Managers can return any assigned case to the open pool
// (e.g. if auto-assignment picked the wrong designer, or designer is OOO)
// ═══════════════════════════════════════════════════════════════════
router.put('/cases/:id/return-to-pool', authenticate, requireRole('manager', 'admin'), async (req, res) => {
  try {
    const { reason } = req.body;

    const c = await prisma.case.findUnique({ where: { customId: req.params.id } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Can only return cases that are in the CAD pipeline (before any design work)
    const returnableStatuses = ['cad_assigned', 'submitted'];
    if (!returnableStatuses.includes(c.status)) {
      return res.status(400).json({
        error: `Cannot return a case in status '${c.status}' to the pool. Design work may have already started.`,
      });
    }

    const previousDesigner = c.assignedDesignerId;

    // Return to pool — fresh 1-hour window
    await prisma.case.update({
      where: { id: c.id },
      data: {
        assignedDesignerId: null,
        status: 'submitted',
        claimedAt: null,
        claimedBy: null,
        assignmentMethod: null,
        poolEnteredAt: new Date(), // Fresh 1-hour window
      },
    });

    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: '↩️ Returned to open pool by manager',
        info: reason?.trim() || 'Manager returned case to the pool for reassignment.',
      },
    });

    // Decrement previous designer's active count
    if (previousDesigner) {
      await incrementActiveCount(previousDesigner, -1);
    }

    const io = req.app.get('io');
    if (io) {
      io.emit('pool:case_returned', { customId: c.customId });
      io.emit('pool:new_case', { customId: c.customId, caseType: c.caseType });
      io.emit('case:updated', { customId: c.customId, newStatus: 'submitted' });
    }

    res.json({ success: true, message: `Case ${c.customId} returned to the open pool.` });
  } catch (err) {
    console.error('PUT /pool/cases/:id/return-to-pool error:', err);
    res.status(500).json({ error: 'Failed to return case to pool' });
  }
});

module.exports = router;
