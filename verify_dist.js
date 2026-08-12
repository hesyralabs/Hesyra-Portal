require('dotenv').config({ path: './server/.env' });
const prisma = require('./server/lib/prisma');

async function verify() {
  console.log('\n--- VERIFYING DOCTOR ACCOUNTS ---');
  const users = await prisma.user.findMany({
    where: { role: 'clinic' },
    select: { customId: true, username: true, stateCode: true, cityCode: true, docSerial: true }
  });
  console.table(users);

  console.log('\n--- VERIFYING SMART CASE IDs ---');
  const cases = await prisma.case.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { customId: true, patient: true, caseType: true }
  });
  console.table(cases);

  console.log('\n--- VERIFYING CHRONOLOGICAL COUNTERS ---');
  const counters = await prisma.counter.findMany();
  console.table(counters);
}

verify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
