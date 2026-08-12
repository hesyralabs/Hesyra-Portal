// ═══════════════════════════════════════════════════════════════════
// PRICING TEST SUITE
//
// Every figure below is quoted from the Hesyra Introductory Price List,
// July 2026 (Launch Edition). If a test here fails, either the price
// list changed — in which case update BOTH this file and the source it
// cites — or lib/pricing.js has drifted from the published prices the
// clinic was promised.
//
// Pure functions only: no database, no server, no network.
//
//   node server/test/pricing.test.js
// ═══════════════════════════════════════════════════════════════════
const assert = require('node:assert/strict');
const pricing = require('../lib/pricing');
const config = require('../lib/config');

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

// Prices are all whole rupees in the published list.
const R = (rupees) => rupees * 100;

// Minimal MaterialSKU stand-ins — quoteNet only reads these fields.
const sku = (slug, displayName, basePrice, premiumUpcharge = 0) =>
  ({ slug, displayName, basePrice, premiumUpcharge });

const PRO       = sku('crown_pro',       'Hesyra PRO',       R(950));
const SIGNATURE = sku('crown_signature', 'Hesyra SIGNATURE', R(1200));
const PREMIUM   = sku('crown_premium',   'Hesyra PREMIUM',   R(1500));
const ELITE     = sku('crown_elite',     'Hesyra ELITE',     R(1800));

const net = (input) => pricing.quoteNet(input).netPaise;

// ─── Crowns, per unit ────────────────────────────────────────────
check('crown — PRO is ₹950/unit', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: PRO, toothCount: 1 }), R(950)));

check('crown — SIGNATURE is ₹1,200/unit', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: SIGNATURE, toothCount: 1 }), R(1200)));

check('crown — PREMIUM is ₹1,500/unit', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: PREMIUM, toothCount: 1 }), R(1500)));

check('crown — ELITE is ₹1,800/unit', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: ELITE, toothCount: 1 }), R(1800)));

// A bridge bills per unit at the same tier — no span or framework charge.
check('bridge — 3 units of PREMIUM is 3 × ₹1,500, no span surcharge', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: PREMIUM, toothCount: 3 }), R(4500)));

check('crown — zero teeth still bills one unit', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: PRO, toothCount: 0 }), R(950)));

// ─── Inlays and onlays, per unit ─────────────────────────────────
check('inlay — ₹2,000/unit', () =>
  assert.equal(net({ caseType: 'inlay_onlay', sku: sku('inlay', 'Inlay', R(2000)), toothCount: 1 }), R(2000)));

check('onlay — ₹2,500/unit, ×2', () =>
  assert.equal(net({ caseType: 'inlay_onlay', sku: sku('onlay', 'Onlay', R(2500)), toothCount: 2 }), R(5000)));

// ─── Veneers ─────────────────────────────────────────────────────
// Classic: ₹3,000 covers 2 teeth, then ₹1,200 per extra tooth.
check('veneer classic — 2 teeth is the ₹3,000 base', () =>
  assert.equal(net({ caseType: 'veneer', sku: sku('veneer_classic', 'Classic Veneer', 0), toothCount: 2 }), R(3000)));

check('veneer classic — 1 tooth still pays the 2-tooth base', () =>
  assert.equal(net({ caseType: 'veneer', sku: sku('veneer_classic', 'Classic Veneer', 0), toothCount: 1 }), R(3000)));

check('veneer classic — 4 teeth is ₹3,000 + 2 × ₹1,200', () =>
  assert.equal(net({ caseType: 'veneer', sku: sku('veneer_classic', 'Classic Veneer', 0), toothCount: 4 }), R(5400)));

check('veneer ultra-thin — ₹1,500/tooth from the first', () =>
  assert.equal(net({ caseType: 'veneer', sku: sku('veneer_ultra_thin', 'Ultra-Thin', 0), toothCount: 6 }), R(9000)));

// ─── Dentures, per set ───────────────────────────────────────────
check('denture SIGNATURE — ₹12,500/set', () =>
  assert.equal(net({ caseType: 'denture', sku: sku('denture_signature', 'Signature Denture', R(12500)) }), R(12500)));

check('denture PREMIUM — ₹14,500/set', () =>
  assert.equal(net({ caseType: 'denture', sku: sku('denture_premium', 'Premium Denture', R(14500)) }), R(14500)));

check('denture ELITE — ₹17,000/set', () =>
  assert.equal(net({ caseType: 'denture', sku: sku('denture_elite', 'Elite Denture', R(17000)) }), R(17000)));

// A denture is priced per set, so tooth count must not multiply it.
check('denture — priced per set, not per tooth', () =>
  assert.equal(net({ caseType: 'denture', sku: sku('denture_elite', 'Elite Denture', R(17000)), toothCount: 14 }), R(17000)));

// ─── Retainers and paediatric ────────────────────────────────────
check('clear retainer — ₹750 per arch', () =>
  assert.equal(net({ caseType: 'retainer', sku: sku('retainer_clear', 'Clear Retainer', R(750)) }), R(750)));

check('space maintainer — ₹1,500 both arches', () =>
  assert.equal(net({ caseType: 'space_maintainer', sku: sku('space_maintainer', 'Space Maintainer', R(1500)) }), R(1500)));

// ─── Surgical guides, by implant count ───────────────────────────
const guide = (n, vsp = false) =>
  net({ caseType: 'surgical_guide', implantCount: n, virtualSurgicalPlan: vsp });

check('guide — 1 implant is ₹2,000', () => assert.equal(guide(1), R(2000)));
check('guide — 2 implants is ₹2,250', () => assert.equal(guide(2), R(2250)));
check('guide — 3 implants is ₹2,500', () => assert.equal(guide(3), R(2500)));
check('guide — 4 implants is ₹2,750', () => assert.equal(guide(4), R(2750)));
check('guide — 5 implants is ₹3,000', () => assert.equal(guide(5), R(3000)));
check('guide — 6 implants is ₹3,250', () => assert.equal(guide(6), R(3250)));

check('guide — VSP adds ₹1,500', () =>
  assert.equal(guide(3, true), R(2500) + R(1500)));

check('guide — above 6 implants is full-arch, quoted on request', () =>
  assert.throws(() => guide(7), (e) => e instanceof pricing.PricingError && e.details.quoteOnRequest === true));

check('guide — implant count is required', () =>
  assert.throws(() => net({ caseType: 'surgical_guide' }), pricing.PricingError));

// ─── Clear aligners, per case by tier ────────────────────────────
const aligner = (alignerTier, extra = 0, archTarget = 'both') =>
  net({ caseType: 'aligner', alignerTier, extraAlignerSets: extra, archTarget });

check('aligner Flexi — ₹3,200 per set, billed per set', () =>
  assert.equal(aligner('flexi', 1), R(3200)));

check('aligner Flexi — 3 sets is 3 × ₹3,200', () =>
  assert.equal(aligner('flexi', 3), R(9600)));

check('aligner Standard — ₹36,000 for 10 sets', () =>
  assert.equal(aligner('standard'), R(36000)));

check('aligner Standard — extra sets are ₹2,500 each', () =>
  assert.equal(aligner('standard', 2), R(36000) + R(5000)));

check('aligner Premium — ₹51,000 for 15 sets', () =>
  assert.equal(aligner('premium'), R(51000)));

check('aligner Premium — extra sets are ₹2,000 each', () =>
  assert.equal(aligner('premium', 3), R(51000) + R(6000)));

check('aligner Elite — ₹65,000 for 20 sets', () =>
  assert.equal(aligner('elite'), R(65000)));

check('aligner Elite — extra sets are ₹1,800 each', () =>
  assert.equal(aligner('elite', 2), R(65000) + R(3600)));

check('aligner Executive — ₹91,000 for both arches', () =>
  assert.equal(aligner('executive', 0, 'both'), R(91000)));

check('aligner Executive — ₹70,000 for a single arch', () =>
  assert.equal(aligner('executive', 0, 'upper'), R(70000)));

check('aligner — a tier must be chosen', () =>
  assert.throws(() => net({ caseType: 'aligner' }), pricing.PricingError));

// ─── Quote-on-request categories are refused, not zero-priced ────
for (const [caseType, label] of Object.entries(pricing.QUOTE_ON_REQUEST)) {
  check(`${caseType} — refused as quote-on-request, never priced at zero`, () => {
    assert.throws(() => net({ caseType, sku: PRO }), (e) =>
      e instanceof pricing.PricingError && e.details.quoteOnRequest === true);
    assert.ok(label.length > 0, 'must carry a message for the clinic');
  });
}

// ─── Missing material is an error, not a free case ───────────────
check('crown — no material selected is refused', () =>
  assert.throws(() => net({ caseType: 'crown_bridge' }), pricing.PricingError));

// ─── Signature Match finishing ───────────────────────────────────
const PREMIUM_WITH_UPCHARGE = sku('crown_premium', 'Hesyra PREMIUM', R(1500), R(199));

check('finishing — standard tier adds nothing', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: PREMIUM_WITH_UPCHARGE, toothCount: 1, finishingTier: 'standard' }), R(1500)));

check('finishing — Signature Match is a flat upcharge on a single crown', () =>
  assert.equal(net({ caseType: 'crown_bridge', sku: PREMIUM_WITH_UPCHARGE, toothCount: 1, finishingTier: 'premium' }), R(1500) + R(199)));

check('finishing — a bridge scales the upcharge per unit', () => {
  const perUnit = Math.round(R(199) * (120 / 199));
  assert.equal(
    net({ caseType: 'crown_bridge', sku: PREMIUM_WITH_UPCHARGE, toothCount: 3, specificType: 'Multi-Unit Bridge', finishingTier: 'premium' }),
    R(1500) * 3 + perUnit * 3
  );
});

// ─── GST is added on top, once, at the bottom ────────────────────
// The rate is not universal: dental prosthetics are 5%, clear aligners
// are 8%. Anything that reads config.GST_RATE while holding a case type
// taxes aligners wrongly, so these tests pin both.
check('GST — dental prosthetics are 5%', () => assert.equal(config.GST_RATE, 0.05));

check('GST — clear aligners are 8%', () => assert.equal(config.gstRateFor('aligner'), 0.08));

check('GST — an unlisted case type falls back to the prosthetics rate', () => {
  assert.equal(config.gstRateFor('crown_bridge'), 0.05);
  assert.equal(config.gstRateFor('surgical_guide'), 0.05);
  assert.equal(config.gstRateFor('retainer'), 0.05);
  assert.equal(config.gstRateFor(undefined), 0.05);
});

check('quoteCase — GST is added on top of the net, not carved out of it', () => {
  const q = pricing.quoteCase({ caseType: 'crown_bridge', sku: PREMIUM, toothCount: 1 });
  assert.equal(q.netPaise, R(1500));
  assert.equal(q.gstPaise, R(75));
  assert.equal(q.totalPaise, R(1575));
});

check('quoteCase — a Standard aligner case is taxed at 8%, not 5%', () => {
  const q = pricing.quoteCase({ caseType: 'aligner', alignerTier: 'standard' });
  assert.equal(q.netPaise, R(36000));
  assert.equal(q.gstRate, 0.08);
  assert.equal(q.gstPaise, R(2880));
  assert.equal(q.totalPaise, R(38880));
});

check('quoteCase — an Executive aligner case is taxed at 8%', () => {
  const q = pricing.quoteCase({ caseType: 'aligner', alignerTier: 'executive' });
  assert.equal(q.netPaise, R(91000));
  assert.equal(q.gstPaise, R(7280));
  assert.equal(q.totalPaise, R(98280));
});

check('quoteCase — a retainer is NOT an aligner and stays at 5%', () => {
  const q = pricing.quoteCase({
    caseType: 'retainer',
    sku: sku('retainer_clear', 'Clear Retainer', R(750)),
  });
  assert.equal(q.netPaise, R(750));
  assert.equal(q.gstRate, 0.05);
  assert.equal(q.gstPaise, Math.round(R(750) * 0.05));
});

check('quoteCase — the rate charged is reported back with the quote', () => {
  assert.equal(pricing.quoteCase({ caseType: 'aligner', alignerTier: 'premium' }).gstRate, 0.08);
  assert.equal(pricing.quoteCase({ caseType: 'crown_bridge', sku: PRO, toothCount: 1 }).gstRate, 0.05);
});

check('quoteCase — total is always net + GST across a multi-line quote', () => {
  const q = pricing.quoteCase({ caseType: 'surgical_guide', implantCount: 4, virtualSurgicalPlan: true });
  assert.equal(q.lines.length, 2);
  assert.equal(q.netPaise, R(2750) + R(1500));
  assert.equal(q.totalPaise, q.netPaise + q.gstPaise);
  assert.equal(q.gstPaise, Math.round(q.netPaise * 0.05));
});

check('quoteCase — line amounts always sum to netPaise', () => {
  const q = pricing.quoteCase({ caseType: 'veneer', sku: sku('veneer_classic', 'Classic Veneer', 0), toothCount: 5 });
  assert.equal(q.lines.reduce((s, l) => s + l.amountPaise, 0), q.netPaise);
});

// ─── Report ──────────────────────────────────────────────────────
console.log(`\n  ${passed} passed, ${failures.length} failed\n`);
for (const f of failures) {
  console.log(`  FAIL  ${f.name}\n        ${f.message.split('\n')[0]}`);
}
process.exit(failures.length ? 1 : 0);
