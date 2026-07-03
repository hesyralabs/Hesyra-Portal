// Quick API test: simulate the technician's GET /api/cases query
const p = require('./lib/prisma');

async function run() {
  // Find the tech user
  const tech = await p.user.findFirst({ where: { role: 'technician' } });
  if (!tech) { console.log('No technician user found!'); return; }
  console.log('Tech user:', tech.id, tech.name);

  // Replicate the WHERE clause from cases.js for technician role
  const TECH_STATUSES = [
    'design_approved', 'post_processing', 'qa',
    'ready_for_dispatch', 'payment_pending', 'overdue',
    'packaged', 'dispatched',
    'printing', 'shipped',
  ];

  const cases = await p.case.findMany({
    where: {
      status: { in: TECH_STATUSES },
      OR: [
        { assignedTechId: tech.id },
        { assignedTechId: null },
      ],
    },
    select: { customId: true, status: true, assignedTechId: true },
    orderBy: [{ priorityFlag: 'desc' }, { createdAt: 'desc' }],
  });

  console.log(`\nCases visible to technician (${cases.length} total):`);
  cases.forEach(c => console.log(`  ${c.customId}  status=${c.status}  techId=${c.assignedTechId || 'UNASSIGNED'}`));

  // Also check what cases exist in those statuses regardless of tech assignment
  const allInStatus = await p.case.findMany({
    where: { status: { in: TECH_STATUSES } },
    select: { customId: true, status: true, assignedTechId: true },
  });
  console.log(`\nAll cases in tech-scope statuses (${allInStatus.length} total):`);
  allInStatus.forEach(c => console.log(`  ${c.customId}  status=${c.status}  techId=${c.assignedTechId || 'UNASSIGNED'}`));
}

run().catch(console.error).finally(() => p.$disconnect());
