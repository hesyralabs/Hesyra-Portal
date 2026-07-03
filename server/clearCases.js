const prisma = require('./lib/prisma');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('🧹 Purging all cases, invoices, and related transaction history...');

  // 1. Delete DB tables containing case references
  const ticketsResult = await prisma.supportTicket.deleteMany({});
  const strikesResult = await prisma.strike.deleteMany({});
  const paymentsResult = await prisma.paymentRecord.deleteMany({});
  const invoicesResult = await prisma.invoice.deleteMany({});
  const timelinesResult = await prisma.timeline.deleteMany({});
  const messagesResult = await prisma.message.deleteMany({});
  const filesResult = await prisma.caseFile.deleteMany({});
  const casesResult = await prisma.case.deleteMany({});
  const batchesResult = await prisma.printBatch.deleteMany({});
  const transactionsResult = await prisma.walletTransaction.deleteMany({});
  const resolutionsResult = await prisma.resolutionTicket.deleteMany({});

  console.log(`   - Deleted ${casesResult.count} cases`);
  console.log(`   - Deleted ${invoicesResult.count} invoices`);
  console.log(`   - Deleted ${filesResult.count} database file records`);
  console.log(`   - Deleted ${timelinesResult.count} timeline logs`);

  // 2. Reset user-level counters, trust status, and outstanding balances
  await prisma.user.updateMany({
    data: {
      outstandingPaise: 0,
      strikeCount: 0,
      trustLevel: 'clean',
    }
  });
  console.log('   - Reset all clinic outstanding balances and strikes');

  // 3. Reset designer performance stats
  await prisma.designerStats.updateMany({
    data: {
      totalCompleted: 0,
      totalRevisions: 0,
      avgTurnaroundHours: 0,
      revisionRate: 0,
      caseTypeBreakdown: '{}',
      currentActiveCases: 0,
    }
  });
  console.log('   - Reset designer workload and active case metrics');

  // 4. Reset wallets to clean starting slate
  await prisma.wallet.updateMany({
    data: {
      balancePaise: 0,
      totalLoadedPaise: 0,
      totalSpentPaise: 0,
    }
  });
  console.log('   - Reset wallet balances to ₹0.00');

  // 5. Purge custom case ID counters
  const countersResult = await prisma.counter.deleteMany({});
  console.log(`   - Purged ${countersResult.count} geo-serial counters`);

  // 6. Delete physical uploaded files on disk
  const uploadsDir = path.join(__dirname, 'uploads');
  if (fs.existsSync(uploadsDir)) {
    const files = fs.readdirSync(uploadsDir);
    let deletedFilesCount = 0;
    for (const file of files) {
      if (file !== '.gitkeep') {
        try {
          fs.unlinkSync(path.join(uploadsDir, file));
          deletedFilesCount++;
        } catch (e) {
          console.warn(`Could not delete file ${file}:`, e.message);
        }
      }
    }
    console.log(`   - Deleted ${deletedFilesCount} physical uploaded files from disk`);
  }

  console.log('\n✅ Portal is now fully cleared of dummy/demo cases! Ready for testing fresh workflows.');
  process.exit(0);
}

main().catch(err => {
  console.error('Purge script failed:', err);
  process.exit(1);
});
