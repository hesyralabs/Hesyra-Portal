// ═══════════════════════════════════════════════════════════════
// SCAN DAY LAUNCH OFFER
//
// From the price list:
//   "Our intra oral scanner comes to you. Your chairside cases become
//    crown orders on the spot.
//      5 CROWN ORDERS  in a single scan visit        → +1 CROWN FREE
//      20 CROWN ORDERS within one week of your visit → +5 CROWNS FREE
//    Complimentary crowns are issued in the same tier as those ordered
//    (the most-ordered tier where mixed). The +1 reward applies to
//    orders placed during the scan visit; the +5 reward applies to 20
//    orders placed within seven days of that visit. Not exchangeable
//    for cash or credit."
//
// Credits are therefore a redeemable entitlement against a future
// crown, never money — see the CrownCredit model.
// ═══════════════════════════════════════════════════════════════
const prisma = require('./prisma');

const QUALIFY_DAYS = 7;

// [ordersRequired, crownsAwarded] — evaluated highest-first so a clinic
// that jumps straight past 20 receives both tiers of the reward.
const REWARD_TIERS = [
  { orders: 5,  crowns: 1, reason: '5 crown orders from a Scan Day visit' },
  { orders: 20, crowns: 5, reason: '20 crown orders within a week of a Scan Day visit' },
];

async function nextVisitId() {
  const now = new Date();
  const prefix = `SV-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const n = await prisma.scanVisit.count({ where: { customId: { startsWith: prefix } } });
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
}

/**
 * Log a scan visit for a clinic. Opens a seven-day qualifying window.
 */
async function recordVisit({ userId, recordedBy, notes, visitedAt }) {
  const at = visitedAt ? new Date(visitedAt) : new Date();
  const qualifiesUntil = new Date(at.getTime() + QUALIFY_DAYS * 24 * 60 * 60 * 1000);

  return prisma.scanVisit.create({
    data: {
      customId: await nextVisitId(),
      userId,
      visitedAt: at,
      qualifiesUntil,
      recordedBy,
      notes: notes || null,
    },
  });
}

/**
 * The clinic's currently-open scan visit, if any.
 */
async function openVisitFor(userId, when = new Date()) {
  return prisma.scanVisit.findFirst({
    where: {
      userId,
      visitedAt: { lte: when },
      qualifiesUntil: { gte: when },
    },
    orderBy: { visitedAt: 'desc' },
  });
}

/**
 * Every crown case a clinic placed inside a visit's window.
 * Complimentary crowns never count towards earning more.
 *
 * This is the one definition of "a qualifying order" — both the reward
 * calculation and anything that merely displays progress read it, so a
 * clinic is never shown a number the reward engine disagrees with.
 */
function qualifyingOrders(userId, visit) {
  return prisma.case.findMany({
    where: {
      doctorId: userId,
      caseType: 'crown_bridge',
      complimentary: false,
      status: { notIn: ['draft', 'cancelled'] },
      createdAt: { gte: visit.visitedAt, lte: visit.qualifiesUntil },
    },
    select: { materialSkuId: true },
  });
}

/**
 * Called after a crown case is created. Counts qualifying crown orders
 * in the open window and issues any newly-earned complimentary crowns.
 *
 * Returns { visit, newCredits } — newCredits is [] when nothing was
 * earned, which is the common case.
 */
async function registerCrownOrder(caseRecord) {
  if (caseRecord.caseType !== 'crown_bridge') return { visit: null, newCredits: [] };

  const visit = await openVisitFor(caseRecord.doctorId, caseRecord.createdAt || new Date());
  if (!visit) return { visit: null, newCredits: [] };

  const qualifying = await qualifyingOrders(caseRecord.doctorId, visit);
  const orderCount = qualifying.length;

  // Total crowns this visit has now earned, across both tiers.
  const earned = REWARD_TIERS
    .filter(t => orderCount >= t.orders)
    .reduce((sum, t) => sum + t.crowns, 0);

  const owed = earned - visit.creditsIssued;

  await prisma.scanVisit.update({
    where: { id: visit.id },
    data: { crownOrderCount: orderCount },
  });

  if (owed <= 0) {
    return { visit: { ...visit, crownOrderCount: orderCount }, newCredits: [] };
  }

  // Issue in the most-ordered tier, per the offer's own wording.
  const tally = {};
  qualifying.forEach(c => { if (c.materialSkuId) tally[c.materialSkuId] = (tally[c.materialSkuId] || 0) + 1; });
  const topSkuId = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || caseRecord.materialSkuId || null;
  const sku = topSkuId
    ? await prisma.materialSKU.findUnique({ where: { id: topSkuId }, select: { displayName: true } })
    : null;

  const reason = REWARD_TIERS.filter(t => orderCount >= t.orders).map(t => t.reason).pop();

  const newCredits = [];
  for (let i = 0; i < owed; i++) {
    newCredits.push(await prisma.crownCredit.create({
      data: {
        userId: caseRecord.doctorId,
        scanVisitId: visit.id,
        materialSkuId: topSkuId,
        tierLabel: sku?.displayName || null,
        reason,
        // Give the clinic a fair window to actually use it.
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    }));
  }

  await prisma.scanVisit.update({
    where: { id: visit.id },
    data: { creditsIssued: earned },
  });

  return { visit: { ...visit, crownOrderCount: orderCount }, newCredits };
}

/**
 * Unredeemed, unexpired credits for a clinic.
 */
async function availableCredits(userId) {
  return prisma.crownCredit.findMany({
    where: {
      userId,
      redeemed: false,
      OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Redeem one credit against a crown case, zeroing its price.
 * Returns the credit used, or null when none applies.
 */
async function redeemCreditFor(caseRecord, requestedCreditId) {
  if (caseRecord.caseType !== 'crown_bridge') return null;

  const credits = await availableCredits(caseRecord.doctorId);
  if (credits.length === 0) return null;

  const credit = requestedCreditId
    ? credits.find(c => c.id === requestedCreditId)
    : credits[0];
  if (!credit) return null;

  await prisma.$transaction([
    prisma.crownCredit.update({
      where: { id: credit.id },
      data: { redeemed: true, redeemedAt: new Date(), redeemedOnCaseId: caseRecord.id },
    }),
    prisma.case.update({
      where: { id: caseRecord.id },
      data: { complimentary: true, totalAmountPaise: 0 },
    }),
    prisma.timeline.create({
      data: {
        caseId: caseRecord.id,
        label: '🎁 Complimentary crown applied',
        info: credit.reason,
      },
    }),
  ]);

  return credit;
}

module.exports = {
  recordVisit,
  openVisitFor,
  qualifyingOrders,
  registerCrownOrder,
  availableCredits,
  redeemCreditFor,
  QUALIFY_DAYS,
  REWARD_TIERS,
};
