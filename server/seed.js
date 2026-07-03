const prisma = require('./lib/prisma');
const bcrypt = require('bcrypt');
require('dotenv').config();

async function seed() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  HESYRA PORTAL — Production Database Bootstrap');
  console.log('  v2.0 — With Payment & Wallet System');
  console.log('═══════════════════════════════════════════════════\n');

  // Purge existing data
  console.log('🗑️  Purging existing data...');
  await prisma.supportTicket.deleteMany({});
  await prisma.walletTransaction.deleteMany({});
  await prisma.wallet.deleteMany({});
  await prisma.paymentRecord.deleteMany({});
  await prisma.strike.deleteMany({});
  await prisma.resolutionTicket.deleteMany({});
  await prisma.timeline.deleteMany({});
  await prisma.message.deleteMany({});
  await prisma.caseFile.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.case.deleteMany({});
  await prisma.printBatch.deleteMany({});
  await prisma.materialSKU.deleteMany({});
  await prisma.counter.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('   ✓ All tables cleared\n');

  // ═══════════════════════════════════════════════════════════════
  // Accounts — One per role
  // ═══════════════════════════════════════════════════════════════
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');

  const accounts = [
    {
      customId: 'ADM-001',
      username: 'admin',
      name: 'Pranjal Agarwal',
      email: 'admin@hesyra.com',
      password: 'Hesyra@2026',
      role: 'admin',
      dispatchPermission: false,
    },
    {
      customId: 'MGR-001',
      username: 'mgr_001',
      name: 'Akhilesh Sharma',
      email: 'manager@hesyra.com',
      password: 'Hesyra@2026',
      role: 'manager',
      dispatchPermission: false,
    },
    {
      customId: 'TECH-001',
      username: 'tech_001',
      name: 'Lab Technician',
      email: 'tech@hesyra.com',
      password: 'Hesyra@2026',
      role: 'technician',
      location: 'Lab Floor A',
      dispatchPermission: true, // Technician handles dispatch until dedicated hire
    },
    {
      customId: 'CAD-001',
      username: 'cad_001',
      name: 'CAD Designer',
      email: 'cad@hesyra.com',
      password: 'Hesyra@2026',
      role: 'cad_designer',
      dispatchPermission: false,
    },
    {
      customId: 'DOC-001',
      username: 'MH272',   // Maharashtra · Amravati (27) · 2nd doctor
      stateCode: 'MH',
      cityCode: '27',
      docSerial: 2,
      name: 'Dr. Pranjal',
      email: 'doctor@hesyra.com',
      password: 'Hesyra@2026',
      role: 'clinic',
      clinic: 'Hesyra Dental Clinic',
      dispatchPermission: false,
    },
    {
      customId: 'DOC-002',
      username: 'MH273',
      stateCode: 'MH',
      cityCode: '27',
      docSerial: 3,
      name: 'Dr. Shubham',
      email: 'doctor2@hesyra.com',
      password: 'Hesyra@2026',
      role: 'clinic',
      clinic: 'Smile Dental Care',
      dispatchPermission: false,
      // This doctor will have Strike 1 for testing
    },
    {
      customId: 'DOC-003',
      username: 'MH274',
      stateCode: 'MH',
      cityCode: '27',
      docSerial: 4,
      name: 'Dr. Ananya Kulkarni',
      email: 'newdoc@hesyra.com',
      password: 'Hesyra@2026',
      role: 'clinic',
      clinic: 'Kulkarni Dental',
      dispatchPermission: false,
      skipWelcome: false, // This account triggers the onboarding welcome flow
    },
    {
      customId: 'CRM-001',
      username: 'ceramist_001',
      name: 'Ravi Ceramist',
      email: 'ceramist@hesyra.com',
      password: 'Hesyra@2026',
      role: 'ceramist',
      location: 'Finishing Room',
      dispatchPermission: false,
    },
    {
      customId: 'CRM-002',
      username: 'ceramist_002',
      name: 'Sunita Ceramist',
      email: 'ceramist2@hesyra.com',
      password: 'Hesyra@2026',
      role: 'ceramist',
      location: 'Finishing Room',
      dispatchPermission: false,
    },
  ];

  let createdUsers = {};
  for (const acc of accounts) {
    const hashedPassword = await bcrypt.hash(acc.password, 12);
    const user = await prisma.user.create({
      data: {
        customId:   acc.customId,
        username:   acc.username || null,
        stateCode:  acc.stateCode || null,
        cityCode:   acc.cityCode  || null,
        docSerial:  acc.docSerial || null,
        name:       acc.name,
        email:      acc.email,
        password:   hashedPassword,
        role:       acc.role,
        clinic:     acc.clinic   || null,
        location:   acc.location || null,
        status:     'active',
        dispatchPermission: acc.dispatchPermission ?? false,
        onboardingComplete:   acc.skipWelcome === false ? true : true,
        welcomeCompleted:     acc.skipWelcome === false ? false : true,
        welcomeLastStep:      1,
        newCaseTourCompleted: acc.skipWelcome === false ? false : true,
      },
    });
    createdUsers[acc.customId] = user;
    console.log(`  ✅ ${acc.role.toUpperCase().padEnd(12)} → ${acc.email}  (username: ${acc.username})`);
  }

  const doctor1 = createdUsers['DOC-001'];
  const doctor2 = createdUsers['DOC-002'];

  // ═══════════════════════════════════════════════════════════════
  // Wallets
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  💰 Creating wallets...');

  // Doctor 1: Healthy wallet with ₹5,000 balance
  const wallet1 = await prisma.wallet.create({
    data: {
      userId: doctor1.id,
      balancePaise: 500000,        // ₹5,000
      totalLoadedPaise: 1000000,   // ₹10,000 lifetime
      totalSpentPaise: 500000,     // ₹5,000 lifetime
    },
  });
  console.log(`  ✅ Wallet for ${doctor1.name}: ₹5,000.00 balance`);

  // Add wallet transaction history
  await prisma.walletTransaction.createMany({
    data: [
      {
        walletId: wallet1.id,
        type: 'LOAD',
        amountPaise: 1000000,
        direction: 'CREDIT',
        description: 'Wallet reloaded — ₹10,000.00',
      },
      {
        walletId: wallet1.id,
        type: 'BONUS_CREDIT',
        amountPaise: 50000,
        direction: 'CREDIT',
        description: 'Bonus credit for loading ₹10,000+',
      },
      {
        walletId: wallet1.id,
        type: 'ORDER_DEDUCT',
        amountPaise: 250000,
        direction: 'DEBIT',
        description: 'Order payment — auto-deducted from wallet',
      },
      {
        walletId: wallet1.id,
        type: 'ORDER_DEDUCT',
        amountPaise: 250000,
        direction: 'DEBIT',
        description: 'Order payment — auto-deducted from wallet',
      },
    ],
  });

  // Doctor 2: Empty wallet (for testing Pay-on-Go)
  const wallet2 = await prisma.wallet.create({
    data: { userId: doctor2.id, balancePaise: 0, totalLoadedPaise: 0, totalSpentPaise: 0 },
  });
  console.log(`  ✅ Wallet for ${doctor2.name}: ₹0.00 balance`);

  // Set Doctor 1 to wallet mode
  await prisma.user.update({
    where: { id: doctor1.id },
    data: { preferredPaymentMode: 'wallet' },
  });

  // ═══════════════════════════════════════════════════════════════
  // Initialize Counters
  // ═══════════════════════════════════════════════════════════════
  const monthKey = `month:${yy}${mm}`;

  await prisma.counter.createMany({
    data: [
      { id: monthKey, value: 12 },                   // 12 seeded cases this month
      { id: `doc:${doctor1.id}`, value: 10 },
      { id: `doc:${doctor2.id}`, value: 2 },
    ],
  });
  console.log(`\n  📊 Counters initialized`);

  // ═══════════════════════════════════════════════════════════════
  // Sample Cases — various payment states
  // ═══════════════════════════════════════════════════════════════
  const doc1Username = doctor1.username; // "MH272"
  const doc2Username = doctor2.username; // "MH273"

  // Case 1: Submitted (normal — awaiting lab)
  const caseId1 = `${doc1Username}AL-${yy}${mm}0001-001`;
  await prisma.case.create({
    data: {
      customId: caseId1,
      patient: 'Arjun Mehta',
      caseType: 'aligner',
      type: 'ALIGNER',
      material: 'Resin (e.g. VarseoSmile)',
      shade: 'A2',
      toothNumbers: JSON.stringify([14, 15, 16]),
      archTarget: 'Upper',
      instructions: 'Patient has mild crowding in upper arch.',
      status: 'submitted',
      clinic: 'Hesyra Dental Clinic',
      due: 'Standard',
      doctorId: doctor1.id,
      totalAmountPaise: 250000,
      timeline: { create: [{ label: 'Case Submitted' }] },
    },
  });
  console.log(`  📋 Case ${caseId1} — submitted (normal)`);

  // Case 2: Designing (in progress)
  const caseId2 = `${doc1Username}CB-${yy}${mm}0002-002`;
  await prisma.case.create({
    data: {
      customId: caseId2,
      patient: 'Neha Sharma',
      caseType: 'crown_bridge',
      type: 'CROWN & BRIDGE',
      material: 'Zirconia',
      shade: 'A3',
      toothNumbers: JSON.stringify([11]),
      instructions: 'Full contour zirconia crown on #11.',
      status: 'designing',
      clinic: 'Hesyra Dental Clinic',
      due: 'Standard',
      tech: 'Lab Technician',
      doctorId: doctor1.id,
      totalAmountPaise: 150000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'Assigned to Lab Technician' },
          { label: 'CAD design started' },
        ],
      },
    },
  });
  console.log(`  📋 Case ${caseId2} — designing`);

  // Case 3: Payment Pending (ready, awaiting payment)
  const caseId3 = `${doc1Username}SG-${yy}${mm}0003-003`;
  const case3 = await prisma.case.create({
    data: {
      customId: caseId3,
      patient: 'Ramesh Patel',
      caseType: 'surgical_guide',
      type: 'SURGICAL GUIDE',
      material: 'Biocompatible Resin',
      shade: 'N/A',
      toothNumbers: JSON.stringify([36, 46]),
      instructions: 'Implant planning guide for bilateral lower molars.',
      status: 'payment_pending',
      clinic: 'Hesyra Dental Clinic',
      due: 'Express',
      tech: 'Lab Technician',
      doctorId: doctor1.id,
      totalAmountPaise: 300000,
      readyForDispatchAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'Assigned to Lab Technician' },
          { label: 'CAD design started' },
          { label: 'Design Completed — Printing' },
          { label: 'Quality Check Passed — Ready for Dispatch' },
        ],
      },
    },
  });

  // Create a pending payment link for case 3
  await prisma.paymentRecord.create({
    data: {
      caseId: case3.id,
      userId: doctor1.id,
      amountPaise: 300000,
      type: 'PAY_ON_GO',
      status: 'pending',
      razorpayPaymentLinkId: 'plink_mock_seed_001',
      paymentLinkUrl: `http://localhost:5173/payment/simulate?link=plink_mock_seed_001&amount=300000&ref=${caseId3}`,
      paymentLinkExpiry: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    },
  });
  console.log(`  📋 Case ${caseId3} — payment_pending (₹3,000)`);

  // Case 4: Doctor 2 — Overdue case with Strike 1
  const caseId4 = `${doc2Username}SP-${yy}${mm}0004-001`;
  const case4 = await prisma.case.create({
    data: {
      customId: caseId4,
      patient: 'Anita Deshmukh',
      caseType: 'splint',
      type: 'SPLINT',
      material: 'Clear Resin',
      shade: 'Clear',
      toothNumbers: JSON.stringify([11, 12, 13, 21, 22, 23]),
      instructions: 'Night guard for bruxism.',
      status: 'overdue',
      clinic: 'Smile Dental Care',
      due: 'Standard',
      tech: 'Lab Technician',
      doctorId: doctor2.id,
      totalAmountPaise: 180000,
      readyForDispatchAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), // 10 days ago
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'Assigned to Lab Technician' },
          { label: 'Quality Check Passed — Ready for Dispatch' },
          { label: 'Strike 1 Applied — Payment Overdue' },
        ],
      },
    },
  });

  // Apply Strike 1 to Doctor 2
  await prisma.strike.create({
    data: {
      userId: doctor2.id,
      caseId: case4.id,
      strikeNumber: 1,
    },
  });
  await prisma.user.update({
    where: { id: doctor2.id },
    data: { strikeCount: 1, trustLevel: 'strike_1' },
  });
  console.log(`  📋 Case ${caseId4} — overdue (Strike 1 applied to Dr. Shubham)`);

  // ═══════════════════════════════════════════════════════════════
  // CAD Designer Cases — Designer queue needs real data
  // ═══════════════════════════════════════════════════════════════
  const cadDesigner = createdUsers['CAD-001'];
  const techUser    = createdUsers['TECH-001'];

  // Case 5: CAD Assigned — designer has active work
  const caseId5 = `${doc1Username}CB-${yy}${mm}0005-005`;
  await prisma.case.create({
    data: {
      customId: caseId5,
      patient: 'Vikram Singh',
      caseType: 'crown_bridge',
      type: 'CROWN & BRIDGE',
      material: 'Zirconia',
      shade: 'A2',
      toothNumbers: JSON.stringify([14, 15]),
      archTarget: 'Upper',
      implantSystem: '',
      instructions: 'Three-unit bridge. Patient is a bruxer — reinforce contacts. Shade to match adjacent 13.',
      status: 'cad_assigned',
      clinic: 'Hesyra Dental Clinic',
      due: 'Express',
      priorityFlag: true,
      tech: 'Lab Technician',
      assignedTechId: techUser.id,
      assignedDesignerId: cadDesigner.id,
      doctorId: doctor1.id,
      totalAmountPaise: 150000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'Assigned to Lab Technician' },
          { label: '⚡ Flagged as priority' },
          { label: 'CAD work assigned' },
        ],
      },
    },
  });
  console.log(`  📋 Case ${caseId5} — cad_assigned (priority, designer queue)`);

  // Case 6: Design Ready — manager needs to approve
  const caseId6 = `${doc1Username}SG-${yy}${mm}0006-006`;
  await prisma.case.create({
    data: {
      customId: caseId6,
      patient: 'Meera Joshi',
      caseType: 'surgical_guide',
      type: 'SURGICAL GUIDE',
      material: 'Biocompatible Resin',
      shade: 'N/A',
      toothNumbers: JSON.stringify([16]),
      archTarget: 'Upper',
      implantSystem: 'Straumann BLT ∅4.1mm',
      instructions: 'Single implant guide upper right. Bone density D2. Confirm sleeve height with surgeon.',
      status: 'design_ready',
      clinic: 'Hesyra Dental Clinic',
      due: 'Standard',
      tech: 'Lab Technician',
      assignedTechId: techUser.id,
      assignedDesignerId: cadDesigner.id,
      doctorId: doctor1.id,
      totalAmountPaise: 300000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'Assigned to Lab Technician' },
          { label: 'CAD work assigned' },
          { label: 'Design file(s) uploaded (2)' },
          { label: '✅ Design submitted for review' },
        ],
      },
    },
  });
  console.log(`  📋 Case ${caseId6} — design_ready (pending manager approval)`);

  // Case 7: Design Revision — designer must rework
  const caseId7 = `${doc2Username}RT-${yy}${mm}0007-002`;
  await prisma.case.create({
    data: {
      customId: caseId7,
      patient: 'Pooja Nair',
      caseType: 'retainer',
      type: 'RETAINER',
      material: 'Clear Resin',
      shade: 'Clear',
      toothNumbers: JSON.stringify([11, 12, 13, 21, 22, 23]),
      archTarget: 'Upper',
      instructions: 'Hawley-style clear retainer. Tight fit required.',
      status: 'design_revision',
      clinic: 'Smile Dental Care',
      due: 'Standard',
      tech: 'Lab Technician',
      assignedTechId: techUser.id,
      assignedDesignerId: cadDesigner.id,
      rejectionReason: 'The palatal coverage is too thin at the midline. Please increase thickness to minimum 2mm and recheck the posterior occlusal clearance.',
      doctorId: doctor2.id,
      totalAmountPaise: 120000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'CAD work assigned' },
          { label: 'Design file(s) uploaded (1)' },
          { label: '✅ Design submitted for review' },
          { label: 'Revision Requested by Manager', info: 'Palatal coverage too thin. Min 2mm required.' },
        ],
      },
    },
  });
  console.log(`  📋 Case ${caseId7} — design_revision (designer must rework)`);

  // Case 8: CAD Assigned (second case for designer — tests queue count)
  const caseId8 = `${doc1Username}DN-${yy}${mm}0008-007`;
  await prisma.case.create({
    data: {
      customId: caseId8,
      patient: 'Suresh Kapoor',
      caseType: 'denture',
      type: 'DENTURE',
      material: 'PMMA',
      shade: 'B1',
      toothNumbers: JSON.stringify([11, 12, 13, 14, 21, 22, 23, 24]),
      archTarget: 'Upper',
      instructions: 'Complete upper denture. Patient previously wore partial denture — match existing lower shade. Copy-denture technique preferred.',
      status: 'cad_assigned',
      clinic: 'Hesyra Dental Clinic',
      due: 'Standard',
      tech: 'Lab Technician',
      assignedTechId: techUser.id,
      assignedDesignerId: cadDesigner.id,
      doctorId: doctor1.id,
      totalAmountPaise: 450000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'Assigned to Lab Technician' },
          { label: 'CAD work assigned' },
        ],
      },
    },
  });
  console.log(`  📋 Case ${caseId8} — cad_assigned (second designer case)`);

  // Case 9: Submitted from Doctor 2 (normal flow)
  const caseId9 = `${doc2Username}AL-${yy}${mm}0009-002`;
  await prisma.case.create({
    data: {
      customId: caseId9,
      patient: 'Raj Malhotra',
      caseType: 'aligner',
      type: 'ALIGNER',
      material: 'Resin (e.g. VarseoSmile)',
      shade: 'Clear',
      toothNumbers: JSON.stringify([13, 14, 15, 16, 23, 24, 25, 26]),
      archTarget: 'Both',
      instructions: 'Full arch aligner. 14 steps upper, 12 steps lower. IPR required at 13-14 and 23-24.',
      status: 'submitted',
      clinic: 'Smile Dental Care',
      due: 'Standard',
      doctorId: doctor2.id,
      totalAmountPaise: 250000,
      timeline: { create: [{ label: 'Case Submitted' }] },
    },
  });
  console.log(`  📋 Case ${caseId9} — submitted (Doctor 2)`);

  // ═══════════════════════════════════════════════════════════════
  // Tech Production Cases — what the technician sees & acts on
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  🔧 Creating technician production cases...');

  // Case 10: Design Approved — tech needs to print
  const caseId10 = `${doc1Username}CB-${yy}${mm}0010-009`;
  const case10 = await prisma.case.create({
    data: {
      customId: caseId10,
      patient: 'Ananya Krishnan',
      caseType: 'crown_bridge',
      type: 'CROWN & BRIDGE',
      material: 'Zirconia',
      shade: 'A2',
      toothNumbers: JSON.stringify([26]),
      archTarget: 'Lower',
      instructions: 'Full-contour zirconia molar. Deep fissure anatomy. Patient has heavy wear — increase occlusal thickness.',
      status: 'design_approved',
      clinic: 'Hesyra Dental Clinic',
      due: 'Express',
      priorityFlag: true,
      tech: 'Lab Technician',
      assignedTechId: techUser.id,
      assignedDesignerId: cadDesigner.id,
      doctorId: doctor1.id,
      totalAmountPaise: 150000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'CAD work assigned' },
          { label: '🎨 Design file(s) uploaded (1)' },
          { label: '✅ Design submitted for manager review (1 file)' },
          { label: '✅ Design approved by Manager — ready for production' },
        ],
      },
    },
  });
  // Seed a mock scan file (dentist's intraoral scan) + mock design file (CAD output)
  await prisma.caseFile.createMany({
    data: [
      {
        filename: 'intraoral_scan_26.stl',
        path:     'uploads/seed-scan-case10-26.stl',
        size:     2048000,
        mimetype: 'model/stl',
        category: 'scan',
        uploadedBy: 'clinic',
        caseId: case10.id,
      },
      {
        filename: 'crown_26_final_v2.stl',
        path:     'uploads/seed-design-case10-crown.stl',
        size:     1536000,
        mimetype: 'model/stl',
        category: 'design',
        uploadedBy: 'cad_designer',
        caseId: case10.id,
      },
    ],
  });
  console.log(`  📋 Case ${caseId10} — design_approved (tech: start printing)`);

  // Case 11: Post-Processing — currently printing
  const caseId11 = `${doc1Username}SG-${yy}${mm}0011-010`;
  const case11 = await prisma.case.create({
    data: {
      customId: caseId11,
      patient: 'Ravi Nambiar',
      caseType: 'surgical_guide',
      type: 'SURGICAL GUIDE',
      material: 'Surgical Guide Resin',
      shade: 'N/A',
      toothNumbers: JSON.stringify([46]),
      archTarget: 'Lower',
      implantSystem: 'Nobel Active ∅3.5mm',
      instructions: 'Fully-guided kit. Use Nobel Biocare sleeve. Confirm guide fits over stent before dispatch.',
      status: 'post_processing',
      clinic: 'Hesyra Dental Clinic',
      due: 'Express',
      tech: 'Lab Technician',
      assignedTechId: techUser.id,
      assignedDesignerId: cadDesigner.id,
      doctorId: doctor1.id,
      totalAmountPaise: 300000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'CAD work assigned' },
          { label: '🎨 Design file(s) uploaded (1)' },
          { label: '✅ Design submitted for manager review (1 file)' },
          { label: '✅ Design approved by Manager' },
          { label: '🖨️ Post-processing started by Lab Technician' },
        ],
      },
    },
  });
  await prisma.caseFile.createMany({
    data: [
      {
        filename: 'cbct_scan_46_region.stl',
        path:     'uploads/seed-scan-case11-cbct.stl',
        size:     5120000,
        mimetype: 'model/stl',
        category: 'scan',
        uploadedBy: 'clinic',
        caseId: case11.id,
      },
      {
        filename: 'guide_46_nobelbiocare.stl',
        path:     'uploads/seed-design-case11-guide.stl',
        size:     980000,
        mimetype: 'model/stl',
        category: 'design',
        uploadedBy: 'cad_designer',
        caseId: case11.id,
      },
    ],
  });
  console.log(`  📋 Case ${caseId11} — post_processing (printing in progress)`);

  // Case 12: QA — physical item done, running quality checks
  const caseId12 = `${doc2Username}SP-${yy}${mm}0012-002`;
  const case12 = await prisma.case.create({
    data: {
      customId: caseId12,
      patient: 'Kavitha Reddy',
      caseType: 'splint',
      type: 'SPLINT / NIGHTGUARD',
      material: 'KeySplint Soft',
      shade: 'Clear',
      toothNumbers: JSON.stringify([17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27]),
      archTarget: 'Upper',
      instructions: 'Full arch occlusal splint. Soft material. Patient has severe bruxism — max thickness 3mm posterior.',
      status: 'qa',
      clinic: 'Smile Dental Care',
      due: 'Standard',
      tech: 'Lab Technician',
      assignedTechId: techUser.id,
      assignedDesignerId: cadDesigner.id,
      doctorId: doctor2.id,
      totalAmountPaise: 180000,
      timeline: {
        create: [
          { label: 'Case Submitted' },
          { label: 'CAD work assigned' },
          { label: '🎨 Design file(s) uploaded (1)' },
          { label: '✅ Design approved by Manager' },
          { label: '🖨️ Post-processing started' },
          { label: '🔬 Sent to Quality Check' },
        ],
      },
    },
  });
  await prisma.caseFile.createMany({
    data: [
      {
        filename: 'upper_arch_scan.stl',
        path:     'uploads/seed-scan-case12-arch.stl',
        size:     1800000,
        mimetype: 'model/stl',
        category: 'scan',
        uploadedBy: 'clinic',
        caseId: case12.id,
      },
      {
        filename: 'splint_upper_keysplint.stl',
        path:     'uploads/seed-design-case12-splint.stl',
        size:     720000,
        mimetype: 'model/stl',
        category: 'design',
        uploadedBy: 'cad_designer',
        caseId: case12.id,
      },
    ],
  });
  console.log(`  📋 Case ${caseId12} — qa (pending QC sign-off)`);

  // Also add scan files to the designer's existing cases (Case 5 and Case 8)
  await prisma.caseFile.createMany({
    data: [
      {
        filename: 'prep_scan_14_15.stl',
        path:     'uploads/seed-scan-case5-prep.stl',
        size:     1900000,
        mimetype: 'model/stl',
        category: 'scan',
        uploadedBy: 'clinic',
        caseId: (await prisma.case.findUnique({ where: { customId: caseId5 }, select: { id: true } })).id,
      },
      {
        filename: 'denture_impression.stl',
        path:     'uploads/seed-scan-case8-denture.stl',
        size:     3500000,
        mimetype: 'model/stl',
        category: 'scan',
        uploadedBy: 'clinic',
        caseId: (await prisma.case.findUnique({ where: { customId: caseId8 }, select: { id: true } })).id,
      },
    ],
  });
  console.log(`  📎 Scan files added to designer cases (${caseId5}, ${caseId8})`);

  // ═══════════════════════════════════════════════════════════════
  // BATCH SEGMENTATION TEST DATA — extra design_approved cases
  // Different materials to test auto-grouping
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  🏭 Creating batch segmentation test cases...');

  const batchCases = [
    { id: `${doc1Username}CB-${yy}${mm}0013-011`, patient: 'Amit Verma',    caseType: 'crown_bridge', type: 'CROWN', material: 'Graphy Ceramic', shade: 'A2', teeth: [21], doctor: doctor1 },
    { id: `${doc2Username}CB-${yy}${mm}0014-003`, patient: 'Priya Sharma',  caseType: 'crown_bridge', type: 'CROWN', material: 'Graphy Ceramic', shade: 'A3', teeth: [11], doctor: doctor2 },
    { id: `${doc1Username}CB-${yy}${mm}0015-012`, patient: 'Deepak Gupta',  caseType: 'crown_bridge', type: 'CROWN', material: 'Rodin Zirconia', shade: 'B1', teeth: [36], doctor: doctor1 },
    { id: `${doc2Username}CB-${yy}${mm}0016-004`, patient: 'Sneha Patil',   caseType: 'crown_bridge', type: 'CROWN', material: 'Rodin Zirconia', shade: 'A3.5', teeth: [46], doctor: doctor2 },
  ];

  for (const bc of batchCases) {
    const c = await prisma.case.create({
      data: {
        customId: bc.id,
        patient: bc.patient,
        caseType: bc.caseType,
        type: bc.type,
        material: bc.material,
        shade: bc.shade,
        toothNumbers: JSON.stringify(bc.teeth),
        instructions: `Standard ${bc.material} crown.`,
        status: 'design_approved',
        clinic: bc.doctor === doctor1 ? 'Hesyra Dental Clinic' : 'Smile Dental Care',
        due: 'Standard',
        tech: 'Lab Technician',
        assignedTechId: techUser.id,
        assignedDesignerId: cadDesigner.id,
        doctorId: bc.doctor.id,
        totalAmountPaise: 150000,
        timeline: {
          create: [
            { label: 'Case Submitted' },
            { label: '✅ Design approved — ready for production' },
          ],
        },
      },
    });
    await prisma.caseFile.create({
      data: {
        filename: `crown_${bc.teeth[0]}_design.stl`,
        path: `uploads/seed-design-batch-${bc.teeth[0]}.stl`,
        size: 1200000,
        mimetype: 'model/stl',
        category: 'design',
        uploadedBy: 'cad_designer',
        caseId: c.id,
      },
    });
    console.log(`  📋 Case ${bc.id} — design_approved (${bc.material})`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Support Tickets
  // ═══════════════════════════════════════════════════════════════
  console.log('\n  🎫 Creating support tickets...');

  await prisma.supportTicket.create({
    data: {
      subject: 'Shade mismatch on delivered crown',
      description: 'The crown delivered for case MH272CB doesn\'t match the A3 shade we requested. It appears significantly lighter (closer to A1). The patient has already noticed and is unhappy. We need either a replacement or a credit.',
      status: 'open',
      priority: 'high',
      userId: doctor1.id,
    },
  });
  console.log('  ✅ Ticket 1 — shade mismatch (Dr. Pranjal, high priority, open)');

  await prisma.supportTicket.create({
    data: {
      subject: 'Payment charged but case not dispatched',
      description: 'My wallet was debited ₹1,800 for the splint case but the case status shows overdue and nothing has been shipped. This is urgent — patient is waiting for their night guard.',
      status: 'in_progress',
      priority: 'urgent',
      userId: doctor2.id,
    },
  });
  console.log('  ✅ Ticket 2 — payment dispute (Dr. Shubham, urgent, in_progress)');

  // ═══════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  ✅ Production database ready');
  console.log(`     • 12 cases spanning the complete workflow`);
  console.log(`     • 7 accounts (admin, manager, tech, cad_designer, 3 clinics)`);
  console.log(`     • 2 wallets (₹5,000 + ₹0)`);
  console.log(`     • 1 strike applied (Dr. Shubham)`);
  console.log(`     • 2 support tickets (high + urgent)`);
  console.log(`     • Scan + design files seeded for tech & designer cases`);
  console.log('');
  console.log('  🔐 Login Credentials (password: Hesyra@2026):');
  console.log('     Admin:      admin@hesyra.com  OR  admin');
  console.log('     Manager:    manager@hesyra.com  OR  mgr_001');
  console.log('     Lab Tech:   tech@hesyra.com  OR  tech_001');
  console.log('     CAD Design: cad@hesyra.com  OR  cad_001');
  console.log('     Clinic 1:   doctor@hesyra.com  OR  MH272  (wallet: ₹5,000)');
  console.log('     Clinic 2:   doctor2@hesyra.com  OR  MH273  (Strike 1)');
  console.log('     Clinic 3:   newdoc@hesyra.com  OR  MH274  (onboarding test)');
  console.log('');
  console.log('  🎨 CAD Designer Queue (login: cad@hesyra.com):');
  console.log(`     ${caseId5}  — cad_assigned (priority ⚡, HAS scan file)`);
  console.log(`     ${caseId8}  — cad_assigned (HAS scan file)`);
  console.log(`     ${caseId7}  — design_revision (rework needed)`);
  console.log('');
  console.log('  🔧 Technician Production Queue (login: tech@hesyra.com):');
  console.log(`     ${caseId10}  — design_approved (⚡ ready to print, has design STL)`);
  console.log(`     ${caseId11}  — post_processing (printing in progress)`);
  console.log(`     ${caseId12}  — qa (awaiting QC sign-off)`);
  console.log(`     ${caseId3}   — payment_pending (HOLD)`);
  console.log(`     ${caseId4}   — overdue (HOLD)`);
  // ═══════════════════════════════════════════════════════════════
  // MATERIAL SKU CATALOG — Initial stock
  // ═══════════════════════════════════════════════════════════════
  console.log('🎨 Seeding Material SKU Catalog...');
  const skus = [
    // Crown & Bridge Materials
    { slug: 'ceramic_ultra', displayName: 'Ceramic Ultra', internalName: 'Graphy Ceramic', caseTypes: '["crown_bridge","veneer"]', category: 'ceramic', shadeApplicable: true, basePrice: 180000, premiumUpcharge: 19900, sortOrder: 1 },
    { slug: 'precision_zirconia', displayName: 'Precision Zirconia', internalName: 'Rodin Zirconia', caseTypes: '["crown_bridge","veneer"]', category: 'zirconia', shadeApplicable: true, basePrice: 250000, premiumUpcharge: 19900, sortOrder: 2 },
    { slug: 'bioresin_permanent', displayName: 'BioResin Permanent', internalName: 'VarseoSmile Crown Plus', caseTypes: '["crown_bridge"]', category: 'resin', shadeApplicable: true, basePrice: 150000, premiumUpcharge: 19900, sortOrder: 3 },
    { slug: 'bioresin_provisional', displayName: 'BioResin Provisional', internalName: 'Temp C&B Resin', caseTypes: '["crown_bridge"]', category: 'resin', shadeApplicable: true, basePrice: 80000, premiumUpcharge: null, finishingTiers: '["standard"]', sortOrder: 4 },
    // Veneer-specific
    { slug: 'porcelain_press', displayName: 'Porcelain Press', internalName: 'IPS e.max Press', caseTypes: '["veneer"]', category: 'ceramic', shadeApplicable: true, basePrice: 300000, premiumUpcharge: 50000, sortOrder: 5 },
    // Denture Materials
    { slug: 'acrylic_pro', displayName: 'Acrylic Pro', internalName: 'Lucitone Digital Print', caseTypes: '["denture"]', category: 'acrylic', shadeApplicable: true, basePrice: 450000, premiumUpcharge: 50000, sortOrder: 6 },
    { slug: 'flexiresin', displayName: 'FlexiResin', internalName: 'Valplast Flexible', caseTypes: '["denture"]', category: 'resin', shadeApplicable: true, basePrice: 500000, premiumUpcharge: 50000, sortOrder: 7 },
    // Surgical Guide
    { slug: 'surgical_clear', displayName: 'Surgical Clear Resin', internalName: 'Dental SG Resin', caseTypes: '["surgical_guide"]', category: 'resin', shadeApplicable: false, basePrice: 300000, premiumUpcharge: null, finishingTiers: '["standard"]', sortOrder: 8 },
    { slug: 'surgical_autoclave', displayName: 'Surgical Autoclavable', internalName: 'Dental SG+ Autoclave', caseTypes: '["surgical_guide"]', category: 'resin', shadeApplicable: false, basePrice: 400000, premiumUpcharge: null, finishingTiers: '["standard"]', sortOrder: 9 },
    // Splint & Guard
    { slug: 'guard_rigid', displayName: 'Rigid Guard Resin', internalName: null, caseTypes: '["splint"]', category: 'resin', shadeApplicable: false, basePrice: 180000, premiumUpcharge: null, finishingTiers: '["standard"]', sortOrder: 10 },
    { slug: 'guard_flex', displayName: 'Flex Guard Resin', internalName: null, caseTypes: '["splint"]', category: 'resin', shadeApplicable: false, basePrice: 200000, premiumUpcharge: null, finishingTiers: '["standard"]', sortOrder: 11 },
    // Retainer
    { slug: 'clear_retainer', displayName: 'Clear Retention Resin', internalName: null, caseTypes: '["retainer"]', category: 'resin', shadeApplicable: false, basePrice: 120000, premiumUpcharge: null, finishingTiers: '["standard"]', sortOrder: 12 },
  ];

  for (const sku of skus) {
    await prisma.materialSKU.create({
      data: {
        slug: sku.slug,
        displayName: sku.displayName,
        internalName: sku.internalName,
        caseTypes: sku.caseTypes,
        category: sku.category,
        shadeApplicable: sku.shadeApplicable,
        finishingTiers: sku.finishingTiers || '["standard","premium"]',
        basePrice: sku.basePrice,
        premiumUpcharge: sku.premiumUpcharge,
        sortOrder: sku.sortOrder,
        active: true,
      },
    });
  }
  console.log(`   ✓ ${skus.length} material SKUs created\n`);

  console.log('');
  console.log('  📋 Manager Actions Available:');
  console.log(`     ${caseId6}  — design_ready (approve or request revision)`);
  console.log(`     ${caseId5}  — priority case`);
  console.log('═══════════════════════════════════════════════════\n');
}

seed()
  .catch((e) => {
    console.error('❌ Bootstrap failed:');
    console.dir(e, { depth: null });
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
