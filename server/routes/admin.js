const express = require('express');
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit, AUDIT_ACTIONS } = require('../lib/auditLogger');

const router = express.Router();

// All admin routes require admin role
router.use(authenticate, requireRole('admin'));

// ═══════════════════════════════════════════════════════════════════
// ACCOUNT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/admin/accounts ───────────────────────────────────
router.get('/accounts', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, customId: true, username: true, name: true, email: true, role: true,
        clinic: true, location: true, status: true, joinDate: true,
        stateCode: true, cityCode: true, docSerial: true,
      },
      orderBy: { joinDate: 'desc' },
    });

    const transformed = users.map(u => ({
      ...u,
      joinDate: new Date(u.joinDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    }));

    res.json(transformed);
  } catch (err) {
    console.error('GET /admin/accounts error:', err);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// ─── POST /api/admin/accounts ──────────────────────────────────
router.post('/accounts', async (req, res) => {
  try {
    const { name, email, password, role, clinic, location, stateCode, cityCode, docSerial, dispatchPermission } = req.body;

    // Validate role — only known roles accepted
    const VALID_ROLES = ['admin', 'manager', 'technician', 'cad_designer', 'dispatch', 'clinic'];
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: `Invalid role: "${role}". Valid: ${VALID_ROLES.join(', ')}` });
    }

    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    // Auto-generate username for clinic accounts: MH + 27 + 2 = MH272
    let username = req.body.username || null;
    if (role === 'clinic' && stateCode && cityCode && docSerial) {
      username = `${stateCode}${cityCode}${docSerial}`;
    }

    // Ensure username is unique — always generate a fallback
    if (!username) {
      const prefixMap = {
        clinic: 'doc', technician: 'tech', cad_designer: 'cad',
        dispatch: 'dsp', manager: 'mgr', admin: 'adm',
      };
      username = `${prefixMap[role] || role}_${Date.now().toString(36)}`;
    }

    // Check username uniqueness
    const existingUsername = await prisma.user.findUnique({ where: { username } });
    if (existingUsername) {
      return res.status(400).json({ success: false, message: `Username "${username}" is already taken.` });
    }

    const prefixMap = { clinic: 'DOC', technician: 'TECH', cad_designer: 'CAD', dispatch: 'DSP', manager: 'MGR', admin: 'ADM' };
    const customId = `${prefixMap[role] || role.toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const hashedPassword = await bcrypt.hash(password || 'Hesyra@2026', 10);

    // Technicians and dispatch accounts get dispatchPermission by default
    const resolvedDispatchPermission = dispatchPermission !== undefined
      ? Boolean(dispatchPermission)
      : (role === 'technician' || role === 'dispatch');

    const newUser = await prisma.user.create({
      data: {
        customId,
        username,
        stateCode:         stateCode || null,
        cityCode:          cityCode  || null,
        docSerial:         docSerial ? parseInt(docSerial) : null,
        name,
        email,
        password:          hashedPassword,
        role,
        clinic:            clinic   || null,
        location:          location || null,
        dispatchPermission: resolvedDispatchPermission,
      },
    });

    // Audit log: account creation
    await logAudit({
      req,
      action:     AUDIT_ACTIONS.ACCOUNT_CREATE,
      entityType: 'user',
      entityId:   newUser.id,
      afterState: { role, email, username },
      reason:     `Account created by admin for ${role}`,
    });

    const { password: _, ...safeUser } = newUser;
    res.status(201).json({
      success: true,
      account: {
        ...safeUser,
        joinDate: new Date(safeUser.joinDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      },
    });
  } catch (err) {
    console.error('POST /admin/accounts error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── PUT /api/admin/accounts/:id ───────────────────────────────
router.put('/accounts/:id', async (req, res) => {
  try {
    const { name, email, role, clinic, location, status } = req.body;

    // Prevent self-suspension
    if (req.params.id === req.user.id && status === 'suspended') {
      return res.status(400).json({ success: false, message: 'Cannot modify your own account status.' });
    }

    // If changing email, check uniqueness
    if (email) {
      const existing = await prisma.user.findFirst({
        where: { email, NOT: { id: req.params.id } },
      });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Email already in use by another account.' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (clinic !== undefined) updateData.clinic = clinic;
    if (location !== undefined) updateData.location = location;
    if (status !== undefined) updateData.status = status;

    await prisma.user.update({ where: { id: req.params.id }, data: updateData });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /admin/accounts/:id error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── PUT /api/admin/accounts/:id/toggle-status ─────────────────
router.put('/accounts/:id/toggle-status', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot modify your own account status.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const newStatus = user.status === 'active' ? 'suspended' : 'active';
    await prisma.user.update({ where: { id: user.id }, data: { status: newStatus } });

    res.json({ success: true, status: newStatus });
  } catch (err) {
    console.error('PUT /admin/accounts/:id/toggle error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── PUT /api/admin/accounts/:id/reset-password ────────────────
router.put('/accounts/:id/reset-password', async (req, res) => {
  try {
    const tempPassword = 'password123';
    const hashed = await bcrypt.hash(tempPassword, 10);
    await prisma.user.update({ where: { id: req.params.id }, data: { password: hashed } });

    res.json({ success: true, tempPassword });
  } catch (err) {
    console.error('PUT /admin/accounts/:id/reset-password error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── DELETE /api/admin/accounts/:id ────────────────────────────
router.delete('/accounts/:id', async (req, res) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account.' });
    }

    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /admin/accounts/:id error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// BROADCAST SYSTEM
// ═══════════════════════════════════════════════════════════════════

// In-memory broadcast (persisted in connected clients via socket)
let activeBroadcast = null;

// ─── GET /api/admin/broadcast ──────────────────────────────────
router.get('/broadcast', (req, res) => {
  res.json(activeBroadcast);
});

// ─── POST /api/admin/broadcast ─────────────────────────────────
router.post('/broadcast', (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Broadcast message cannot be empty.' });
  }

  activeBroadcast = {
    id: Date.now(),
    text: message.trim(),
    active: true,
    timestamp: new Date().toISOString(),
  };

  const io = req.app.get('io');
  if (io) io.emit('broadcast:new', activeBroadcast);

  res.json({ success: true });
});

// ─── DELETE /api/admin/broadcast ───────────────────────────────
router.delete('/broadcast', (req, res) => {
  activeBroadcast = null;

  const io = req.app.get('io');
  if (io) io.emit('broadcast:clear');

  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// AUDIT LOGS
// ═══════════════════════════════════════════════════════════════════

// Using a simple in-memory store + file for audit logs
// In production, this would be a dedicated table
let auditLogs = [
  { id: 1, time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), action: 'System Initialized — All subsystems nominal', user: 'SYSTEM', category: 'system' },
];

// ─── GET /api/admin/audit ──────────────────────────────────────
router.get('/audit', (req, res) => {
  res.json(auditLogs);
});

// ─── POST /api/admin/audit ─────────────────────────────────────
router.post('/audit', (req, res) => {
  const { action, user, category } = req.body;
  const entry = {
    id: Date.now(),
    time: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    action,
    user: user || 'SYSTEM',
    category: category || 'general',
  };
  auditLogs = [entry, ...auditLogs].slice(0, 500);

  const io = req.app.get('io');
  if (io) io.emit('audit:new', entry);

  res.json({ success: true });
});

// ─── DELETE /api/admin/audit ───────────────────────────────────
router.delete('/audit', (req, res) => {
  const clearedEntry = {
    id: Date.now(),
    time: new Date().toLocaleTimeString(),
    date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    action: 'Audit log cleared by administrator',
    user: 'SYSTEM',
    category: 'system',
  };
  auditLogs = [clearedEntry];
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════
// FINANCIAL & PAYMENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════

// ─── GET /api/admin/payments ───────────────────────────────────
router.get('/payments', async (req, res) => {
  try {
    const cases = await prisma.case.findMany({
      where: {
        status: { in: ['ready_for_dispatch', 'payment_pending', 'overdue'] }
      },
      include: {
        doctor: { select: { name: true, customId: true, clinic: true, trustLevel: true, strikeCount: true } }
      },
      orderBy: { readyForDispatchAt: 'asc' }
    });

    res.json(cases);
  } catch (err) {
    console.error('GET /admin/payments error:', err);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

// ─── PUT /api/admin/payments/:caseId/manual-confirm ────────────
router.put('/payments/:caseId/manual-confirm', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { reason } = req.body;
    
    if (!reason) return res.status(400).json({ error: 'Reason for manual confirmation is required' });

    const c = await prisma.case.findUnique({ where: { customId: caseId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Use the payment engine to handle the confirmation properly
    const { handlePaymentConfirmed } = require('../lib/paymentEngine');
    
    // We create a mock payment record to represent the manual confirm
    const paymentRecord = await prisma.paymentRecord.create({
      data: {
        caseId: c.id,
        userId: c.doctorId,
        amountPaise: c.totalAmountPaise,
        type: 'PAY_ON_GO', // Manual override usually acts like Pay-on-Go
        status: 'CAPTURED',
        razorpayPaymentId: `manual_${Date.now()}_${req.user.customId}`,
        razorpayOrderId: 'manual_override',
      }
    });

    // Handle payment confirmation (will advance status to shipped and log to audit)
    await handlePaymentConfirmed(paymentRecord.razorpayPaymentId);

    // Add to audit log
    const entry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      action: `Manual payment confirmation for case ${caseId}. Reason: ${reason}`,
      user: req.user.username || 'Admin',
      category: 'financial',
    };
    auditLogs = [entry, ...auditLogs].slice(0, 500);

    const io = req.app.get('io');
    if (io) io.emit('audit:new', entry);

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /admin/payments/manual-confirm error:', err);
    res.status(500).json({ error: 'Failed to manually confirm payment' });
  }
});

// ─── GET /api/admin/wallets ────────────────────────────────────
router.get('/wallets', async (req, res) => {
  try {
    const wallets = await prisma.wallet.findMany({
      include: {
        user: { select: { id: true, customId: true, name: true, clinic: true, trustLevel: true } }
      },
      orderBy: { balancePaise: 'desc' }
    });

    res.json(wallets);
  } catch (err) {
    console.error('GET /admin/wallets error:', err);
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
});

// ─── POST /api/admin/wallets/:userId/bonus ─────────────────────
router.post('/wallets/:userId/bonus', async (req, res) => {
  try {
    const { userId } = req.params;
    const { amountPaise, reason } = req.body;

    if (!amountPaise || amountPaise <= 0 || !reason) {
      return res.status(400).json({ error: 'Invalid amount or missing reason' });
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    await prisma.$transaction([
      prisma.wallet.update({
        where: { id: wallet.id },
        data: { balancePaise: { increment: amountPaise } }
      }),
      prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: 'BONUS_CREDIT',
          amountPaise,
          direction: 'CREDIT',
          description: `Admin Bonus: ${reason}`,
          adminId: req.user.id,
          reason,
        }
      })
    ]);

    // Send via socket to specific user if connected
    const io = req.app.get('io');
    if (io) io.to(userId).emit('wallet:updated');

    // Add to audit log
    const entry = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      action: `Wallet bonus of ₹${(amountPaise/100).toFixed(2)} credited to user ${userId}. Reason: ${reason}`,
      user: req.user.username || 'Admin',
      category: 'financial',
    };
    auditLogs = [entry, ...auditLogs].slice(0, 500);

    res.json({ success: true });
  } catch (err) {
    console.error('POST /admin/wallets/bonus error:', err);
    res.status(500).json({ error: 'Failed to grant bonus' });
  }
});

module.exports = router;
