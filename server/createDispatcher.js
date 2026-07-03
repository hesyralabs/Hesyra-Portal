const prisma = require('./lib/prisma');
const bcrypt = require('bcrypt');

async function main() {
  const hashedPassword = await bcrypt.hash('Hesyra@2026', 12);
  const exists = await prisma.user.findUnique({
    where: { email: 'dispatch@hesyra.com' }
  });

  if (!exists) {
    const user = await prisma.user.create({
      data: {
        customId: 'DSP-001',
        username: 'dispatch_001',
        name: 'Dispatch Person',
        email: 'dispatch@hesyra.com',
        password: hashedPassword,
        role: 'dispatch',
        dispatchPermission: true,
        onboardingComplete: true,
        welcomeCompleted: true,
        welcomeLastStep: 1,
        newCaseTourCompleted: true,
      },
    });
    console.log('✅ Created dispatch user:', user.email);
  } else {
    console.log('Dispatch user already exists.');
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
