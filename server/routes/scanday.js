const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const scanDay = require('../lib/scanDay');

const router = express.Router();
router.use(authenticate);

// ─── GET /api/scan-day/my-credits ──────────────────────────────
// A clinic's complimentary crowns and its currently-open visit.
router.get('/my-credits', requireRole('clinic'), async (req, res) => {
  try {
    const [credits, visit] = await Promise.all([
      scanDay.availableCredits(req.user.id),
      scanDay.openVisitFor(req.user.id),
    ]);

    let progress = null;
    if (visit) {
      // Counted live rather than read off visit.crownOrderCount: that
      // column is only rewritten when a new crown order comes in, so a
      // window opened after the orders were placed would read zero.
      const orderCount = (await scanDay.qualifyingOrders(req.user.id, visit)).length;
      const next = scanDay.REWARD_TIERS.find(t => orderCount < t.orders);
      progress = {
        visitId: visit.customId,
        qualifiesUntil: visit.qualifiesUntil,
        crownOrderCount: orderCount,
        nextRewardAt: next?.orders ?? null,
        nextRewardCrowns: next?.crowns ?? null,
      };
    }

    res.json({ credits, progress });
  } catch (err) {
    console.error('GET /scan-day/my-credits error:', err);
    res.status(500).json({ error: 'Failed to load Scan Day status' });
  }
});

// ─── POST /api/scan-day/visits ─────────────────────────────────
// Lab staff log a scan visit, opening the clinic's qualifying window.
router.post('/visits', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { userId, notes, visitedAt } = req.body;
    if (!userId) return res.status(400).json({ error: 'Which clinic was visited?' });

    const clinic = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, name: true, clinic: true } });
    if (!clinic || clinic.role !== 'clinic') {
      return res.status(400).json({ error: 'Scan visits can only be logged against a clinic account.' });
    }

    const existing = await scanDay.openVisitFor(userId);
    if (existing) {
      // Staff pick the practice from a list of practice names, so the
      // clash has to name the practice back — not the account holder.
      return res.status(409).json({
        error: `${clinic.clinic || clinic.name} already has an open Scan Day window until ${new Date(existing.qualifiesUntil).toLocaleDateString('en-IN')}.`,
        visit: existing,
      });
    }

    const visit = await scanDay.recordVisit({ userId, recordedBy: req.user.id, notes, visitedAt });
    res.status(201).json({ success: true, visit });
  } catch (err) {
    console.error('POST /scan-day/visits error:', err);
    res.status(500).json({ error: 'Failed to record scan visit' });
  }
});

// ─── GET /api/scan-day/visits ──────────────────────────────────
router.get('/visits', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const visits = await prisma.scanVisit.findMany({
      orderBy: { visitedAt: 'desc' },
      take: 100,
      include: {
        user: { select: { name: true, clinic: true } },
        credits: { select: { id: true, redeemed: true } },
      },
    });

    // Order counts are derived, not read off the stored counter — see
    // the note in /my-credits. One query for every clinic on the page,
    // then counted per window in memory rather than N queries.
    const orders = visits.length
      ? await prisma.case.findMany({
          where: {
            doctorId: { in: [...new Set(visits.map(v => v.userId))] },
            caseType: 'crown_bridge',
            complimentary: false,
            status: { notIn: ['draft', 'cancelled'] },
          },
          select: { doctorId: true, createdAt: true },
        })
      : [];

    const countFor = (v) => orders.filter(o =>
      o.doctorId === v.userId &&
      o.createdAt >= v.visitedAt &&
      o.createdAt <= v.qualifiesUntil
    ).length;

    res.json(visits.map(v => ({
      id: v.customId,
      clinic: v.user?.clinic || v.user?.name,
      visitedAt: v.visitedAt,
      qualifiesUntil: v.qualifiesUntil,
      open: new Date(v.qualifiesUntil) >= new Date(),
      crownOrderCount: countFor(v),
      creditsIssued: v.creditsIssued,
      creditsRedeemed: v.credits.filter(c => c.redeemed).length,
      notes: v.notes,
    })));
  } catch (err) {
    console.error('GET /scan-day/visits error:', err);
    res.status(500).json({ error: 'Failed to load scan visits' });
  }
});

module.exports = router;
