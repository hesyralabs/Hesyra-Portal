// ═══════════════════════════════════════════════════════════════
// MATERIAL CATALOGUE — real pricing
// Source: Hesyra Introductory Price List, July 2026 (Launch Edition),
// valid till 30 September 2026.
//
// All prices here are the NET, GST-EXCLUSIVE figures printed in the
// list. GST @5% is added on top at case creation — never bake it in.
// basePrice / premiumUpcharge are stored in paise.
// ═══════════════════════════════════════════════════════════════
const prisma = require('./lib/prisma');

const R = (rupees) => rupees * 100; // → paise

const SKUS = [
  // ─── Permanent crowns (per unit). Bridges bill per unit at the
  //     same tier — no span or framework surcharge, so the existing
  //     price × tooth-count rule is already correct. ──────────────
  { slug: 'hesyra_pro',       displayName: 'Hesyra PRO',       internalName: 'Ceramic-infused permanent resin',
    category: 'ceramic',  basePrice: R(950),  warrantyYears: 5,
    blurb: 'The everyday posterior workhorse',
    caseTypes: ['crown_bridge'], shadeApplicable: true,  finishingTiers: ['standard'], sortOrder: 1 },

  { slug: 'hesyra_signature', displayName: 'Hesyra SIGNATURE', internalName: 'Nano-hybrid ceramic',
    category: 'ceramic',  basePrice: R(1200), warrantyYears: 5,
    blurb: 'Ceramic-infused with an upgraded aesthetic surface finish',
    caseTypes: ['crown_bridge'], shadeApplicable: true,  finishingTiers: ['standard', 'premium'], sortOrder: 2 },

  { slug: 'hesyra_premium',   displayName: 'Hesyra PREMIUM',   internalName: 'Zirconia',
    category: 'zirconia', basePrice: R(1500), warrantyYears: 7,
    blurb: 'Zirconia-infused body for heavier occlusion and demanding cases',
    caseTypes: ['crown_bridge'], shadeApplicable: true,  finishingTiers: ['standard', 'premium'], sortOrder: 3 },

  { slug: 'hesyra_elite',     displayName: 'Hesyra ELITE',     internalName: 'Nano-hybrid zirconia',
    category: 'zirconia', basePrice: R(1800), warrantyYears: 10,
    blurb: 'Our flagship — zirconia-infused, maximum lifecycle',
    caseTypes: ['crown_bridge'], shadeApplicable: true,  finishingTiers: ['standard', 'premium'], sortOrder: 4 },

  // ─── Inlays & onlays (per unit) ──────────────────────────────
  { slug: 'inlay',  displayName: 'Inlay',  internalName: 'Printed intracoronal restoration',
    category: 'ceramic', basePrice: R(2000),
    blurb: 'Precision-fit intracoronal restoration, printed from your scan',
    caseTypes: ['inlay_onlay'], shadeApplicable: true, finishingTiers: ['standard'], sortOrder: 5 },

  { slug: 'onlay',  displayName: 'Onlay',  internalName: 'Printed cuspal-coverage restoration',
    category: 'ceramic', basePrice: R(2500),
    blurb: 'Cusp-covering restoration for teeth that deserve better than a full crown',
    caseTypes: ['inlay_onlay'], shadeApplicable: true, finishingTiers: ['standard'], sortOrder: 6 },

  // ─── Veneers ─────────────────────────────────────────────────
  // Classic is a 2-tooth base case at ₹3,000 then ₹1,200 per extra
  // tooth; that tiering is applied in the pricing engine, not here.
  { slug: 'veneer_classic',    displayName: 'Classic Veneer',    internalName: 'Ceramic-finish facing',
    category: 'ceramic', basePrice: R(3000), extraUnitPrice: R(1200), includedUnits: 2,
    blurb: 'Aesthetic ceramic-finish facings for anterior smile correction — shade-matched to the adjacent dentition',
    caseTypes: ['veneer'], shadeApplicable: true, finishingTiers: ['standard', 'premium'], sortOrder: 7 },

  { slug: 'veneer_ultra_thin', displayName: 'Ultra-Thin Veneer', internalName: '0.3–0.5 mm minimal-prep',
    category: 'ceramic', basePrice: R(1500),
    blurb: '0.3–0.5 mm minimal-prep veneers that preserve natural enamel',
    caseTypes: ['veneer'], shadeApplicable: true, finishingTiers: ['standard', 'premium'], sortOrder: 8 },

  // ─── Digital complete dentures (per set, upper + lower) ──────
  { slug: 'denture_signature', displayName: 'Signature Denture', internalName: 'Hi-impact printed base, standard teeth',
    category: 'acrylic', basePrice: R(12500),
    blurb: 'Digitally printed hi-impact base, standard teeth set',
    caseTypes: ['denture'], shadeApplicable: true, finishingTiers: ['standard'], sortOrder: 9 },

  { slug: 'denture_premium',   displayName: 'Premium Denture',   internalName: 'Premium teeth, gingival characterisation',
    category: 'acrylic', basePrice: R(14500),
    blurb: 'Premium teeth set with natural gingival characterisation',
    caseTypes: ['denture'], shadeApplicable: true, finishingTiers: ['standard'], sortOrder: 10 },

  { slug: 'denture_elite',     displayName: 'Elite Denture',     internalName: 'Full characterisation, try-in included',
    category: 'acrylic', basePrice: R(17000),
    blurb: 'Premium printed base and teeth, full characterisation — try-in included',
    caseTypes: ['denture'], shadeApplicable: true, finishingTiers: ['standard'], sortOrder: 11 },

  // ─── Retainers & appliances (per arch) ───────────────────────
  { slug: 'clear_retainer', displayName: 'Clear Retainer', internalName: 'Printed retention appliance',
    category: 'resin', basePrice: R(750),
    blurb: 'Post-treatment retention, printed to your final scan',
    caseTypes: ['retainer'], shadeApplicable: false, finishingTiers: ['standard'], sortOrder: 12 },

  // ─── Pedodontics ─────────────────────────────────────────────
  { slug: 'space_maintainer', displayName: '3D-Printed Space Maintainer', internalName: 'Metal-free shape-memory, both arches',
    category: 'resin', basePrice: R(1500),
    blurb: 'Metal-free, band-and-loop-free comfort — both arches',
    caseTypes: ['space_maintainer'], shadeApplicable: false, finishingTiers: ['standard'], sortOrder: 13 },

  // ─── Surgical guides (per guide) ─────────────────────────────
  // Priced by implant count in the pricing engine; basePrice is the
  // single-implant rate.
  { slug: 'surgical_guide', displayName: 'Surgical Guide', internalName: 'Autoclavable printed guide',
    category: 'resin', basePrice: R(2000),
    blurb: 'Autoclavable, printed from your approved implant plan and delivered surgery-ready',
    caseTypes: ['surgical_guide'], shadeApplicable: false, finishingTiers: ['standard'], sortOrder: 14 },

  // ─── Quote-on-request lines ──────────────────────────────────
  // Listed in the price list without a rate. They carry no basePrice,
  // so lib/pricing.js refuses to price them and the case is blocked
  // rather than silently billed at zero.
  { slug: 'posterior_bite_block', displayName: 'Posterior Bite Block', internalName: 'Printed bite-raising appliance',
    category: 'resin', basePrice: null,
    blurb: 'Printed posterior bite-raising appliance, fabricated to your plan',
    caseTypes: ['posterior_bite_block'], shadeApplicable: false, finishingTiers: ['standard'], sortOrder: 15 },

  { slug: 'pediatric_aligner', displayName: 'Pediatric Aligner', internalName: 'Direct-printed pediatric aligner system',
    category: 'resin', basePrice: null,
    blurb: 'Shape-memory aligners with built-in posterior bite blocks — arch development and deep-bite correction in one appliance',
    caseTypes: ['pediatric_aligner'], shadeApplicable: false, finishingTiers: ['standard'], sortOrder: 16 },
];

async function run() {
  console.log('\n🎨 Loading Hesyra price list (July 2026) into the catalogue...\n');

  // Retire anything not in the published list rather than deleting it —
  // historic cases still reference these rows.
  const keep = SKUS.map(s => s.slug);
  const retired = await prisma.materialSKU.updateMany({
    where: { slug: { notIn: keep } },
    data: { active: false },
  });
  if (retired.count) console.log(`  ⚠️  ${retired.count} legacy SKU(s) marked inactive`);

  for (const s of SKUS) {
    const data = {
      displayName:  s.displayName,
      internalName: s.internalName,
      category:     s.category,
      basePrice:     s.basePrice ?? null,
      warrantyYears: s.warrantyYears ?? null,
      caseTypes:       JSON.stringify(s.caseTypes),
      finishingTiers:  JSON.stringify(s.finishingTiers),
      shadeApplicable: s.shadeApplicable,
      sortOrder:    s.sortOrder,
      active:       true,
    };
    await prisma.materialSKU.upsert({
      where:  { slug: s.slug },
      create: { slug: s.slug, ...data },
      update: data,
    });
    const price = s.basePrice ? `₹${(s.basePrice / 100).toLocaleString('en-IN')}` : 'quote on request';
    const warranty = s.warrantyYears ? `  ${s.warrantyYears}yr warranty` : '';
    console.log(`  ✓ ${s.displayName.padEnd(30)} ${price.padEnd(18)}${warranty}`);
  }

  console.log(`\n✅ ${SKUS.length} SKUs loaded. All prices exclusive of GST @5%.\n`);
}

run()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
