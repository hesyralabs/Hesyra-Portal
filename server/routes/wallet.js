// ═══════════════════════════════════════════════════════════════════
// Wallet Routes — Balance, Ledger, Reload, Admin Ops
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const razorpay = require('../lib/razorpay');
const paymentEngine = require('../lib/paymentEngine');
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

    // The receipt is how order.paid finds its way back to a user —
    // Razorpay hands it back verbatim on the webhook. The id is a uuid
    // (hyphens, no underscores), so it survives the split on the far end.
    const order = await razorpay.createOrder({
      amountPaise,
      receipt: `wallet_reload_${req.user.id}_${Date.now()}`,
      notes: { userId: req.user.id, purpose: 'wallet_reload' },
    });

    // Check if bonus applies
    const bonusEligible = config.WALLET_BONUS_ENABLED && amountPaise >= config.WALLET_BONUS_THRESHOLD_PAISE;

    res.json({
      success: true,
      order,
      // Standard Checkout needs the publishable key id in the browser.
      keyId: razorpay.getPublicKeyId(),
      bonusEligible,
      bonusAmount: bonusEligible ? config.WALLET_BONUS_AMOUNT_PAISE : 0,
    });
  } catch (err) {
    console.error('POST /wallet/reload error:', err);
    res.status(500).json({ error: 'Failed to initiate reload' });
  }
});

// ─── POST /api/wallet/reload/verify ───────────────────────────
// Confirm a Standard Checkout reload from the browser handler.
//
// The order.paid webhook is the authoritative path and will credit the
// wallet on its own. This endpoint exists so the clinic sees its new
// balance immediately instead of watching a spinner until the webhook
// lands — it credits through the same idempotent function, so whichever
// arrives second is a no-op.
//
// What the browser sends is a claim, not evidence: it is only acted on
// once the signature over `order_id|payment_id` checks out against the
// key secret, which only Razorpay could have produced.
router.post('/reload/verify', authenticate, async (req, res) => {
  try {
    const {
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      razorpay_signature: signature,
    } = req.body || {};

    if (!orderId || !paymentId || !signature) {
      return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are all required' });
    }

    if (!razorpay.verifyCheckoutSignature({ orderId, paymentId, signature })) {
      console.warn(`⚠️  Reload signature rejected for order ${orderId}`);
      return res.status(400).json({ error: 'Payment signature verification failed' });
    }

    // The amount comes from Razorpay, never from the request body — the
    // browser is free to claim it loaded a lakh.
    const payment = await razorpay.fetchPayment(paymentId);

    if (razorpay.isLive()) {
      if (payment.status !== 'captured') {
        return res.status(400).json({ error: `Payment is ${payment.status}, not captured` });
      }
      if (payment.order_id !== orderId) {
        return res.status(400).json({ error: 'Payment does not belong to this order' });
      }
    }

    const amountPaise = razorpay.isLive() ? payment.amount : Number(req.body.amountPaise) || 0;
    if (!amountPaise || amountPaise < config.WALLET_MIN_RELOAD_PAISE) {
      return res.status(400).json({
        error: `Minimum reload amount is ₹${config.paiseToINR(config.WALLET_MIN_RELOAD_PAISE)}`,
      });
    }

    const result = await paymentEngine.creditWalletReload({
      userId: req.user.id,
      amountPaise,
      razorpayPaymentId: paymentId,
      description: `Wallet reloaded — ₹${config.paiseToINR(amountPaise)}`,
    });

    if (result.alreadyCredited) {
      const wallet = await prisma.wallet.findUnique({ where: { userId: req.user.id } });
      return res.json({
        success: true,
        alreadyCredited: true,
        newBalance: wallet?.balancePaise ?? 0,
        newBalanceINR: config.paiseToINR(wallet?.balancePaise ?? 0),
      });
    }

    const io = req.app.get('io');
    if (io) io.emit('wallet:updated', { userId: req.user.id });

    res.json({
      success: true,
      loaded: result.loaded,
      bonus: result.bonus,
      newBalance: result.newBalance,
      newBalanceINR: config.paiseToINR(result.newBalance),
    });
  } catch (err) {
    console.error('POST /wallet/reload/verify error:', err);
    res.status(500).json({ error: 'Failed to verify reload' });
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

    // Same crediting path as a real reload, so a simulated load and a
    // live one cannot drift apart in what they write to the ledger.
    const result = await paymentEngine.creditWalletReload({
      userId: req.user.id,
      amountPaise,
      razorpayPaymentId: `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      description: `Wallet reloaded — ₹${config.paiseToINR(amountPaise)}`,
    });

    const io = req.app.get('io');
    if (io) io.emit('wallet:updated', { userId: req.user.id });

    res.json({
      success: true,
      loaded: result.loaded,
      bonus: result.bonus,
      newBalance: result.newBalance,
      newBalanceINR: config.paiseToINR(result.newBalance),
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
