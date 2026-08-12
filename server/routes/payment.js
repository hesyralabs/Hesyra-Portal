// ═══════════════════════════════════════════════════════════════════
// Payment Routes — Pay-on-Go + Webhooks + Dev Simulation
// ═══════════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
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
// Razorpay webhook handler.
//
// Two things here are load-bearing and easy to undo by accident:
//
//   1. The signature is verified against req.rawBody — the exact bytes
//      Razorpay sent, captured by the express.json({ verify }) hook in
//      server.js. Do not substitute JSON.stringify(req.body); it does
//      not round-trip and every real webhook would be rejected.
//
//   2. Delivery is claimed in WebhookEvent before any money moves.
//      Razorpay retries until it gets a 2xx, so a slow response or a
//      restart mid-handler means the same event arrives again.
router.post('/webhook', async (req, res) => {
  let claimId = null;
  try {
    const signature = req.headers['x-razorpay-signature'] || '';
    const rawBody = req.rawBody;

    if (!rawBody || !rawBody.length) {
      return res.status(400).json({ error: 'Empty request body' });
    }

    if (!razorpay.verifyWebhookSignature(rawBody, signature)) {
      console.warn('⚠️  Webhook signature verification failed');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body;
    const eventType = event && event.event;
    if (!eventType) {
      return res.status(400).json({ error: 'Malformed webhook payload' });
    }

    // Razorpay stamps each delivery with an event id. If one is absent
    // — a replay tool, or a version that stops sending it — hash the
    // body instead, so the duplicate guard still holds.
    claimId = req.headers['x-razorpay-event-id']
      || crypto.createHash('sha256').update(rawBody).digest('hex');

    const claim = await claimWebhookDelivery(claimId, eventType);
    if (!claim.proceed) {
      // Already handled. Acknowledge — retrying will not help Razorpay
      // and a non-2xx would only bring it back again.
      return res.json({ status: 'ok', duplicate: true });
    }

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

      // Receipt format: wallet_reload_{userId}_{timestamp}. The user id
      // is a uuid, which contains hyphens but no underscores, so it is
      // exactly the third underscore-delimited field.
      const walletUserId = receipt.startsWith('wallet_reload_')
        ? receipt.split('_')[2]
        : null;

      if (walletUserId && amountPaise) {
        const result = await paymentEngine.creditWalletReload({
          userId: walletUserId,
          amountPaise,
          razorpayPaymentId: paymentEntity?.id || razorpayOrderId,
          description: 'Wallet reloaded via Razorpay',
        });

        const io = req.app.get('io');
        if (io && !result.alreadyCredited) io.emit('wallet:updated', { userId: walletUserId });
      }
    }

    await prisma.webhookEvent.update({
      where: { eventId: claimId },
      data: { status: 'processed', processedAt: new Date() },
    });

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('POST /payment/webhook error:', err);

    // Release the claim so Razorpay's retry is allowed to try again.
    // Leaving it as 'processing' would make a transient database blip
    // permanently swallow a real payment.
    if (claimId) {
      await prisma.webhookEvent.updateMany({
        where: { eventId: claimId },
        data: { status: 'failed', error: String(err.message || err).slice(0, 500) },
      }).catch(() => {});
    }

    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * Claim a webhook delivery for processing.
 *
 * The insert is the lock: eventId is unique, so two simultaneous
 * deliveries of the same event cannot both win. A delivery is replayed
 * only if the previous attempt failed, or if it has been stuck in
 * 'processing' long enough that the process handling it must have died
 * — otherwise a crash mid-handler would block the retry forever.
 */
async function claimWebhookDelivery(eventId, eventType) {
  try {
    await prisma.webhookEvent.create({ data: { eventId, eventType } });
    return { proceed: true };
  } catch (err) {
    if (err.code !== 'P2002') throw err;
  }

  const existing = await prisma.webhookEvent.findUnique({ where: { eventId } });
  if (!existing) return { proceed: true };

  const stuck = existing.status === 'processing'
    && Date.now() - new Date(existing.receivedAt).getTime() > 10 * 60 * 1000;

  if (existing.status === 'failed' || stuck) {
    await prisma.webhookEvent.update({
      where: { eventId },
      data: { status: 'processing', error: null, receivedAt: new Date() },
    });
    return { proceed: true };
  }

  return { proceed: false };
}

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

