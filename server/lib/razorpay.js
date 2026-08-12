// ═══════════════════════════════════════════════════════════════════
// Razorpay Client — Stub / Live Abstraction Layer
// When RAZORPAY_MODE=test, returns mock responses.
// When RAZORPAY_MODE=live, calls real Razorpay APIs.
//
// Every function returns the same normalised shape in both modes, so
// callers never branch on the mode. The only place `isLive()` is
// legitimately read outside this file is to refuse the /simulate
// endpoints in production.
// ═══════════════════════════════════════════════════════════════════

const crypto = require('crypto');
const config = require('./config');

const isLive = () => process.env.RAZORPAY_MODE === 'live';

// ─── Configuration ────────────────────────────────────────────────
// Razorpay needs three secrets to work end to end: a key pair to call
// the API with, and a separate webhook secret to verify what it calls
// back with. Missing any one of them fails in a different and much
// later place — a key typo surfaces as a 401 at checkout, a missing
// webhook secret as payments that never confirm — so they are checked
// together, by name, up front.
const REQUIRED_LIVE_VARS = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'];

/**
 * Which of the required live variables are absent or blank.
 * Returns [] when the live path is fully configured.
 */
function missingLiveConfig() {
  return REQUIRED_LIVE_VARS.filter(v => !process.env[v] || !String(process.env[v]).trim());
}

/**
 * Throw a message that names what is missing, rather than letting the
 * SDK fail with an opaque 401 three calls later.
 */
function assertLiveConfigured() {
  const missing = missingLiveConfig();
  if (missing.length) {
    throw new Error(
      `Razorpay is in live mode but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set. ` +
      `Set them in server/.env, or use RAZORPAY_MODE=test for local development.`
    );
  }
}

// The SDK is required lazily so a test-mode install never has to have
// it resolvable, and instantiated once so we are not rebuilding an
// HTTP agent per payment link.
let _client = null;
function getClient() {
  assertLiveConfigured();
  if (!_client) {
    const Razorpay = require('razorpay');
    _client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _client;
}

/**
 * The public key, safe to hand to the browser for Standard Checkout.
 * Never expose RAZORPAY_KEY_SECRET.
 */
function getPublicKeyId() {
  return isLive() ? process.env.RAZORPAY_KEY_ID : 'rzp_test_stub';
}

/**
 * Generate a unique mock ID
 */
function mockId(prefix = 'pay') {
  return `${prefix}_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Where Razorpay should send the payer once a link is paid. Optional —
 * without it the payer lands on Razorpay's own receipt page, which is
 * a perfectly good outcome, just not ours.
 */
function appUrl(path) {
  const base = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : null;
}

// ─── Payment links ────────────────────────────────────────────────

/**
 * Create a Razorpay Payment Link for an order.
 * Returns { linkId, linkUrl, shortUrl, expiry, amountPaise, status, description }
 */
async function createPaymentLink({ amountPaise, description, customerName, customerEmail, customerPhone, referenceId }) {
  // Razorpay rejects a link that expires less than 15 minutes out, and
  // an unpaid link is worthless to us after a week anyway.
  const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  if (isLive()) {
    const callbackUrl = appUrl(`/payment/return?ref=${encodeURIComponent(referenceId)}`);

    const link = await getClient().paymentLink.create({
      amount: amountPaise,
      currency: 'INR',
      accept_partial: false,
      description,
      reference_id: referenceId,
      // Razorpay validates these, so send a field only when we have a
      // real value for it. An empty contact string is a 400.
      customer: {
        ...(customerName ? { name: customerName } : {}),
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(customerPhone ? { contact: customerPhone } : {}),
      },
      notify: { sms: Boolean(customerPhone), email: Boolean(customerEmail) },
      reminder_enable: true,
      expire_by: Math.floor(expiry.getTime() / 1000),
      ...(callbackUrl ? { callback_url: callbackUrl, callback_method: 'get' } : {}),
      notes: { reference_id: referenceId },
    });

    return {
      linkId: link.id,
      // short_url is the one to put in front of a human; there is no
      // other URL on the response to fall back to.
      linkUrl: link.short_url,
      shortUrl: link.short_url,
      expiry: new Date((link.expire_by || Math.floor(expiry.getTime() / 1000)) * 1000).toISOString(),
      amountPaise: link.amount,
      status: link.status,
      description: link.description || description,
    };
  }

  // ─── STUB MODE ──────────────────────────────────────────
  const linkId = mockId('plink');

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
 * Look a payment link up again — used to reconcile a link whose webhook
 * never arrived.
 */
async function fetchPaymentLink(linkId) {
  if (!isLive()) return { id: linkId, status: 'created', amount: 0 };
  return await getClient().paymentLink.fetch(linkId);
}

// ─── Orders (Standard Checkout, used for wallet reload) ───────────

/**
 * Create a Razorpay Order for wallet reload (Standard Checkout).
 * Returns { orderId, amountPaise, currency, receipt, status, keyId }
 */
async function createOrder({ amountPaise, currency = 'INR', receipt, notes }) {
  if (isLive()) {
    const order = await getClient().orders.create({
      amount: amountPaise,
      currency,
      receipt,
      payment_capture: true,
      ...(notes ? { notes } : {}),
    });

    return {
      orderId: order.id,
      amountPaise: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      status: order.status,
      keyId: getPublicKeyId(),
    };
  }

  return {
    orderId: mockId('order'),
    amountPaise,
    currency,
    receipt,
    status: 'created',
    keyId: getPublicKeyId(),
  };
}

/**
 * Fetch a captured payment — the authoritative record of what was
 * actually collected. Never trust an amount the browser reports.
 */
async function fetchPayment(paymentId) {
  if (!isLive()) {
    return { id: paymentId, status: 'captured', amount: 0, order_id: null };
  }
  return await getClient().payments.fetch(paymentId);
}

// ─── Signature verification ───────────────────────────────────────

/**
 * Constant-time string compare. A plain `===` on an HMAC leaks the
 * length of the matching prefix through timing, which is enough to
 * forge a signature byte by byte given enough attempts.
 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // timingSafeEqual throws on a length mismatch, so compare lengths
  // first — the length of an HMAC is not a secret.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Razorpay webhook signature.
 *
 * `rawBody` MUST be the exact bytes Razorpay sent. Re-serialising the
 * parsed object does not round-trip — key order, unicode escaping and
 * whitespace all differ — so a JSON.stringify() here would reject every
 * legitimate webhook. See the express.json({ verify }) hook in
 * server.js, which captures req.rawBody for this function.
 */
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!isLive()) {
    // In test mode there is no real signature to check. If a secret has
    // been configured anyway, honour it — that is how the signature path
    // gets exercised before going live.
    if (!secret) return true;
  } else {
    assertLiveConfigured();
  }

  if (!signature) return false;

  const expected = crypto
    .createHmac('sha256', secret || '')
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    .digest('hex');

  return safeEqual(expected, signature);
}

/**
 * Verify the signature Standard Checkout hands back to the browser
 * after a successful payment.
 *
 * This is signed with the API key secret over `order_id|payment_id` —
 * a different secret and a different payload from the webhook, so the
 * two cannot share a function. Without it, anything the browser POSTs
 * to our verify endpoint is just a claim.
 */
function verifyCheckoutSignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature) return false;

  if (!isLive()) {
    // Stub checkout signs with a well-known secret so the client flow
    // can be exercised locally without Razorpay credentials.
    const expected = crypto
      .createHmac('sha256', 'stub_secret')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    return safeEqual(expected, signature);
  }

  assertLiveConfigured();
  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return safeEqual(expected, signature);
}

/**
 * Produce the signature a stub checkout would return, so the dev flow
 * has something valid to send. Never reachable in live mode.
 */
function signStubCheckout(orderId, paymentId) {
  if (isLive()) throw new Error('signStubCheckout is not available in live mode');
  return crypto.createHmac('sha256', 'stub_secret').update(`${orderId}|${paymentId}`).digest('hex');
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

// ─── GST invoice data ─────────────────────────────────────────────

// GSTIN state codes, first two digits. Used to decide whether a sale is
// intra-state (CGST + SGST) or inter-state (IGST) — the split is not
// cosmetic, it decides which government gets the money and an invoice
// that gets it wrong has to be credited and reissued.
const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir',   '02': 'Himachal Pradesh',  '03': 'Punjab',
  '04': 'Chandigarh',          '05': 'Uttarakhand',       '06': 'Haryana',
  '07': 'Delhi',               '08': 'Rajasthan',         '09': 'Uttar Pradesh',
  '10': 'Bihar',               '11': 'Sikkim',            '12': 'Arunachal Pradesh',
  '13': 'Nagaland',            '14': 'Manipur',           '15': 'Mizoram',
  '16': 'Tripura',             '17': 'Meghalaya',         '18': 'Assam',
  '19': 'West Bengal',         '20': 'Jharkhand',         '21': 'Odisha',
  '22': 'Chhattisgarh',        '23': 'Madhya Pradesh',    '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',         '29': 'Karnataka',         '30': 'Goa',
  '31': 'Lakshadweep',         '32': 'Kerala',            '33': 'Tamil Nadu',
  '34': 'Puducherry',          '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',           '37': 'Andhra Pradesh',    '38': 'Ladakh',
};

function normaliseState(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * The lab's own state, read off the first two digits of its GSTIN so
 * there is one source of truth rather than a hardcoded string that can
 * drift away from the registration.
 */
function labStateCode() {
  return String(config.HESYRA_GSTIN || '').slice(0, 2);
}

/**
 * Decide the tax split for a sale to a clinic in `customerState`.
 *
 * When the clinic's state is unknown we fall back to intra-state and
 * say so in `assumed`, because that is the lab's home state and the
 * likeliest case — but the caller is told, so an invoice can be held
 * rather than quietly issued against a guess.
 */
function resolveTaxTreatment(customerState) {
  const homeCode = labStateCode();
  const homeState = GST_STATE_CODES[homeCode] || null;

  if (!customerState) {
    return { interState: false, assumed: true, placeOfSupply: homeState, homeState };
  }

  const target = normaliseState(customerState);
  const match = Object.entries(GST_STATE_CODES)
    .find(([, name]) => normaliseState(name) === target);

  if (!match) {
    return { interState: false, assumed: true, placeOfSupply: customerState, homeState };
  }

  return {
    interState: match[0] !== homeCode,
    assumed: false,
    placeOfSupply: match[1],
    placeOfSupplyCode: match[0],
    homeState,
  };
}

/**
 * Build the data for a GST invoice.
 *
 * `amount` is in paise and is GST-INCLUSIVE — it is what the clinic was
 * actually charged. The taxable value is recovered from it rather than
 * recomputed from the price list, so the invoice always reconciles to
 * the money that moved.
 */
function generateGSTInvoiceData({ invoiceId, amount, gstRate, hsnCode, gstin, clinic, clinicState, clinicGstin, date }) {
  const taxable = Math.round(amount / (1 + gstRate));
  const tax = amount - taxable;
  const treatment = resolveTaxTreatment(clinicState);

  // Intra-state splits the tax down the middle between centre and
  // state; inter-state is a single integrated levy at the full rate.
  // Halving is done on the paise so the two halves always re-add to
  // the total — deriving each from the rate independently can leave a
  // one-paise hole.
  const cgst = treatment.interState ? 0 : Math.floor(tax / 2);
  const sgst = treatment.interState ? 0 : tax - Math.floor(tax / 2);
  const igst = treatment.interState ? tax : 0;

  return {
    invoiceId,
    date,
    from: {
      name: config.HESYRA_LEGAL_NAME,
      gstin: gstin,
      address: config.HESYRA_ADDRESS,
      state: treatment.homeState,
    },
    to: {
      name: clinic,
      gstin: clinicGstin || null,
      state: treatment.placeOfSupply,
    },
    placeOfSupply: treatment.placeOfSupply,
    placeOfSupplyAssumed: treatment.assumed,
    items: [{
      description: 'Digital Dental Manufacturing Services',
      hsnCode,
      quantity: 1,
      rate: taxable,
      amount: taxable,
    }],
    taxSummary: {
      taxableAmount: taxable,
      interState: treatment.interState,
      cgstRate: treatment.interState ? 0 : gstRate / 2,
      cgstAmount: cgst,
      sgstRate: treatment.interState ? 0 : gstRate / 2,
      sgstAmount: sgst,
      igstRate: treatment.interState ? gstRate : 0,
      igstAmount: igst,
      totalTax: tax,
    },
    total: amount,
    amountInWords: amountInWords(amount),
  };
}

// ─── Amount in words ──────────────────────────────────────────────
// An Indian tax invoice states its total in words, and it groups in
// lakhs and crores rather than millions. This has to be exact: it is
// the field a reader falls back to when the figures are disputed, so
// "(approx.)" is not an option.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

/** 0–99 in words. */
function twoDigits(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = ONES[n % 10];
  return o ? `${t} ${o}` : t;
}

/** 0–999 in words. */
function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/**
 * A whole number in the Indian numbering system: the last three digits
 * stand alone, then the remainder is grouped in twos — thousand, lakh,
 * crore, and above that we keep counting in crores.
 */
function integerToWords(n) {
  if (n === 0) return 'Zero';

  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  const parts = [];
  // Beyond 99 crore the group itself needs the full treatment, which is
  // why this recurses rather than calling threeDigits.
  if (crore) parts.push(`${crore > 999 ? integerToWords(crore) : threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));

  return parts.join(' ');
}

/**
 * Render a paise amount as the words printed on the invoice.
 * e.g. 1312500 → "Rupees Thirteen Thousand One Hundred Twenty Five Only"
 */
function amountInWords(paise) {
  const total = Math.abs(Math.round(Number(paise) || 0));
  const rupees = Math.floor(total / 100);
  const pais = total % 100;

  let words = `Rupees ${integerToWords(rupees)}`;
  if (pais) words += ` and ${twoDigits(pais)} Paise`;
  words += ' Only';

  return (Number(paise) || 0) < 0 ? `Minus ${words}` : words;
}

module.exports = {
  createPaymentLink,
  fetchPaymentLink,
  createOrder,
  fetchPayment,
  verifyWebhookSignature,
  verifyCheckoutSignature,
  signStubCheckout,
  simulatePaymentCapture,
  generateGSTInvoiceData,
  resolveTaxTreatment,
  amountInWords,
  getPublicKeyId,
  missingLiveConfig,
  assertLiveConfigured,
  isLive,
};
