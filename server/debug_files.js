require('dotenv').config();
const prisma = require('./lib/prisma');

async function main() {
  const c = await prisma.case.findFirst({
    where: { customId: 'MH272CB-26040001-001' },
    include: { files: true }
  });
  if (!c) { console.log('Case not found'); return; }
  console.log('=== CASE FILES ===');
  c.files.forEach(f => {
    console.log(JSON.stringify({ id: f.id, name: f.name, url: f.url, category: f.category, uploadedBy: f.uploadedBy }, null, 2));
  });
  
  // Also check what the API would return
  const fs = require('fs');
  const path = require('path');
  console.log('\n=== FILE EXISTENCE CHECK ===');
  c.files.forEach(f => {
    if (f.url) {
      // The URL is like /uploads/filename.stl — strip the /uploads/ prefix to get the filename
      const filename = f.url.replace(/^\/uploads\//, '');
      const fullPath = path.join(__dirname, 'uploads', filename);
      const exists = fs.existsSync(fullPath);
      console.log(`${f.name}: URL="${f.url}" | File exists: ${exists} | Path: ${fullPath}`);
    }
  });
}

main().then(() => prisma.$disconnect()).catch(e => { console.error(e); prisma.$disconnect(); });
