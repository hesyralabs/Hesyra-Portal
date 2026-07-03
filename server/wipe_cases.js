// Wipe all case data but keep user accounts + wallets intact
const prisma = require('./lib/prisma');

async function wipe() {
  console.log('\n🗑️  Wiping all case data...\n');

  // Order matters — delete children before parents
  await prisma.timeline.deleteMany({});         console.log('  ✓ Timelines cleared');
  await prisma.message.deleteMany({});           console.log('  ✓ Messages cleared');
  await prisma.caseFile.deleteMany({});          console.log('  ✓ Case files cleared');
  await prisma.paymentRecord.deleteMany({});     console.log('  ✓ Payment records cleared');
  await prisma.supportTicket.deleteMany({});     console.log('  ✓ Support tickets cleared');
  await prisma.strike.deleteMany({});            console.log('  ✓ Strikes cleared');
  await prisma.case.deleteMany({});              console.log('  ✓ Cases cleared');

  // Reset all counters to 0 so new case IDs start fresh
  await prisma.counter.deleteMany({});           console.log('  ✓ Counters reset');

  // Reset strike count on users
  await prisma.user.updateMany({
    data: { strikeCount: 0, trustLevel: 'standard' },
  });
  console.log('  ✓ User strike counts reset to 0');

  console.log('\n✅ Database wiped. Users and wallets preserved.');
  console.log('   Log in and create a new case to test the full flow.\n');
}

wipe()
  .catch(e => { console.error('ERROR:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
