const p = require('./lib/prisma');

async function verify() {
  const total     = await p.case.count();
  const byStatus  = await p.case.groupBy({ by: ['status'], _count: { status: true } });
  const fileCount = await p.caseFile.count();
  const scanFiles = await p.caseFile.count({ where: { category: 'scan' } });
  const designFiles = await p.caseFile.count({ where: { category: 'design' } });

  console.log('\n══════════════════════════════════════════');
  console.log('  DB Verification');
  console.log('══════════════════════════════════════════');
  console.log(`  Total cases     : ${total}`);
  console.log(`  Total files     : ${fileCount} (${scanFiles} scan | ${designFiles} design)`);
  console.log('\n  Cases by status:');
  byStatus
    .sort((a,b) => b._count.status - a._count.status)
    .forEach(s => console.log(`    ${s.status.padEnd(22)} : ${s._count.status}`));
  console.log('══════════════════════════════════════════\n');
}

verify()
  .catch(e => console.error('ERROR:', e.message))
  .finally(() => p.$disconnect());
