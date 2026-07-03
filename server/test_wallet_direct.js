// Direct test: simulate payment for doctor@hesyra.com and verify wallet deduction
const prisma = require('./lib/prisma');
const paymentEngine = require('./lib/paymentEngine');

async function run() {
  const DOCTOR_EMAIL = 'doctor@hesyra.com';

  // 1. Get the doctor
  const doctor = await prisma.user.findUnique({
    where: { email: DOCTOR_EMAIL },
    include: { wallet: true },
  });

  if (!doctor) { console.error('Doctor not found!'); return; }

  const walletBefore = doctor.wallet.balancePaise;
  console.log('Doctor ID:', doctor.id);
  console.log('PaymentMode:', doctor.preferredPaymentMode);
  console.log('Wallet BEFORE:', 'Rs.' + (walletBefore / 100).toFixed(2));

  // 2. Create a temporary test case for this doctor
  const testCase = await prisma.case.create({
    data: {
      customId:        'TEST-WALLET-001',
      patient:         'Test Patient Wallet',
      caseType:        'crown_bridge',
      type:            'Single Crown',
      status:          'payment_pending',
      totalAmountPaise: 150000,  // Rs.1500
      readyForDispatchAt: new Date(),
      doctorId:        doctor.id,
      clinic:          doctor.clinic || 'Test Clinic',
    },
  });
  console.log('\nCreated test case:', testCase.customId);

  // 3. Call handlePaymentConfirmed with a mock ID (as simulate route would)
  console.log('Calling handlePaymentConfirmed with pay_mock_ ID...');
  const result = await paymentEngine.handlePaymentConfirmed('TEST-WALLET-001', 'pay_mock_testABC123');
  console.log('Result:', result);

  // 4. Check wallet AFTER
  const walletAfter = await prisma.wallet.findUnique({ where: { id: doctor.wallet.id } });
  const deducted = walletBefore - walletAfter.balancePaise;

  console.log('\nWallet BEFORE: Rs.' + (walletBefore / 100).toFixed(2));
  console.log('Wallet AFTER:  Rs.' + (walletAfter.balancePaise / 100).toFixed(2));
  console.log('Deducted:      Rs.' + (deducted / 100).toFixed(2));

  if (deducted === 150000) {
    console.log('\n✅ PASS: Rs.1500 correctly deducted from wallet!');
  } else {
    console.log('\n❌ FAIL: Expected Rs.1500 deduction, got Rs.' + (deducted / 100).toFixed(2));
  }

  // 5. Check transaction record
  const txn = await prisma.walletTransaction.findFirst({
    where: { caseId: testCase.id, type: 'ORDER_DEDUCT' },
  });
  if (txn) {
    console.log('✅ PASS: WalletTransaction record found:', txn.description, 'Rs.' + (txn.amountPaise/100));
  } else {
    console.log('❌ FAIL: No WalletTransaction record created');
  }

  // 6. Cleanup test case
  await prisma.walletTransaction.deleteMany({ where: { caseId: testCase.id } });
  await prisma.timeline.deleteMany({ where: { caseId: testCase.id } });
  await prisma.case.delete({ where: { id: testCase.id } });

  // 7. Restore wallet balance
  await prisma.wallet.update({
    where: { id: doctor.wallet.id },
    data: { balancePaise: walletBefore, totalSpentPaise: { decrement: deducted } },
  });
  console.log('\nTest case cleaned up. Wallet restored to Rs.' + (walletBefore / 100).toFixed(2));

  await prisma.$disconnect();
}

run().catch(e => { console.error('ERROR:', e.message); console.error(e.stack); process.exit(1); });
