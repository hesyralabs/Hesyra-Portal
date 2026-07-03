// ═══════════════════════════════════════════════════════════════════
// Strike & Trust Routes — Strike History, Pardoning, Resolution
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const config = require('../lib/config');

const router = express.Router();

// ─── GET /api/strikes/my-status ───────────────────────────────
// Get current user's trust level and strike info
router.get('/my-status', authenticate, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        strikeCount: true,
        trustLevel: true,
        status: true,
        strikes: {
          where: { isActive: true },
          orderBy: { appliedAt: 'desc' },
          include: { case: { select: { customId: true } } },
        },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    const depositRequired = user.trustLevel === 'strike_1'
      ? config.DEPOSIT_AMOUNTS.strike_1
      : user.trustLevel === 'strike_2'
        ? config.DEPOSIT_AMOUNTS.strike_2
        : 0;

    res.json({
      strikeCount: user.strikeCount,
      trustLevel: user.trustLevel,
      accountStatus: user.status,
      depositRequired,
      depositRequiredINR: config.paiseToINR(depositRequired),
      strikes: user.strikes.map(s => ({
        id: s.id,
        strikeNumber: s.strikeNumber,
        caseId: s.case?.customId,
        appliedAt: s.appliedAt,
        isActive: s.isActive,
      })),
    });
  } catch (err) {
    console.error('GET /strikes/my-status error:', err);
    res.status(500).json({ error: 'Failed to fetch strike status' });
  }
});

// ─── GET /api/strikes/account/:userId ─────────────────────────
// Admin: Get full strike history for a user
router.get('/account/:userId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      select: {
        id: true, name: true, email: true, strikeCount: true, trustLevel: true, status: true,
        strikes: {
          orderBy: { appliedAt: 'desc' },
          include: { case: { select: { customId: true, totalAmountPaise: true } } },
        },
        resolutionTickets: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (err) {
    console.error('GET /strikes/account error:', err);
    res.status(500).json({ error: 'Failed to fetch account strikes' });
  }
});

// ─── POST /api/strikes/pardon/:strikeId ───────────────────────
// Admin: Pardon a strike
router.post('/pardon/:strikeId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Pardon reason is required' });
    }

    const strike = await prisma.strike.findUnique({ where: { id: req.params.strikeId } });
    if (!strike) return res.status(404).json({ error: 'Strike not found' });

    // Pardon the strike
    await prisma.strike.update({
      where: { id: req.params.strikeId },
      data: {
        isActive: false,
        pardonedAt: new Date(),
        pardonedBy: req.user.id,
        pardonReason: reason,
      },
    });

    // Recalculate user's active strike count
    const activeStrikes = await prisma.strike.count({
      where: { userId: strike.userId, isActive: true },
    });

    let newTrustLevel = config.TRUST_LEVELS.CLEAN;
    if (activeStrikes >= 3) newTrustLevel = config.TRUST_LEVELS.SUSPENDED;
    else if (activeStrikes >= 2) newTrustLevel = config.TRUST_LEVELS.STRIKE_2;
    else if (activeStrikes >= 1) newTrustLevel = config.TRUST_LEVELS.STRIKE_1;

    const updateData = { strikeCount: activeStrikes, trustLevel: newTrustLevel };
    // Unsuspend if strikes reduced below 3
    if (activeStrikes < 3) updateData.status = 'active';

    await prisma.user.update({
      where: { id: strike.userId },
      data: updateData,
    });

    res.json({ success: true, newStrikeCount: activeStrikes, newTrustLevel });
  } catch (err) {
    console.error('POST /strikes/pardon error:', err);
    res.status(500).json({ error: 'Failed to pardon strike' });
  }
});

// ─── POST /api/strikes/resolution-ticket ──────────────────────
// Dentist: Submit a resolution ticket for suspended account
router.post('/resolution-ticket', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'Please provide a reason for your resolution request' });
    }

    // Calculate total overdue amount
    const overdueCases = await prisma.case.findMany({
      where: {
        doctorId: req.user.id,
        status: { in: ['payment_pending', 'overdue'] },
      },
    });
    const overdueAmount = overdueCases.reduce((sum, c) => sum + (c.totalAmountPaise || 0), 0);

    const ticket = await prisma.resolutionTicket.create({
      data: {
        userId: req.user.id,
        reason,
        overdueAmountPaise: overdueAmount,
      },
    });

    const io = req.app.get('io');
    if (io) io.emit('resolution:new', { ticketId: ticket.id, userId: req.user.id });

    res.status(201).json({ success: true, ticketId: ticket.id });
  } catch (err) {
    console.error('POST /strikes/resolution-ticket error:', err);
    res.status(500).json({ error: 'Failed to submit ticket' });
  }
});

// ─── GET /api/strikes/resolution-tickets ──────────────────────
// Admin: View all resolution tickets
router.get('/resolution-tickets', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const tickets = await prisma.resolutionTicket.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, strikeCount: true, trustLevel: true } },
      },
    });

    res.json(tickets);
  } catch (err) {
    console.error('GET /strikes/resolution-tickets error:', err);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// ─── PUT /api/strikes/resolution-tickets/:id ──────────────────
// Admin: Approve or reject a resolution ticket
router.put('/resolution-tickets/:id', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { status, adminNotes } = req.body; // 'approved' or 'rejected'
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use "approved" or "rejected".' });
    }

    const ticket = await prisma.resolutionTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    await prisma.resolutionTicket.update({
      where: { id: req.params.id },
      data: {
        status,
        adminNotes,
        resolvedBy: req.user.id,
        resolvedAt: new Date(),
      },
    });

    // If approved, unsuspend the account (keep strikes, require ₹500 deposit)
    if (status === 'approved') {
      await prisma.user.update({
        where: { id: ticket.userId },
        data: { status: 'active' },
      });
    }

    const io = req.app.get('io');
    if (io) io.emit('resolution:updated', { ticketId: ticket.id, status });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /strikes/resolution-tickets error:', err);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// ─── GET /api/strikes/overdue-queue ───────────────────────────
// Admin: View all overdue payments with days outstanding
router.get('/overdue-queue', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const overdueCases = await prisma.case.findMany({
      where: {
        status: { in: ['payment_pending', 'ready_for_dispatch', 'overdue'] },
        readyForDispatchAt: { not: null },
      },
      include: {
        doctor: { select: { id: true, name: true, email: true, clinic: true, strikeCount: true, trustLevel: true } },
        paymentRecords: { where: { status: 'pending' }, take: 1 },
      },
      orderBy: { readyForDispatchAt: 'asc' },
    });

    const queue = overdueCases.map(c => {
      const daysOutstanding = Math.floor((Date.now() - new Date(c.readyForDispatchAt).getTime()) / (1000 * 60 * 60 * 24));
      return {
        caseId: c.customId,
        patient: c.patient,
        clinic: c.clinic,
        doctor: c.doctor,
        totalAmountPaise: c.totalAmountPaise,
        totalAmountINR: config.paiseToINR(c.totalAmountPaise || 0),
        daysOutstanding,
        status: c.status,
        disputeActive: c.disputeActive,
        paymentLink: c.paymentRecords[0]?.paymentLinkUrl || null,
      };
    });

    res.json(queue);
  } catch (err) {
    console.error('GET /strikes/overdue-queue error:', err);
    res.status(500).json({ error: 'Failed to fetch overdue queue' });
  }
});

module.exports = router;
