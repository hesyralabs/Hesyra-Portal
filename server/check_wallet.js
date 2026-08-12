const prisma = require('./lib/prisma');

async function check() {
  const wallet = await prisma.wallet.findFirst({
    include: {
      transactions: { orderBy: { createdAt: 'desc' }, take: 8 },
    },
  });

  console.log('\n=== WALLET ===');
  console.log('Balance:    Rs.' + (wallet.balancePaise / 100).toFixed(2));
  console.log('TotalSpent: Rs.' + (wallet.totalSpentPaise / 100).toFixed(2));
  console.log('TotalLoaded:Rs.' + (wallet.totalLoadedPaise / 100).toFixed(2));

  console.log('\n=== LAST 8 TRANSACTIONS ===');
  wallet.transactions.forEach(t => {
    const sign = t.direction === 'DEBIT' ? '-' : '+';
    console.log(`[${t.type}] ${sign}Rs.${(t.amountPaise / 100).toFixed(2)}  | ${t.description || ''} | ${new Date(t.createdAt).toLocaleString()}`);
  });

  const pending = await prisma.case.findMany({
    where: { status: { in: ['payment_pending', 'ready_for_dispatch'] } },
    select: { customId: true, status: true, totalAmountPaise: true },
  });

  console.log('\n=== CASES AWAITING PAYMENT ===');
  if (pending.length === 0) {
    console.log('(none — all paid or not ready yet)');
  } else {
    pending.forEach(c => console.log(c.customId, c.status, 'Rs.' + (c.totalAmountPaise / 100)));
  }

  const doctor = await prisma.user.findFirst({
    where: { role: 'clinic' },
    select: { id: true, email: true, preferredPaymentMode: true },
  });
  console.log('\n=== DOCTOR ===');
  console.log('ID:', doctor.id);
  console.log('Email:', doctor.email);
  console.log('PreferredPaymentMode:', doctor.preferredPaymentMode);

  await prisma.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
