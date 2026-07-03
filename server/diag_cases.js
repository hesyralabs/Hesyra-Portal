const p = require('./lib/prisma');
p.case.findMany({
  select: { customId: true, status: true, assignedDesignerId: true, assignedTechId: true }
}).then(c => {
  console.log('Cases in DB:');
  c.forEach(x => console.log(`  ${x.customId}  status=${x.status}  designer=${x.assignedDesignerId || 'NONE'}  tech=${x.assignedTechId || 'NONE'}`));
  if (c.length === 0) console.log('  (none)');
  return p["$disconnect"]();
}).catch(e => { console.error(e.message); p["$disconnect"](); });
