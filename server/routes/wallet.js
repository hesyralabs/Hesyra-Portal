// ═══════════════════════════════════════════════════════════════════
// Wallet Routes — Balance, Ledger, Reload, Admin Ops
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const razorpay = require('../lib/razorpay');
const config = require('../lib/config');

const router = express.Router();

// ─── GET /api/wallet ──────────────────────────────────────────
// Get current user's wallet balance + recent transactions
router.get('/', authenticate, async (req, res) => {
  try {
    let wallet = await prisma.wallet.findUnique({
      where: { userId: req.user.id },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    // Auto-create wallet if doesn't exist (for dentists)
    if (!wallet) {
      wallet = await prisma.wallet.create({
        data: { userId: req.user.id },
        include: { transactions: true },
      });
    }

    res.json({
      balancePaise: wallet.balancePaise,
      balanceINR: config.paiseToINR(wallet.balancePaise),
      totalLoadedPaise: wallet.totalLoadedPaise,
      totalSpentPaise: wallet.totalSpentPaise,
      lowBalance: wallet.balancePaise < config.WALLET_LOW_BALANCE_PAISE,
      transactions: wallet.transactions.map(tx => ({
        id: tx.id,
        type: tx.type,
        amountPaise: tx.amountPaise,
        amountINR: config.paiseToINR(tx.amountPaise),
        direction: tx.direction,
        description: tx.description,
        caseId: tx.caseId,
        createdAt: tx.createdAt,
      })),
    });
  } catch (err) {
    console.error('GET /wallet error:', err);
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

// ─── GET /api/wallet/ledger ───────────────────────────────────
// Full transaction ledger (paginated)
router.get('/ledger', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet) return res.json({ transactions: [], total: 0 });

    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.walletTransaction.count({ where: { walletId: wallet.id } }),
    ]);

    res.json({
      transactions: transactions.map(tx => ({
        id: tx.id,
        type: tx.type,
        amountPaise: tx.amountPaise,
        amountINR: config.paiseToINR(tx.amountPaise),
        direction: tx.direction,
        description: tx.description,
        caseId: tx.caseId,
        reason: tx.reason,
        createdAt: tx.createdAt,
      })),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('GET /wallet/ledger error:', err);
    res.status(500).json({ error: 'Failed to fetch ledger' });
  }
});

// ─── POST /api/wallet/reload ──────────────────────────────────
// Initiate wallet reload (returns Razorpay order/checkout data)
router.post('/reload', authenticate, async (req, res) => {
  try {
    const { amountPaise } = req.body;

    if (!amountPaise || amountPaise < config.WALLET_MIN_RELOAD_PAISE) {
      return res.status(400).json({
        error: `Minimum reload amount is ₹${config.paiseToINR(config.WALLET_MIN_RELOAD_PAISE)}`,
      });
    }

    const order = await razorpay.createOrder({
      amountPaise,
      receipt: `wallet_reload_${req.user.id}_${Date.now()}`,
    });

    // Check if bonus applies
    const bonusEligible = config.WALLET_BONUS_ENABLED && amountPaise >= config.WALLET_BONUS_THRESHOLD_PAISE;

    res.json({
      success: true,
      order,
      bonusEligible,
      bonusAmount: bonusEligible ? config.WALLET_BONUS_AMOUNT_PAISE : 0,
    });
  } catch (err) {
    console.error('POST /wallet/reload error:', err);
    res.status(500).json({ error: 'Failed to initiate reload' });
  }
});

// ─── POST /api/wallet/simulate-reload ─────────────────────────
// DEV ONLY: Simulate wallet reload
router.post('/simulate-reload', authenticate, async (req, res) => {
  try {
    if (razorpay.isLive()) {
      return res.status(403).json({ error: 'Simulation not available in live mode' });
    }

    const { amountPaise } = req.body;
    if (!amountPaise || amountPaise < config.WALLET_MIN_RELOAD_PAISE) {
      return res.status(400).json({
        error: `Minimum reload amount is ₹${config.paiseToINR(config.WALLET_MIN_RELOAD_PAISE)}`,
      });
    }

    // Get or create wallet
    let wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
    if (!wallet) {
      wallet = await prisma.wallet.create({ data: { userId: req.user.id } });
    }

    // Check bonus eligibility
    const bonusEligible = config.WALLET_BONUS_ENABLED && amountPaise >= config.WALLET_BONUS_THRESHOLD_PAISE;
    const totalCredit = amountPaise + (bonusEligible ? config.WALLET_BONUS_AMOUNT_PAISE : 0);

    // Credit wallet
    await prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        balancePaise: { increment: totalCredit },
        totalLoadedPaise: { increment: amountPaise },
      },
    });

    // Record LOAD transaction
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: config.TX_TYPES.LOAD,
        amountPaise,
        direction: 'CREDIT',
        description: `Wallet reloaded — ₹${config.paiseToINR(amountPaise)}`,
        razorpayPaymentId: `sim_${Date.now()}`,
      },
    });

    // Record BONUS if applicable
    if (bonusEligible) {
      await prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: config.TX_TYPES.BONUS_CREDIT,
          amountPaise: config.WALLET_BONUS_AMOUNT_PAISE,
          direction: 'CREDIT',
          description: `Bonus credit for loading ₹${config.paiseToINR(amountPaise)}+`,
        },
      });
    }

    // Fetch updated wallet
    const updated = await prisma.wallet.findUnique({ where: { id: wallet.id } });

    const io = req.app.get('io');
    if (io) io.emit('wallet:updated', { userId: req.user.id });

    res.json({
      success: true,
      loaded: amountPaise,
      bonus: bonusEligible ? config.WALLET_BONUS_AMOUNT_PAISE : 0,
      newBalance: updated.balancePaise,
      newBalanceINR: config.paiseToINR(updated.balancePaise),
    });
  } catch (err) {
    console.error('POST /wallet/simulate-reload error:', err);
    res.status(500).json({ error: 'Simulation failed: ' + err.message });
  }
});

// ─── POST /api/wallet/set-preferred-mode ──────────────────────
// Set payment mode preference
router.post('/set-preferred-mode', authenticate, async (req, res) => {
  try {
    const { mode } = req.body;
    if (!['pay_on_go', 'wallet'].includes(mode)) {
      return res.status(400).json({ error: 'Invalid payment mode' });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { preferredPaymentMode: mode },
    });

    res.json({ success: true, mode });
  } catch (err) {
    console.error('POST /wallet/set-preferred-mode error:', err);
    res.status(500).json({ error: 'Failed to update preference' });
  }
});

module.exports = router;
