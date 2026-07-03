const p = require('./lib/prisma');
p.case.findMany({
  include: { 
    files: { select: { id: true, filename: true, category: true } },
    timeline: { orderBy: { createdAt: 'asc' }, select: { label: true, createdAt: true } }
  }
}).then(cases => {
  if (cases.length === 0) { console.log('No cases in DB.'); return; }
  cases.forEach(c => {
    console.log(`\n═══ ${c.customId} ═══`);
    console.log(`  Status:   ${c.status}`);
    console.log(`  Designer: ${c.assignedDesignerId || 'NONE'}`);
    console.log(`  Tech:     ${c.assignedTechId || 'NONE'}`);
    console.log(`  Files:    ${c.files.length > 0 ? c.files.map(f => `${f.category}:${f.filename}`).join(', ') : 'NONE'}`);
    console.log(`  Timeline:`);
    c.timeline.forEach(t => console.log(`    - ${t.label}`));
  });
  console.log('');
  return p["$disconnect"]();
}).catch(e => { console.error(e.message); p["$disconnect"](); });
