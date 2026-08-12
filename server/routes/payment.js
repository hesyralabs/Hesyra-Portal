// ═══════════════════════════════════════════════════════════════════
// Payment Routes — Pay-on-Go + Webhooks + Dev Simulation
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth');
const paymentEngine = require('../lib/paymentEngine');
const razorpay = require('../lib/razorpay');
const config = require('../lib/config');

const router = express.Router();

// ─── GET /api/payment/status/:caseCustomId ────────────────────
// Get payment status for a specific case
router.get('/status/:caseCustomId', authenticate, async (req, res) => {
  try {
    const c = await prisma.case.findUnique({
      where: { customId: req.params.caseCustomId },
      include: {
        paymentRecords: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!c) return res.status(404).json({ error: 'Case not found' });

    const activeLink = c.paymentRecords.find(r => r.status === 'pending');
    const confirmedPayment = c.paymentRecords.find(r => r.status === 'captured');

    res.json({
      caseId: c.customId,
      totalAmountPaise: c.totalAmountPaise,
      depositPaidPaise: c.depositPaidPaise,
      status: c.status,
      paymentConfirmedAt: c.paymentConfirmedAt,
      readyForDispatchAt: c.readyForDispatchAt,
      disputeActive: c.disputeActive,
      activePaymentLink: activeLink ? {
        url: activeLink.paymentLinkUrl,
        amountPaise: activeLink.amountPaise,
        walletDeductPaise: activeLink.walletDeductPaise,
        expiry: activeLink.paymentLinkExpiry,
      } : null,
      confirmedPayment: confirmedPayment ? {
        razorpayId: confirmedPayment.razorpayPaymentId,
        amountPaise: confirmedPayment.amountPaise,
        confirmedAt: confirmedPayment.updatedAt,
      } : null,
    });
  } catch (err) {
    console.error('GET /payment/status error:', err);
    res.status(500).json({ error: 'Failed to fetch payment status' });
  }
});

// ─── POST /api/payment/create-link/:caseCustomId ──────────────
// Manually create/refresh a payment link (e.g., on link expiry)
router.post('/create-link/:caseCustomId', authenticate, async (req, res) => {
  try {
    const c = await prisma.case.findUnique({
      where: { customId: req.params.caseCustomId },
      include: { doctor: { include: { wallet: true } } },
    });

    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (!['ready_for_dispatch', 'payment_pending', 'overdue'].includes(c.status)) {
      return res.status(400).json({ error: 'Case is not awaiting payment' });
    }

    const amountAfterDeposit = (c.totalAmountPaise || 0) - (c.depositPaidPaise || 0);

    // Expire any existing pending links
    await prisma.paymentRecord.updateMany({
      where: { caseId: c.id, status: 'pending' },
      data: { status: 'expired' },
    });

    // Create new link
    const link = await razorpay.createPaymentLink({
      amountPaise: amountAfterDeposit,
      description: `Hesyra Labs — Case ${c.customId}`,
      customerName: c.doctor.name,
      customerEmail: c.doctor.email,
      referenceId: c.customId,
    });

    await prisma.paymentRecord.create({
      data: {
        caseId: c.id,
        userId: c.doctorId,
        amountPaise: amountAfterDeposit,
        type: 'PAY_ON_GO',
        status: 'pending',
        razorpayPaymentLinkId: link.linkId,
        paymentLinkUrl: link.linkUrl,
        paymentLinkExpiry: new Date(link.expiry),
      },
    });

    res.json({ success: true, paymentLink: link });
  } catch (err) {
    console.error('POST /payment/create-link error:', err);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

// ─── POST /api/payment/webhook ────────────────────────────────
// Razorpay webhook handler
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'] || '';
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

    if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
      console.warn('⚠️  Webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event.event;

    if (eventType === 'payment.captured' || eventType === 'payment_link.paid') {
      const paymentId = event.payload?.payment?.entity?.id;
      const linkId = event.payload?.payment_link?.entity?.id;

      // Find the payment record by link ID
      const record = await prisma.paymentRecord.findFirst({
        where: {
          OR: [
            { razorpayPaymentLinkId: linkId },
            { razorpayPaymentId: paymentId },
          ],
          status: 'pending',
        },
        include: { case: true },
      });

      if (record) {
        if (record.type === 'DEPOSIT') {
          // Security deposit cleared — release case to lab
          await paymentEngine.handleDepositConfirmed(record.case.customId, paymentId);
          await prisma.case.update({
            where: { id: record.case.id },
            data: { poolEnteredAt: new Date() },
          });
          const io = req.app.get('io');
          if (io) {
            io.emit('case:created', { customId: record.case.customId });
            io.emit('case:updated', { customId: record.case.customId, newStatus: 'submitted' });
            io.emit('pool:new_case', { customId: record.case.customId, caseType: record.case.caseType });
          }
        } else {
          // Standard Pay-on-Go — mark as shipped
          await paymentEngine.handlePaymentConfirmed(record.case.customId, paymentId);
          const io = req.app.get('io');
          if (io) {
            io.emit('payment:confirmed', { caseId: record.case.customId });
            io.emit('case:updated', { customId: record.case.customId, newStatus: 'shipped' });
            io.emit('invoice:created', {});
          }
        }
      } else {
        // No PaymentRecord found — check if this is a monthly credit invoice payment
        // Monthly invoice links use referenceId = invoiceCustomId (MINV-YYYYMM-XXXX)
        const referenceId = event.payload?.payment_link?.entity?.reference_id || '';
        if (referenceId.startsWith('MINV-')) {
          const invoice = await prisma.invoice.findUnique({ where: { customId: referenceId } });
          if (invoice && invoice.invoiceType === 'monthly') {
            const result = await paymentEngine.handleCreditPayment(invoice.id, paymentId);
            const io = req.app.get('io');
            if (io) {
              io.emit('invoice:paid', { invoiceId: referenceId, userId: invoice.userId });
              if (invoice.userId) io.emit('wallet:updated', { userId: invoice.userId });
            }
            console.log(`  [Webhook] Credit invoice ${referenceId} paid via Razorpay:`, result);
          }
        }
      }

    }

    // ─── Wallet Reload: order.paid event ──────────────────────────
    if (eventType === 'order.paid') {
      const razorpayOrderId = event.payload?.order?.entity?.id;
      const amountPaise = event.payload?.order?.entity?.amount;
      const paymentEntity = event.payload?.payment?.entity;
      const receipt = event.payload?.order?.entity?.receipt || '';

      // Receipt format: wallet_reload_{userId}_{timestamp}
      const walletUserId = receipt.startsWith('wallet_reload_')
        ? receipt.split('_')[2]
        : null;

      if (walletUserId && amountPaise) {
        const config = require('../lib/config');
        const bonusEligible = config.WALLET_BONUS_ENABLED && amountPaise >= config.WALLET_BONUS_THRESHOLD_PAISE;
        const totalCredit = amountPaise + (bonusEligible ? config.WALLET_BONUS_AMOUNT_PAISE : 0);

        let wallet = await prisma.wallet.findUnique({ where: { userId: walletUserId } });
        if (!wallet) {
          wallet = await prisma.wallet.create({ data: { userId: walletUserId } });
        }

        await prisma.$transaction(async (tx) => {
          await tx.wallet.update({
            where: { id: wallet.id },
            data: {
              balancePaise: { increment: totalCredit },
              totalLoadedPaise: { increment: amountPaise },
            },
          });

          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: 'LOAD',
              amountPaise,
              direction: 'CREDIT',
              description: `Wallet reloaded via Razorpay`,
              razorpayPaymentId: paymentEntity?.id || razorpayOrderId,
            },
          });

          if (bonusEligible) {
            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: 'BONUS_CREDIT',
                amountPaise: config.WALLET_BONUS_AMOUNT_PAISE,
                direction: 'CREDIT',
                description: 'Bonus credit for premium reload',
              },
            });
          }
        });

        const io = req.app.get('io');
        if (io) io.emit('wallet:updated', { userId: walletUserId });
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('POST /payment/webhook error:', err);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ─── POST /api/payment/simulate/:caseCustomId ─────────────────
// DEV ONLY: Simulate a successful payment
router.post('/simulate/:caseCustomId', authenticate, async (req, res) => {
  try {
    if (razorpay.isLive()) {
      return res.status(403).json({ error: 'Simulation not available in live mode' });
    }

    // Even in test mode, only the paying clinic (or lab staff running a
    // drill) may mark a case paid — not any authenticated account.
    const target = await prisma.case.findUnique({
      where: { customId: req.params.caseCustomId },
      select: { doctorId: true },
    });
    if (!target) return res.status(404).json({ error: 'Case not found' });

    const isOwningClinic = req.user.role === 'clinic' && target.doctorId === req.user.id;
    const isLabStaff = ['admin', 'manager'].includes(req.user.role);
    if (!isOwningClinic && !isLabStaff) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const mockPayment = razorpay.simulatePaymentCapture(0, req.params.caseCustomId);
    const result = await paymentEngine.handlePaymentConfirmed(req.params.caseCustomId, mockPayment.id);

    // Fetch the case to get doctorId for targeted wallet update
    const updatedCase = await prisma.case.findUnique({
      where: { customId: req.params.caseCustomId },
      select: { doctorId: true },
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('payment:confirmed', { caseId: req.params.caseCustomId });
      io.emit('case:updated', { customId: req.params.caseCustomId, newStatus: 'shipped' });
      io.emit('invoice:created', {});
      if (updatedCase?.doctorId) {
        io.emit('wallet:updated', { userId: updatedCase.doctorId });
      }
    }

    res.json({ success: true, ...result, razorpayPaymentId: mockPayment.id });
  } catch (err) {
    console.error('POST /payment/simulate error:', err);
    res.status(500).json({ error: 'Simulation failed: ' + err.message });
  }
});

// ─── POST /api/payment/dispute/:caseCustomId ──────────────────
// Raise a quality dispute — pauses strike timer
router.post('/dispute/:caseCustomId', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    const c = await prisma.case.findUnique({ where: { customId: req.params.caseCustomId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    await prisma.case.update({
      where: { customId: req.params.caseCustomId },
      data: { disputeActive: true, disputeReason: reason || 'Quality concern raised by dentist' },
    });

    await prisma.timeline.create({
      data: { caseId: c.id, label: 'Quality Dispute Raised — Timer Paused', info: reason },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('POST /payment/dispute error:', err);
    res.status(500).json({ error: 'Failed to raise dispute' });
  }
});

// ─── POST /api/payment/resolve-dispute/:caseCustomId ──────────
// Admin resolves a dispute
router.post('/resolve-dispute/:caseCustomId', authenticate, async (req, res) => {
  try {
    const { resolution } = req.body; // 'rework' or 'dismiss'
    const c = await prisma.case.findUnique({ where: { customId: req.params.caseCustomId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    if (resolution === 'rework') {
      await prisma.case.update({
        where: { customId: req.params.caseCustomId },
        data: { disputeActive: false, disputeReason: null, status: 'designing' },
      });
      await prisma.timeline.create({
        data: { caseId: c.id, label: 'Dispute Resolved — Rework Ordered' },
      });
    } else {
      // Reset timer by updating readyForDispatchAt to now
      await prisma.case.update({
        where: { customId: req.params.caseCustomId },
        data: { disputeActive: false, disputeReason: null, readyForDispatchAt: new Date() },
      });
      await prisma.timeline.create({
        data: { caseId: c.id, label: 'Dispute Dismissed — Payment Timer Reset' },
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('POST /payment/resolve-dispute error:', err);
    res.status(500).json({ error: 'Failed to resolve dispute' });
  }
});

// ─── POST /api/payment/simulate-credit/:invoiceCustomId ───────
// DEV ONLY: Simulate payment of a monthly credit invoice
router.post('/simulate-credit/:invoiceCustomId', authenticate, async (req, res) => {
  try {
    if (razorpay.isLive()) {
      return res.status(403).json({ error: 'Simulation not available in live mode' });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { customId: req.params.invoiceCustomId },
    });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    if (invoice.invoiceType !== 'monthly') {
      return res.status(400).json({ error: 'This endpoint is only for monthly credit invoices' });
    }

    const mockId = `pay_credit_sim_${Date.now()}`;
    const result = await paymentEngine.handleCreditPayment(invoice.id, mockId);

    const io = req.app.get('io');
    if (io) {
      io.emit('invoice:paid', { invoiceId: invoice.customId, userId: invoice.userId });
      if (invoice.userId) io.emit('wallet:updated', { userId: invoice.userId });
    }

    res.json({ success: true, ...result, razorpayPaymentId: mockId });
  } catch (err) {
    console.error('POST /payment/simulate-credit error:', err);
    res.status(500).json({ error: 'Simulation failed: ' + err.message });
  }
});

module.exports = router;

