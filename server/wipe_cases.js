// Wipe all case data but keep user accounts intact.
// Wallets are kept but zeroed — balances here are derived from case
// activity, so leaving them funded after a wipe leaves money that no
// longer has any transaction history behind it.
const fs = require('fs');
const path = require('path');
const prisma = require('./lib/prisma');

const uploadsDir = path.join(__dirname, 'uploads');

/**
 * Delete upload files that nothing in the database points at any more.
 *
 * Deleting the CaseFile rows does not delete the bytes: scans, design
 * meshes and treatment-plan video are large, and a few wipes leave
 * hundreds of megabytes of files belonging to cases that no longer
 * exist. Driven off what the database still references rather than off
 * a filename pattern, so a file in use is never removed.
 */
async function pruneOrphanedUploads() {
  if (!fs.existsSync(uploadsDir)) return;

  const referenced = new Set(
    (await prisma.caseFile.findMany({ select: { path: true } }))
      .map(f => path.basename(f.path))
  );

  let removed = 0;
  let bytes = 0;
  for (const name of fs.readdirSync(uploadsDir)) {
    if (referenced.has(name)) continue;
    const full = path.join(uploadsDir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      fs.unlinkSync(full);
      removed++;
      bytes += st.size;
    } catch (e) {
      console.warn(`  ! could not remove ${name}: ${e.message}`);
    }
  }

  console.log(`  ✓ Orphaned uploads removed (${removed} file${removed === 1 ? '' : 's'}, ${(bytes / 1048576).toFixed(1)} MB)`);
}

async function wipe() {
  console.log('\n🗑️  Wiping all case data...\n');

  // Order matters — delete children before parents
  await prisma.timeline.deleteMany({});          console.log('  ✓ Timelines cleared');
  await prisma.message.deleteMany({});           console.log('  ✓ Messages cleared');
  await prisma.caseFile.deleteMany({});          console.log('  ✓ Case files cleared');
  await prisma.paymentRecord.deleteMany({});     console.log('  ✓ Payment records cleared');
  await prisma.walletTransaction.deleteMany({}); console.log('  ✓ Wallet transactions cleared');
  await prisma.invoice.deleteMany({});           console.log('  ✓ Invoices cleared');
  await prisma.supportTicket.deleteMany({});     console.log('  ✓ Support tickets cleared');
  await prisma.resolutionTicket.deleteMany({});  console.log('  ✓ Resolution tickets cleared');
  await prisma.strike.deleteMany({});            console.log('  ✓ Strikes cleared');
  await prisma.crownCredit.deleteMany({});       console.log('  ✓ Crown credits cleared');
  await prisma.scanVisit.deleteMany({});         console.log('  ✓ Scan Day visits cleared');
  await prisma.case.deleteMany({});              console.log('  ✓ Cases cleared');
  await prisma.printBatch.deleteMany({});        console.log('  ✓ Print batches cleared');
  await prisma.designerStats.deleteMany({});     console.log('  ✓ Designer stats cleared');
  await prisma.auditLog.deleteMany({});          console.log('  ✓ Audit log cleared');
  // Razorpay delivery receipts. Keyed on the delivery id, so leaving
  // them means a replayed event id is still treated as already handled
  // after the case it belonged to is gone.
  await prisma.webhookEvent.deleteMany({});      console.log('  ✓ Webhook delivery log cleared');

  // Files on disk, after the rows that referenced them are gone.
  await pruneOrphanedUploads();

  // Reset all counters to 0 so new case IDs start fresh
  await prisma.counter.deleteMany({});           console.log('  ✓ Counters reset');

  // Zero the wallets — their transaction history is gone
  await prisma.wallet.updateMany({
    data: { balancePaise: 0, totalLoadedPaise: 0, totalSpentPaise: 0 },
  });
  console.log('  ✓ Wallet balances zeroed');

  // Reset trust state on users. 'clean' is the schema default and the
  // value TRUST_LEVELS.CLEAN in lib/config.js — not 'standard', which
  // no code path recognises.
  await prisma.user.updateMany({
    data: { strikeCount: 0, trustLevel: 'clean' },
  });
  console.log('  ✓ User strike counts and trust levels reset');

  console.log('\n✅ Database wiped. User accounts preserved.');
  console.log('   Log in and create a new case to test the full flow.\n');
}

wipe()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
