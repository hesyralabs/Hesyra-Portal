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

  // ─── Strike system ────────────────────────────────────────
  STRIKE_DAYS_THRESHOLD:  7,    // Days after READY before strike
  REMINDER_DAYS:          [2, 5, 6], // Days to send reminders
  MAX_STRIKES:            3,
  PERMANENT_BAN_STRIKES:  6,    // Second suspension = permanent ban

  // ─── GST & Invoice ────────────────────────────────────────
  // Published prices are exclusive of GST; 5% is added on top.
  // (Hesyra Introductory Price List, July 2026.)
  GST_RATE:       0.05,        // 5%
  HSN_CODE:       '9021',      // Dental prosthetics
  HESYRA_GSTIN:   '27XXXXX0000X1Z5', // Placeholder — set in production

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
