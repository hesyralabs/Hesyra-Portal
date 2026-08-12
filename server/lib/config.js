// ═══════════════════════════════════════════════════════════════════
// Hesyra Payment System — Centralized Configuration
// All payment constants in one place. Admin-configurable in V2.
// ═══════════════════════════════════════════════════════════════════

module.exports = {
  // ─── Deposit amounts (paise) for striked accounts ──────────
  DEPOSIT_AMOUNTS: {
    strike_1: 20000,  // ₹200
    strike_2: 50000,  // ₹500
  },

  // ─── Wallet config ─────────────────────────────────────────
  WALLET_MIN_RELOAD_PAISE:     100000,   // ₹1,000 minimum reload
  WALLET_LOW_BALANCE_PAISE:    200000,   // ₹2,000 — trigger low balance alert
  WALLET_BONUS_THRESHOLD_PAISE: 1000000, // ₹10,000 — bonus eligibility
  WALLET_BONUS_AMOUNT_PAISE:   50000,    // ₹500 bonus credit
  WALLET_BONUS_ENABLED:        true,     // Toggle by admin

  // ─── Doctor design approval SLA ───────────────────────────
  // How long the ordering doctor has to sign off on a CAD design before
  // the case resolves itself. Kept short — the lab bench is idle while
  // this clock runs, and a crown that waits days for a click is the most
  // common cause of a blown turnaround promise.
  DESIGN_APPROVAL_SLA_HOURS:          24,
  DESIGN_APPROVAL_SLA_HOURS_PRIORITY: 6,   // Express cases
  // Fractions of the window at which the doctor gets nudged (0.25 = 6h
  // into a 24h window). Reminders stop once they act.
  DESIGN_APPROVAL_REMINDER_POINTS:    [0.25, 0.75],

  // ─── Work that never auto-approves ────────────────────────
  // A clinic can opt in to auto-approval so an unanswered design keeps
  // moving. These two carve-outs override that preference, because the
  // cost of printing something the doctor never looked at is not
  // symmetric with the cost of a day's delay.
  //
  // A surgical guide drills into bone against a plan — a wrong one is a
  // misplaced implant, not a remake. Above the value ceiling, a remake
  // is expensive enough that a human should look first. Neither is
  // abandoned: both escalate to the lab manager instead.
  AUTO_APPROVE_EXCLUDED_CASE_TYPES: ['surgical_guide'],
  AUTO_APPROVE_MAX_VALUE_PAISE:     2000000,   // ₹20,000 incl. GST

  // ─── Ceramic finishing ────────────────────────────────────
  // Which case types pass the ceramist's bench after printing.
  //
  // This used to be decided by `finishingTier === 'premium'` alone —
  // the Signature Match upsell — so a lab that had never sold one saw
  // every case route straight to QC and the ceramist queue stayed
  // permanently empty. Tier decides how MUCH finishing (hand-stained
  // characterisation vs. studio glaze and polish), not WHETHER there is
  // any: a printed zirconia crown needs glazing before QC either way.
  //
  // Everything absent from this list is thermoformed, printed or milled
  // plastic with no ceramic stage — aligners, retainers, splints,
  // surgical guides, space maintainers — and goes print → QC → pack.
  CERAMIC_FINISHING_CASE_TYPES: ['crown_bridge', 'veneer', 'denture', 'inlay_onlay'],

  // ─── Designer ↔ dentist direct channel ────────────────────
  // Most case types are a handoff: the dentist sends a prescription and
  // the lab sends back a crown, and anything in between goes through
  // the lab's own chat. An aligner plan is not that — it is a course of
  // treatment the designer and the dentist agree on, over several
  // rounds, before anything is printed. Routing that through the lab
  // adds a relay to every exchange.
  //
  // These case types let the assigned CAD designer message the ordering
  // dentist directly, and share treatment-plan video and photographs
  // the dentist can see on the case. Adding a case type here switches
  // both on for it; nothing else needs to change.
  DESIGNER_DIRECT_CHAT_CASE_TYPES: ['aligner'],
  TREATMENT_PLAN_CASE_TYPES:       ['aligner'],

  // What a designer may share as a treatment plan. Video is the point —
  // a stepped aligner sequence is a motion, and a still of it is a
  // still of one step.
  TREATMENT_PLAN_MAX_BYTES:  200 * 1024 * 1024,   // 200 MB
  TREATMENT_PLAN_MIMETYPES: [
    'video/mp4', 'video/quicktime', 'video/webm',
    'image/jpeg', 'image/png', 'image/webp',
  ],

  // ─── Strike system ────────────────────────────────────────
  STRIKE_DAYS_THRESHOLD:  7,    // Days after READY before strike
  REMINDER_DAYS:          [2, 5, 6], // Days to send reminders
  MAX_STRIKES:            3,
  PERMANENT_BAN_STRIKES:  6,    // Second suspension = permanent ban

  // ─── GST & Invoice ────────────────────────────────────────
  // Published prices are exclusive of GST; it is added on top.
  // (Hesyra Introductory Price List, July 2026.)
  //
  // GST_RATE is the default for dental prosthetics. It is NOT the only
  // rate: clear aligners are taxed differently, so never reach for
  // GST_RATE directly when a case type is in hand — call gstRateFor()
  // instead. Reading the constant is how a case gets taxed at the
  // wrong rate, and a wrong rate means a credit note and a reissue.
  GST_RATE:       0.05,        // 5% — dental prosthetics
  HSN_CODE:       '9021',      // Dental prosthetics

  // Case types whose GST differs from the default. Anything absent
  // from this table is taxed at GST_RATE.
  GST_RATE_BY_CASE_TYPE: {
    aligner: 0.08,   // 8% — clear aligners
  },

  /**
   * The GST rate that applies to a case type.
   * Falls back to the prosthetics rate for anything unlisted.
   */
  gstRateFor(caseType) {
    const rate = this.GST_RATE_BY_CASE_TYPE[caseType];
    return rate === undefined ? this.GST_RATE : rate;
  },

  // The registration the invoices are issued under. Its first two
  // digits are the state code, and resolveTaxTreatment() reads them to
  // decide CGST+SGST vs IGST — so this is not just a string printed on
  // a PDF, it drives which tax is charged.
  //
  // The placeholder below is deliberately invalid. GSTIN_PLACEHOLDER
  // and isGstinConfigured() exist so the app can refuse to issue a tax
  // invoice against it rather than emit an unusable document.
  HESYRA_GSTIN:   process.env.HESYRA_GSTIN || '27XXXXX0000X1Z5',
  GSTIN_PLACEHOLDER: '27XXXXX0000X1Z5',
  isGstinConfigured() {
    const g = String(this.HESYRA_GSTIN || '').trim();
    // A real GSTIN is 15 characters: 2 state digits, a 10-character
    // PAN, an entity digit, 'Z', and a checksum character.
    return Boolean(g) && g !== this.GSTIN_PLACEHOLDER && /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g);
  },

  // Printed on every invoice. Kept in config rather than inline in the
  // invoice builder so the registered address has exactly one home.
  HESYRA_LEGAL_NAME: process.env.HESYRA_LEGAL_NAME || 'Hesyra Labs',
  HESYRA_ADDRESS:    process.env.HESYRA_ADDRESS    || 'Nagpur, Maharashtra, India',

  // ─── Pricing (paise) — mirrored from cases.js ─────────────
  CASE_PRICING_PAISE: {
    crown_bridge:    150000,  // ₹1,500
    surgical_guide:  300000,  // ₹3,000
    splint:          180000,  // ₹1,800
    retainer:        120000,  // ₹1,200
    aligner:         250000,  // ₹2,500
    denture:         450000,  // ₹4,500
    model:           40000,   // ₹400
    default:         100000,  // ₹1,000
  },

  // ─── Trust levels ──────────────────────────────────────────
  TRUST_LEVELS: {
    CLEAN:     'clean',
    STRIKE_1:  'strike_1',
    STRIKE_2:  'strike_2',
    SUSPENDED: 'suspended',
    BANNED:    'banned',
  },

  // ─── Payment modes ────────────────────────────────────────
  PAYMENT_MODES: {
    PAY_ON_GO: 'pay_on_go',
    WALLET:    'wallet',
  },

  // ─── Billing modes (per clinic account) ──────────────────
  // 'prepaid' = pay before dispatch (default, existing behaviour)
  // 'net_30'  = dispatch on credit, consolidated invoice at month-end
  BILLING_MODES: {
    PREPAID: 'prepaid',
    NET_30:  'net_30',
  },

  // ─── Credit terms config ──────────────────────────────────
  DEFAULT_CREDIT_LIMIT_PAISE: 5000000,  // ₹50,000 starting limit
  CREDIT_PAYMENT_DAYS:        30,        // Days from invoice date to pay
  // Days AFTER invoice generation to send reminders
  CREDIT_REMINDER_DAYS: [7, 21, 27],
  // After this many days without payment, apply a strike and downgrade to prepaid
  CREDIT_STRIKE_DAYS: 30,

  // ─── Transaction types ─────────────────────────────────────
  TX_TYPES: {
    LOAD:              'LOAD',
    ORDER_DEDUCT:      'ORDER_DEDUCT',
    DEPOSIT_DEDUCT:    'DEPOSIT_DEDUCT',
    REFUND:            'REFUND',
    BONUS_CREDIT:      'BONUS_CREDIT',
    MANUAL_ADJUSTMENT: 'MANUAL_ADJUSTMENT',
    CREDIT_DISPATCH:   'CREDIT_DISPATCH',   // Case dispatched on credit (tab goes up)
    CREDIT_PAYMENT:    'CREDIT_PAYMENT',    // Monthly invoice settled (tab goes down)
  },

  // ─── Paise ↔ INR helpers ──────────────────────────────────
  paiseToINR: (paise) => (paise / 100).toFixed(2),
  inrToPaise: (inr) => Math.round(inr * 100),
};
