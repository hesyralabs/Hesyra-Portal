// ═══════════════════════════════════════════════════════════════════
// Razorpay Client — Stub / Live Abstraction Layer
// When RAZORPAY_MODE=test, returns mock responses.
// When RAZORPAY_MODE=live, calls real Razorpay APIs.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const { paiseToINR } = require('./config');

const isLive = () => process.env.RAZORPAY_MODE === 'live';

/**
 * Generate a unique mock ID
 */
function mockId(prefix = 'pay') {
  return `${prefix}_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create a Razorpay Payment Link for an order.
 * Returns { linkId, linkUrl, expiry }
 */
async function createPaymentLink({ amountPaise, description, customerName, customerEmail, customerPhone, referenceId }) {
  if (isLive()) {
    // TODO: Wire up real Razorpay Payment Links API
    // const Razorpay = require('razorpay');
    // const instance = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    // const link = await instance.paymentLink.create({ ... });
    throw new Error('Live Razorpay not configured yet. Set RAZORPAY_MODE=test for local development.');
  }

  // ─── STUB MODE ──────────────────────────────────────────
  const linkId = mockId('plink');
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

  return {
    linkId,
    linkUrl: `http://localhost:5173/payment/simulate?link=${linkId}&amount=${amountPaise}&ref=${referenceId}`,
    shortUrl: `https://rzp.io/mock/${linkId.slice(-6)}`,
    expiry: expiry.toISOString(),
    amountPaise,
    status: 'created',
    description,
  };
}

/**
 * Create a Razorpay Order for wallet reload (Standard Checkout).
 * Returns { orderId, amountPaise }
 */
async function createOrder({ amountPaise, currency = 'INR', receipt }) {
  if (isLive()) {
    throw new Error('Live Razorpay not configured yet. Set RAZORPAY_MODE=test for local development.');
  }

  return {
    orderId: mockId('order'),
    amountPaise,
    currency,
    receipt,
    status: 'created',
  };
}

/**
 * Verify Razorpay webhook signature.
 * In test mode, always returns true.
 */
function verifyWebhookSignature(rawBody, signature) {
  if (!isLive()) return true; // Stub mode — accept all

  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
    .update(rawBody)
    .digest('hex');

  return expectedSignature === signature;
}

/**
 * Simulate a successful payment (DEV ONLY).
 * Returns a mock payment object matching Razorpay's shape.
 */
function simulatePaymentCapture(amountPaise, referenceId) {
  return {
    id: mockId('pay'),
    entity: 'payment',
    amount: amountPaise,
    currency: 'INR',
    status: 'captured',
    method: 'upi',
    description: `Payment for ${referenceId}`,
    order_id: mockId('order'),
    captured: true,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Generate a mock GST invoice after payment.
 */
function generateGSTInvoiceData({ invoiceId, amount, gstRate, hsnCode, gstin, clinic, date }) {
  const taxable = amount / (1 + gstRate);
  const tax = amount - taxable;
  const cgst = tax / 2;
  const sgst = tax / 2;

  return {
    invoiceId,
    date,
    from: {
      name: 'Hesyra Labs',
      gstin: gstin,
      address: 'Amravati, Maharashtra, India',
    },
    to: {
      name: clinic,
    },
    items: [{
      description: 'Digital Dental Manufacturing Services',
      hsnCode,
      quantity: 1,
      rate: taxable,
      amount: taxable,
    }],
    taxSummary: {
      taxableAmount: taxable,
      cgstRate: gstRate / 2,
      cgstAmount: cgst,
      sgstRate: gstRate / 2,
      sgstAmount: sgst,
      totalTax: tax,
    },
    total: amount,
    amountInWords: numberToWords(amount),
  };
}

function numberToWords(num) {
  // Simplified — production would use a full library
  return `INR ${paiseToINR(num * 100)} (approx.)`;
}

module.exports = {
  createPaymentLink,
  createOrder,
  verifyWebhookSignature,
  simulatePaymentCapture,
  generateGSTInvoiceData,
  isLive,
};
