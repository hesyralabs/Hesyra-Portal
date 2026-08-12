// Wipe all case data but keep user accounts intact.
// Wallets are kept but zeroed — balances here are derived from case
// activity, so leaving them funded after a wipe leaves money that no
// longer has any transaction history behind it.
const prisma = require('./lib/prisma');

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
