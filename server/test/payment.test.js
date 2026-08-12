// ═══════════════════════════════════════════════════════════════════
// PAYMENT TEST SUITE
//
// Covers the parts of the Razorpay integration that can be checked
// without an account: signature verification, the CGST/SGST vs IGST
// split, amount-in-words, and the live-config gate.
//
// What this CANNOT cover is the live path itself — createPaymentLink
// and createOrder call Razorpay, and there are no credentials here. A
// green run means the money arithmetic and the trust boundary are
// right; it does not mean a real payment has ever been taken.
//
// Pure functions only: no database, no server, no network.
//
//   node server/test/payment.test.js
// ═══════════════════════════════════════════════════════════════════
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, message: err.message });
  }
}

// razorpay.js reads process.env at call time, so each block sets the
// environment it needs and restores it afterwards.
function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const razorpay = require('../lib/razorpay');
const config = require('../lib/config');

const R = (rupees) => rupees * 100;

// ─── Amount in words ─────────────────────────────────────────────
// Printed on the invoice and legally required. The Indian numbering
// system groups in lakhs and crores, not thousands.

check('words — zero', () =>
  assert.equal(razorpay.amountInWords(0), 'Rupees Zero Only'));

check('words — a crown at ₹1,575', () =>
  assert.equal(razorpay.amountInWords(R(1575)), 'Rupees One Thousand Five Hundred Seventy Five Only'));

check('words — teens do not decompose', () =>
  assert.equal(razorpay.amountInWords(R(15)), 'Rupees Fifteen Only'));

check('words — round tens carry no trailing unit', () =>
  assert.equal(razorpay.amountInWords(R(40)), 'Rupees Forty Only'));

check('words — a full-arch denture at ₹17,850', () =>
  assert.equal(razorpay.amountInWords(R(17850)), 'Rupees Seventeen Thousand Eight Hundred Fifty Only'));

check('words — an Executive aligner case at ₹95,550', () =>
  assert.equal(razorpay.amountInWords(R(95550)), 'Rupees Ninety Five Thousand Five Hundred Fifty Only'));

check('words — above a lakh it groups in lakhs, not hundred-thousands', () =>
  assert.equal(razorpay.amountInWords(R(155000)), 'Rupees One Lakh Fifty Five Thousand Only'));

check('words — crore', () =>
  assert.equal(razorpay.amountInWords(R(12500000)), 'Rupees One Crore Twenty Five Lakh Only'));

check('words — paise are named when present', () =>
  assert.equal(razorpay.amountInWords(157550), 'Rupees One Thousand Five Hundred Seventy Five and Fifty Paise Only'));

check('words — no paise clause on a whole rupee amount', () =>
  assert.ok(!razorpay.amountInWords(R(100)).includes('Paise')));

check('words — hundreds inside a thousand group', () =>
  assert.equal(razorpay.amountInWords(R(101)), 'Rupees One Hundred One Only'));

// ─── Place of supply ─────────────────────────────────────────────
// The lab's state comes off the first two digits of its own GSTIN, so
// these tests pin the GSTIN rather than assume the configured one.

const MH_GSTIN = '27ABCDE1234F1Z5';

check('tax — a Maharashtra clinic is intra-state', () => {
  const saved = config.HESYRA_GSTIN;
  config.HESYRA_GSTIN = MH_GSTIN;
  try {
    const t = razorpay.resolveTaxTreatment('Maharashtra');
    assert.equal(t.interState, false);
    assert.equal(t.assumed, false);
    assert.equal(t.placeOfSupply, 'Maharashtra');
  } finally { config.HESYRA_GSTIN = saved; }
});

check('tax — a Karnataka clinic is inter-state', () => {
  const saved = config.HESYRA_GSTIN;
  config.HESYRA_GSTIN = MH_GSTIN;
  try {
    const t = razorpay.resolveTaxTreatment('Karnataka');
    assert.equal(t.interState, true);
    assert.equal(t.placeOfSupply, 'Karnataka');
  } finally { config.HESYRA_GSTIN = saved; }
});

check('tax — state matching ignores case and spacing', () => {
  const saved = config.HESYRA_GSTIN;
  config.HESYRA_GSTIN = MH_GSTIN;
  try {
    assert.equal(razorpay.resolveTaxTreatment('  tamil nadu ').interState, true);
    assert.equal(razorpay.resolveTaxTreatment('MAHARASHTRA').interState, false);
  } finally { config.HESYRA_GSTIN = saved; }
});

check('tax — an unknown state falls back to intra-state and says so', () => {
  const saved = config.HESYRA_GSTIN;
  config.HESYRA_GSTIN = MH_GSTIN;
  try {
    const t = razorpay.resolveTaxTreatment(null);
    assert.equal(t.interState, false);
    assert.equal(t.assumed, true, 'an assumed place of supply must be flagged, not silently used');
  } finally { config.HESYRA_GSTIN = saved; }
});

check('tax — an unrecognised state name is also flagged as assumed', () => {
  const t = razorpay.resolveTaxTreatment('Freedonia');
  assert.equal(t.assumed, true);
});

// ─── Invoice data ────────────────────────────────────────────────

const invoiceFor = (amountPaise, clinicState) => razorpay.generateGSTInvoiceData({
  invoiceId: 'INV-2026-08-0001',
  amount: amountPaise,
  gstRate: config.GST_RATE,
  hsnCode: config.HSN_CODE,
  gstin: MH_GSTIN,
  clinic: 'Test Dental',
  clinicState,
  date: new Date('2026-08-12'),
});

check('invoice — the tax components always re-add to the total tax', () => {
  const inv = invoiceFor(R(1575), 'Maharashtra');
  const s = inv.taxSummary;
  assert.equal(s.cgstAmount + s.sgstAmount + s.igstAmount, s.totalTax);
});

check('invoice — taxable value plus tax equals what was charged', () => {
  const inv = invoiceFor(R(1575), 'Maharashtra');
  assert.equal(inv.taxSummary.taxableAmount + inv.taxSummary.totalTax, inv.total);
});

check('invoice — a ₹1,575 crown recovers ₹1,500 net and ₹75 GST', () => {
  const inv = invoiceFor(R(1575), 'Maharashtra');
  assert.equal(inv.taxSummary.taxableAmount, R(1500));
  assert.equal(inv.taxSummary.totalTax, R(75));
});

check('invoice — intra-state splits into CGST and SGST, with no IGST', () => {
  const s = invoiceFor(R(1575), 'Maharashtra').taxSummary;
  assert.equal(s.interState, false);
  assert.equal(s.cgstAmount, R(37.5));
  assert.equal(s.sgstAmount, R(37.5));
  assert.equal(s.igstAmount, 0);
});

check('invoice — inter-state is a single IGST levy at the full rate', () => {
  const s = invoiceFor(R(1575), 'Karnataka').taxSummary;
  assert.equal(s.interState, true);
  assert.equal(s.igstAmount, R(75));
  assert.equal(s.cgstAmount, 0);
  assert.equal(s.sgstAmount, 0);
  assert.equal(s.igstRate, config.GST_RATE);
});

check('invoice — an odd tax amount loses no paise to rounding', () => {
  // 1001 paise gross: tax works out to an odd number, so the halves
  // cannot both be tax/2.
  const s = invoiceFor(1001, 'Maharashtra').taxSummary;
  assert.equal(s.cgstAmount + s.sgstAmount, s.totalTax);
});

check('invoice — amount in words matches the total charged', () =>
  assert.equal(invoiceFor(R(1575), 'Maharashtra').amountInWords,
    'Rupees One Thousand Five Hundred Seventy Five Only'));

check('invoice — an assumed place of supply is carried onto the invoice', () =>
  assert.equal(invoiceFor(R(1575), null).placeOfSupplyAssumed, true));

// ─── Webhook signature verification ──────────────────────────────
// The signature is an HMAC-SHA256 over the exact bytes Razorpay sent,
// keyed with the webhook secret.

const SECRET = 'whsec_test_value';
const BODY = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_123' } } } }), 'utf8');
const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('hex');

check('webhook — a correct signature is accepted', () =>
  withEnv({ RAZORPAY_MODE: 'test', RAZORPAY_WEBHOOK_SECRET: SECRET }, () =>
    assert.equal(razorpay.verifyWebhookSignature(BODY, sign(BODY, SECRET)), true)));

check('webhook — a signature from the wrong secret is rejected', () =>
  withEnv({ RAZORPAY_MODE: 'test', RAZORPAY_WEBHOOK_SECRET: SECRET }, () =>
    assert.equal(razorpay.verifyWebhookSignature(BODY, sign(BODY, 'not_the_secret')), false)));

check('webhook — a tampered body is rejected', () =>
  withEnv({ RAZORPAY_MODE: 'test', RAZORPAY_WEBHOOK_SECRET: SECRET }, () => {
    const signature = sign(BODY, SECRET);
    const tampered = Buffer.from(BODY.toString('utf8').replace('pay_123', 'pay_666'), 'utf8');
    assert.equal(razorpay.verifyWebhookSignature(tampered, signature), false);
  }));

check('webhook — a missing signature is rejected, not waved through', () =>
  withEnv({ RAZORPAY_MODE: 'test', RAZORPAY_WEBHOOK_SECRET: SECRET }, () =>
    assert.equal(razorpay.verifyWebhookSignature(BODY, ''), false)));

check('webhook — a signature of the wrong length is rejected without throwing', () =>
  withEnv({ RAZORPAY_MODE: 'test', RAZORPAY_WEBHOOK_SECRET: SECRET }, () =>
    assert.equal(razorpay.verifyWebhookSignature(BODY, 'abc'), false)));

check('webhook — re-serialising the body breaks the signature', () =>
  withEnv({ RAZORPAY_MODE: 'test', RAZORPAY_WEBHOOK_SECRET: SECRET }, () => {
    // This is the bug the express.json({ verify }) hook exists to
    // prevent: JSON.stringify(JSON.parse(body)) is not byte-identical,
    // so verifying against it rejects genuine webhooks.
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(
      JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_123' } } } })
    )).replace('{"event"', '{ "event"'), 'utf8');
    assert.equal(razorpay.verifyWebhookSignature(reserialised, sign(BODY, SECRET)), false);
  }));

check('webhook — test mode with no secret configured accepts (dev convenience)', () =>
  withEnv({ RAZORPAY_MODE: 'test', RAZORPAY_WEBHOOK_SECRET: undefined }, () =>
    assert.equal(razorpay.verifyWebhookSignature(BODY, ''), true)));

check('webhook — live mode never accepts an unsigned request', () =>
  withEnv({
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_x',
    RAZORPAY_KEY_SECRET: 'secret',
    RAZORPAY_WEBHOOK_SECRET: SECRET,
  }, () => assert.equal(razorpay.verifyWebhookSignature(BODY, ''), false)));

// ─── Checkout signature verification ─────────────────────────────
// A different secret and a different payload from the webhook: the API
// key secret, over `order_id|payment_id`.

check('checkout — a correct signature is accepted', () =>
  withEnv({
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_x',
    RAZORPAY_KEY_SECRET: 'keysecret',
    RAZORPAY_WEBHOOK_SECRET: SECRET,
  }, () => {
    const signature = crypto.createHmac('sha256', 'keysecret').update('order_1|pay_1').digest('hex');
    assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature }), true);
  }));

check('checkout — a signature for a different order is rejected', () =>
  withEnv({
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_x',
    RAZORPAY_KEY_SECRET: 'keysecret',
    RAZORPAY_WEBHOOK_SECRET: SECRET,
  }, () => {
    const signature = crypto.createHmac('sha256', 'keysecret').update('order_2|pay_1').digest('hex');
    assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature }), false);
  }));

check('checkout — the webhook secret does not work as a checkout secret', () =>
  withEnv({
    RAZORPAY_MODE: 'live',
    RAZORPAY_KEY_ID: 'rzp_live_x',
    RAZORPAY_KEY_SECRET: 'keysecret',
    RAZORPAY_WEBHOOK_SECRET: SECRET,
  }, () => {
    const signature = crypto.createHmac('sha256', SECRET).update('order_1|pay_1').digest('hex');
    assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature }), false);
  }));

check('checkout — missing fields are rejected rather than treated as a match', () =>
  withEnv({ RAZORPAY_MODE: 'test' }, () => {
    assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'o', paymentId: 'p', signature: '' }), false);
    assert.equal(razorpay.verifyCheckoutSignature({}), false);
  }));

check('checkout — the stub signer round-trips in test mode', () =>
  withEnv({ RAZORPAY_MODE: 'test' }, () => {
    const signature = razorpay.signStubCheckout('order_9', 'pay_9');
    assert.equal(razorpay.verifyCheckoutSignature({ orderId: 'order_9', paymentId: 'pay_9', signature }), true);
  }));

// ─── Live configuration gate ─────────────────────────────────────

check('config — missingLiveConfig names every absent variable', () =>
  withEnv({
    RAZORPAY_KEY_ID: undefined,
    RAZORPAY_KEY_SECRET: undefined,
    RAZORPAY_WEBHOOK_SECRET: undefined,
  }, () => assert.deepEqual(razorpay.missingLiveConfig(),
    ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'])));

check('config — a blank value counts as missing', () =>
  withEnv({
    RAZORPAY_KEY_ID: '  ',
    RAZORPAY_KEY_SECRET: 'x',
    RAZORPAY_WEBHOOK_SECRET: 'y',
  }, () => assert.deepEqual(razorpay.missingLiveConfig(), ['RAZORPAY_KEY_ID'])));

check('config — assertLiveConfigured names what is missing in its message', () =>
  withEnv({
    RAZORPAY_KEY_ID: 'x',
    RAZORPAY_KEY_SECRET: 'y',
    RAZORPAY_WEBHOOK_SECRET: undefined,
  }, () => assert.throws(() => razorpay.assertLiveConfigured(), /RAZORPAY_WEBHOOK_SECRET/)));

check('config — the placeholder GSTIN is not accepted as configured', () => {
  const saved = config.HESYRA_GSTIN;
  config.HESYRA_GSTIN = config.GSTIN_PLACEHOLDER;
  try {
    assert.equal(config.isGstinConfigured(), false);
  } finally { config.HESYRA_GSTIN = saved; }
});

check('config — a well-formed GSTIN is accepted', () => {
  const saved = config.HESYRA_GSTIN;
  config.HESYRA_GSTIN = MH_GSTIN;
  try {
    assert.equal(config.isGstinConfigured(), true);
  } finally { config.HESYRA_GSTIN = saved; }
});

check('config — a malformed GSTIN is rejected', () => {
  const saved = config.HESYRA_GSTIN;
  try {
    config.HESYRA_GSTIN = '27ABC';
    assert.equal(config.isGstinConfigured(), false);
    config.HESYRA_GSTIN = '';
    assert.equal(config.isGstinConfigured(), false);
  } finally { config.HESYRA_GSTIN = saved; }
});

// ─── Report ──────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const f of failures) {
  console.log(`  FAIL  ${f.name}\n        ${f.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
