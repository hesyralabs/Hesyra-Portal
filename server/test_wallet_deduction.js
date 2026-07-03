// Full end-to-end wallet deduction test
// Creates a scenario where we can call simulate payment and verify wallet deduction
const prisma = require('./lib/prisma');
const paymentEngine = require('./lib/paymentEngine');

async function run() {
  // 1. Get all cases
  const cases = await prisma.case.findMany({
    select: { customId: true, status: true, totalAmountPaise: true, patient: true, doctorId: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log('\n=== ALL CASES ===');
  cases.forEach(c => console.log(`${c.customId} | ${c.status} | Rs.${(c.totalAmountPaise||0)/100} | ${c.patient}`));

  // 2. Get a recently submitted case and fast-forward it to payment_pending for testing
  const submitted = cases.find(c => c.status === 'submitted');
  if (!submitted) {
    console.log('\nNo submitted case found. Looking for any non-terminal case...');
    const anyCase = cases.find(c => !['shipped','completed','archived','cancelled'].includes(c.status));
    if (!anyCase) { console.log('No testable cases. Create a new one first.'); await prisma.$disconnect(); return; }
  }

  const testCase = submitted || cases.find(c => !['shipped','completed','archived','cancelled'].includes(c.status));
  console.log('\n=== TEST CASE ===', testCase.customId, '|', testCase.status);

  // 3. Get wallet balance before
  const walletBefore = await prisma.wallet.findFirst({ where: { userId: testCase.doctorId } });
  console.log('\nWallet BEFORE:', 'Rs.' + (walletBefore.balancePaise / 100).toFixed(2));

  // 4. Fast-forward case to ready_for_dispatch (which triggers processReadyForDispatch → wallet deduction)
  console.log('\nTriggering processReadyForDispatch...');

  // First set up totalAmountPaise if not set
  if (!testCase.totalAmountPaise) {
    await prisma.case.update({
      where: { customId: testCase.customId },
      data: { totalAmountPaise: 150000, status: 'printing' }, // ₹1500 crown
    });
  } else {
    await prisma.case.update({
      where: { customId: testCase.customId },
      data: { status: 'printing' },
    });
  }

  // This triggers the full payment logic
  const result = await paymentEngine.processReadyForDispatch(
    (await prisma.case.findUnique({ where: { customId: testCase.customId } })).id
  );
  console.log('processReadyForDispatch result:', JSON.stringify(result));

  // 5. If wallet_auto, check balance
  const walletAfter = await prisma.wallet.findFirst({ where: { userId: testCase.doctorId } });
  console.log('\nWallet AFTER:', 'Rs.' + (walletAfter.balancePaise / 100).toFixed(2));
  const diff = walletBefore.balancePaise - walletAfter.balancePaise;
  console.log('Amount deducted:', diff > 0 ? `Rs.${(diff/100).toFixed(2)} ✅ CORRECT` : `Rs.${(diff/100).toFixed(2)} ❌ NOT DEDUCTED`);

  // 6. If it went to payment_pending (insufficient balance), test simulate
  if (result.mode === 'pay_on_go' || result.mode === 'partial_wallet') {
    console.log('\nCase went to payment_pending. Simulating payment...');
    const simResult = await paymentEngine.handlePaymentConfirmed(testCase.customId, 'pay_mock_test123');
    console.log('Simulate result:', simResult);

    const walletAfterSim = await prisma.wallet.findFirst({ where: { userId: testCase.doctorId } });
    console.log('Wallet after simulate:', 'Rs.' + (walletAfterSim.balancePaise / 100).toFixed(2));
  }

  await prisma.$disconnect();
}

run().catch(e => { console.error('ERROR:', e.message, e.stack); process.exit(1); });
