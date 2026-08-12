// ═══════════════════════════════════════════════════════════════
// CASE PRICING ENGINE
// Source of truth: Hesyra Introductory Price List, July 2026
// (Launch Edition) — valid till 30 September 2026.
//
// Every published price is NET of GST. This module returns the net
// figure plus an itemised breakdown; GST @5% is applied once, at the
// bottom, by quoteCase(). Nothing else in the codebase should be doing
// its own price arithmetic.
//
// All money is in paise.
// ═══════════════════════════════════════════════════════════════
const config = require('./config');

const R = (rupees) => rupees * 100;

// ─── Clear aligners — billed per case by treatment tier ────────
// Not a material choice, so these are plans rather than SKUs.
const ALIGNER_TIERS = {
  flexi: {
    label: 'Flexi (Relapse)',
    note: 'Minor relapse & anterior corrections — billed per set',
    perSetPaise: R(3200),
    includedSets: 0,
    payPerSet: true,
  },
  standard: {
    label: 'Standard (Mild)',
    note: 'Shape-memory treatment to your approved plan · 2 refinements included',
    casePaise: R(36000), includedSets: 10, extraSetPaise: R(2500),
  },
  premium: {
    label: 'Premium (Moderate)',
    note: 'Everything in Standard, plus 3 refinements and the Hesyra App',
    casePaise: R(51000), includedSets: 15, extraSetPaise: R(2000),
  },
  elite: {
    label: 'Elite (Complicated)',
    note: 'Everything in Premium, plus 5 refinements and bruxer-grade material',
    casePaise: R(65000), includedSets: 20, extraSetPaise: R(1800),
  },
  executive: {
    label: 'Executive (Unlimited)',
    note: 'Unlimited refinements and free treatment-planner consultations',
    bothArchPaise: R(91000), perArchPaise: R(70000), unlimited: true,
  },
};

// ─── Surgical guides — billed by implant count, per guide ──────
const GUIDE_PRICE_BY_IMPLANTS = {
  1: R(2000), 2: R(2250), 3: R(2500),
  4: R(2750), 5: R(3000), 6: R(3250),
};
const GUIDE_MAX_PRICED_IMPLANTS = 6; // beyond this: full-arch, quoted manually
const VSP_ADDON_PAISE = R(1500);

// ─── Veneers — base case then per additional tooth ─────────────
const VENEER_RULES = {
  veneer_classic:    { includedUnits: 2, basePaise: R(3000), extraUnitPaise: R(1200) },
  veneer_ultra_thin: { includedUnits: 0, basePaise: 0,        extraUnitPaise: R(1500) },
};

// ─── Categories we cannot price yet ────────────────────────────
// Listed in the price list as "launching soon" / "contact us", so an
// order must not be priced at zero and quietly accepted.
const QUOTE_ON_REQUEST = {
  splint: 'Splints & nightguards are launching soon — contact the lab for a quote.',
  pediatric_aligner: 'Pediatric aligners are quoted per case — contact the lab.',
  posterior_bite_block: 'Posterior bite blocks are quoted per case — contact the lab.',
};

class PricingError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'PricingError';
    this.details = details;
  }
}

/**
 * Net price for a case, before GST.
 * Returns { netPaise, lines: [{ label, amountPaise }] }
 */
function quoteNet({
  caseType,
  sku,                 // MaterialSKU row (may be null)
  toothCount = 1,
  archTarget = 'both',
  implantCount,
  virtualSurgicalPlan = false,
  alignerTier,
  extraAlignerSets = 0,
  specificType,
  finishingTier = 'standard',
}) {
  const lines = [];

  if (QUOTE_ON_REQUEST[caseType]) {
    throw new PricingError(QUOTE_ON_REQUEST[caseType], { quoteOnRequest: true, caseType });
  }

  // ─── Clear aligners ──────────────────────────────────────────
  if (caseType === 'aligner') {
    const tier = ALIGNER_TIERS[alignerTier];
    if (!tier) {
      throw new PricingError('Select an aligner treatment tier.', {
        field: 'alignerTier', options: Object.keys(ALIGNER_TIERS),
      });
    }

    if (tier.unlimited) {
      const both = archTarget === 'both';
      const amount = both ? tier.bothArchPaise : tier.perArchPaise;
      lines.push({ label: `${tier.label} — ${both ? 'both arches' : 'single arch'}`, amountPaise: amount });
    } else if (tier.payPerSet) {
      const sets = Math.max(Number(extraAlignerSets) || 0, 1);
      lines.push({ label: `${tier.label} — ${sets} set${sets > 1 ? 's' : ''}`, amountPaise: tier.perSetPaise * sets });
    } else {
      lines.push({ label: `${tier.label} — ${tier.includedSets} sets included`, amountPaise: tier.casePaise });
      const extra = Math.max(Number(extraAlignerSets) || 0, 0);
      if (extra > 0) {
        lines.push({ label: `${extra} extra set${extra > 1 ? 's' : ''}`, amountPaise: tier.extraSetPaise * extra });
      }
    }
    return total(lines);
  }

  // ─── Surgical guides ─────────────────────────────────────────
  if (caseType === 'surgical_guide') {
    const n = Number(implantCount);
    if (!Number.isInteger(n) || n < 1) {
      throw new PricingError('Enter how many implants this guide covers.', { field: 'implantCount' });
    }
    if (n > GUIDE_MAX_PRICED_IMPLANTS) {
      throw new PricingError(
        'Full-arch and edentulous guides are quoted individually — please contact the lab.',
        { quoteOnRequest: true, field: 'implantCount' }
      );
    }
    lines.push({ label: `Surgical guide — ${n} implant${n > 1 ? 's' : ''}`, amountPaise: GUIDE_PRICE_BY_IMPLANTS[n] });
    if (virtualSurgicalPlan) {
      lines.push({ label: 'Virtual surgical planning', amountPaise: VSP_ADDON_PAISE });
    }
    return total(lines);
  }

  // ─── Veneers ─────────────────────────────────────────────────
  if (caseType === 'veneer') {
    const rule = VENEER_RULES[sku?.slug];
    if (!rule) throw new PricingError('Select a veneer type.', { field: 'materialSkuId' });

    const units = Math.max(Number(toothCount) || 0, 1);
    if (rule.includedUnits > 0) {
      lines.push({
        label: `${sku.displayName} — base case (${rule.includedUnits} teeth)`,
        amountPaise: rule.basePaise,
      });
      const extra = Math.max(units - rule.includedUnits, 0);
      if (extra > 0) {
        lines.push({
          label: `${extra} additional ${extra > 1 ? 'teeth' : 'tooth'}`,
          amountPaise: rule.extraUnitPaise * extra,
        });
      }
    } else {
      lines.push({ label: `${sku.displayName} × ${units}`, amountPaise: rule.extraUnitPaise * units });
    }
    addFinishing(lines, sku, finishingTier, units, false);
    return total(lines);
  }

  // ─── Everything else: per-unit SKU pricing ───────────────────
  if (!sku?.basePrice) {
    throw new PricingError('Select a material for this case.', { field: 'materialSkuId' });
  }

  // Crowns and bridges bill per unit at the chosen tier — a 3-unit
  // bridge is simply 3 × the crown price, no span or framework charge.
  const perUnitTypes = ['crown_bridge', 'inlay_onlay'];
  const units = perUnitTypes.includes(caseType) ? Math.max(Number(toothCount) || 0, 1) : 1;

  lines.push({
    label: units > 1 ? `${sku.displayName} × ${units} units` : sku.displayName,
    amountPaise: sku.basePrice * units,
  });

  addFinishing(lines, sku, finishingTier, units, specificType === 'Multi-Unit Bridge');
  return total(lines);
}

function addFinishing(lines, sku, finishingTier, units, isBridge) {
  if (finishingTier !== 'premium' || !sku?.premiumUpcharge) return;
  // Bridges scale the upcharge per unit; everything else is flat.
  const amount = isBridge
    ? Math.round(sku.premiumUpcharge * (120 / 199)) * units
    : sku.premiumUpcharge;
  lines.push({ label: 'Signature Match finishing', amountPaise: amount });
}

function total(lines) {
  return { netPaise: lines.reduce((s, l) => s + l.amountPaise, 0), lines };
}

/**
 * Full quote including GST. This is what case creation should call.
 *
 * The rate depends on what is being made — clear aligners are taxed at
 * 8%, dental prosthetics at 5% — so it is resolved from the case type
 * rather than read off a single constant. `gstRate` is returned with
 * the quote so callers can show and store the rate that was actually
 * charged instead of assuming the default.
 */
function quoteCase(input) {
  const { netPaise, lines } = quoteNet(input);
  const gstRate = config.gstRateFor(input.caseType);
  const gstPaise = Math.round(netPaise * gstRate);
  return {
    lines,
    netPaise,
    gstPaise,
    gstRate,
    totalPaise: netPaise + gstPaise,
  };
}

module.exports = {
  quoteCase,
  quoteNet,
  PricingError,
  ALIGNER_TIERS,
  GUIDE_PRICE_BY_IMPLANTS,
  GUIDE_MAX_PRICED_IMPLANTS,
  VSP_ADDON_PAISE,
  VENEER_RULES,
  QUOTE_ON_REQUEST,
};
