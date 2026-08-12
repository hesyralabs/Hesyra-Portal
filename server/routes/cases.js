const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const { logAudit, AUDIT_ACTIONS } = require('../lib/auditLogger');
const paymentEngine = require('../lib/paymentEngine');
const paymentConfig = require('../lib/config');
const pricing = require('../lib/pricing');
const scanDay = require('../lib/scanDay');
const { updateDesignerStats, incrementActiveCount } = require('../lib/assignmentEngine');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════
// ROLE-BASED DATA BLINDING
// Applied in the serializer AFTER the query. This is a defence-in-depth
// layer — the primary control is the WHERE clause scoping below.
// ═══════════════════════════════════════════════════════════════════
function blindCaseData(c, role) {
  const base = {
    id:               c.customId,
    _dbId:            c.id,
    caseType:         c.caseType,
    type:             c.type,
    status:           c.status,
    due:              c.due,
    priorityFlag:     c.priorityFlag,
    createdAt:        c.createdAt,
    // Clinical
    patient:          c.patient,
    material:         c.material,
    shade:            c.shade,
    toothNumbers:     (() => { try { return JSON.parse(c.toothNumbers || '[]'); } catch { return []; } })(),
    archTarget:       c.archTarget,
    implantSystem:    c.implantSystem,
    instructions:     c.instructions,
    // SKU Catalog
    materialSkuId:    c.materialSkuId,
    finishingTier:    c.finishingTier,
    referencePhotoUrl:c.referencePhotoUrl,
    // Tracking
    trackingCourier:  c.trackingCourier,
    trackingNumber:   c.trackingNumber,
    packagedAt:       c.packagedAt,
    dispatchedAt:     c.dispatchedAt,
    rejectionReason:  c.rejectionReason,
    // The detail page rendered "Submitted on ·" with a blank date
    // because neither of these was ever sent.
    received:         c.createdAt ? new Date(c.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null,
    createdAt:        c.createdAt,
    warrantyYears:    c.warrantyYears,
    totalAmountPaise: c.totalAmountPaise,
    // A Scan Day crown bills at zero. Without this the case detail
    // page just shows no price at all, which reads as missing data
    // rather than as the complimentary crown the clinic earned.
    complimentary:    c.complimentary,
    // Doctor design approval — every role needs the deadline visible so
    // the lab can see what it is waiting on, not just the doctor.
    doctorApprovalSentAt: c.doctorApprovalSentAt,
    doctorApprovalDueAt:  c.doctorApprovalDueAt,
    doctorApprovedAt:     c.doctorApprovedAt,
    doctorApprovalMethod: c.doctorApprovalMethod,
    // Relations
    files:            (c.files || []).map(f => ({
      id:         f.id,
      name:       f.filename,
      url:        `/uploads/${path.basename(f.path)}`,
      size:       f.size,
      mimetype:   f.mimetype,
      category:   f.category,
      uploadedBy: f.uploadedBy,
      createdAt:  f.createdAt,
    })),
    messages:         (c.messages || []).map(m => ({
      from: m.from,
      text: m.text,
      time: new Date(m.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    })),
    timeline:         (c.timeline || []).map(t => {
      const at = new Date(t.createdAt);
      const today = new Date();
      const sameDay = at.toDateString() === today.toDateString();
      return {
        label: t.label,
        // A bare time is useless the moment a case is more than a day
        // old — show the date too, unless it happened today.
        time: sameDay
          ? at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
          : at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
            + ' · ' + at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
        at: t.createdAt,
        info: t.info || undefined,
        done: true,
      };
    }),
  };

  // ── Role-specific field exposure ──────────────────────────────
  switch (role) {
    case 'admin':
      // Admin sees everything
      return {
        ...base,
        clinic:               c.clinic,
        doctor:               c.doctor?.name || 'Unknown',
        tech:                 c.tech || 'Unassigned',
        assignedTechId:       c.assignedTechId,
        assignedDesignerId:   c.assignedDesignerId,
        internalNotes:        c.internalNotes,
        totalAmountPaise:     c.totalAmountPaise,
        depositPaidPaise:     c.depositPaidPaise,
        readyForDispatchAt:   c.readyForDispatchAt,
        paymentConfirmedAt:   c.paymentConfirmedAt,
        disputeActive:        c.disputeActive,
        disputeReason:        c.disputeReason,
        initials:             c.patient.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      };

    case 'manager':
      // Manager sees everything except CAD designer financial rates
      return {
        ...base,
        clinic:               c.clinic,
        doctor:               c.doctor?.name || 'Unknown',
        tech:                 c.tech || 'Unassigned',
        assignedTechId:       c.assignedTechId,
        assignedDesignerId:   c.assignedDesignerId,
        internalNotes:        c.internalNotes,
        // Financial: manager sees balance/payment status, read-only
        totalAmountPaise:     c.totalAmountPaise,
        depositPaidPaise:     c.depositPaidPaise,
        paymentConfirmedAt:   c.paymentConfirmedAt,
        disputeActive:        c.disputeActive,
        initials:             c.patient.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      };

    case 'technician':
      // Blind to: clinic identity, doctor identity, all financials
      return {
        ...base,
        tech:                 c.tech || 'Unassigned',
        assignedTechId:       c.assignedTechId,
        assignedDesignerId:   c.assignedDesignerId, // Needed to show who designed the case
        internalNotes:        c.internalNotes,
        dispatchPhotoUrl:     c.dispatchPhotoUrl,
        // BLINDED: clinic, doctor, totalAmountPaise, depositPaidPaise, paymentConfirmedAt
        initials:             c.patient.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      };

    case 'cad_designer':
      // Blind to: patient code, clinic, doctor, ALL financials
      // Only gets clinical + file data needed for design work
      return {
        id:           c.customId,
        _dbId:        c.id,
        caseType:     c.caseType,
        type:         c.type,
        status:       c.status,
        due:          c.due,
        priorityFlag: c.priorityFlag,
        // Clinical (needed for design)
        toothNumbers: (() => { try { return JSON.parse(c.toothNumbers || '[]'); } catch { return []; } })(),
        archTarget:   c.archTarget,
        implantSystem:c.implantSystem,
        shade:        c.shade,
        instructions: c.instructions,
        // Files
        files:        (c.files || []).map(f => ({
          id: f.id, name: f.filename,
          url: `/uploads/${path.basename(f.path)}`,
          category: f.category, mimetype: f.mimetype,
        })),
        // BLINDED: patient, clinic, doctor, material, financials
      };

    case 'dispatch':
      // Only needs status, shipping info, case ID — nothing else
      return {
        id:               c.customId,
        _dbId:            c.id,
        caseType:         c.caseType,
        status:           c.status,
        due:              c.due,
        priorityFlag:     c.priorityFlag,
        dispatchPhotoUrl: c.dispatchPhotoUrl,
        packagedAt:       c.packagedAt,
        // Shipping address comes from the doctor record (passed separately)
        // BLINDED: patient, clinic, financials, instructions
      };

    case 'clinic':
      // Sees own cases only. Blinded to: tech identity, designer identity, internal notes
      return {
        ...base,
        clinic:             c.clinic,
        doctor:             c.doctor?.name || 'Unknown',
        // Financial — own only
        totalAmountPaise:   c.totalAmountPaise,
        depositPaidPaise:   c.depositPaidPaise,
        paymentConfirmedAt: c.paymentConfirmedAt,
        disputeActive:      c.disputeActive,
        disputeReason:      c.disputeReason,
        // BLINDED: tech, assignedTechId, assignedDesignerId, internalNotes
        initials:           c.patient.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      };

    case 'ceramist':
      // Ceramist sees clinical info needed for finishing work (shade, material, instructions)
      // + reference photo for Signature Match finishing
      // Blinded to: clinic, doctor, financials, internal notes
      return {
        ...base,
        assignedCeramistId: c.assignedCeramistId,
        finishingTier:      c.finishingTier,
        referencePhotoUrl:  c.referencePhotoUrl,
        initials:           c.patient.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
        // BLINDED: clinic, doctor, tech, financials, internalNotes
      };

    default:
      return { id: c.customId, status: c.status }; // Fallback: minimal
  }
}

// ═══════════════════════════════════════════════════════════════════
// FILE UPLOAD — multer config
// ═══════════════════════════════════════════════════════════════════
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `${req.params.customId}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    // Allow STL, PLY, OBJ, ZIP, images, PDFs
    const allowed = ['.stl', '.ply', '.obj', '.zip', '.png', '.jpg', '.jpeg', '.pdf', '.dcm'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Accepted: ${allowed.join(', ')}`));
    }
  },
});

// ═══════════════════════════════════════════════════════════════════
// STATE MACHINE v2 — single source of truth (mirrors frontend STATUS_CONFIG)
//
// Flow:
//   submitted → cad_assigned → design_ready → design_approved →
//   post_processing → qa → ready_for_dispatch → payment_pending →
//   packaged → dispatched → completed
//
// Escape hatches:
//   blocked     → cad_assigned (designer flags scan as unusable)
//   design_revision → design_ready (back for redesign)
//   action_required → submitted (clinic corrects the issue)
//
// Force-transitions (admin/manager + mandatory reason) bypass this map.
// ═══════════════════════════════════════════════════════════════════
const VALID_TRANSITIONS = {
  // ─ Entry states ─
  draft:             ['submitted', 'cancelled'],
  submitted:         ['cad_assigned', 'action_required', 'cancelled'],
  action_required:   ['submitted', 'cancelled'],

  // ─ CAD workflow ─
  cad_assigned:      ['design_ready', 'blocked', 'cancelled'],
  blocked:           ['cad_assigned', 'cancelled'],
  // Lab QC passes the design, then the ordering doctor signs off on it.
  design_ready:      ['awaiting_doctor_approval', 'design_revision', 'cancelled'],
  awaiting_doctor_approval: ['design_approved', 'design_revision', 'cancelled'],
  design_revision:   ['design_ready', 'cancelled'],
  design_approved:   ['batched', 'post_processing', 'cancelled'],   // batched = new batch flow, post_processing = legacy

  // ─ Batch Production (new flow) ─
  batched:           ['printing', 'design_approved', 'cancelled'],  // printing via batch start; back to design_approved if removed
  // 'printing' status is set by batch.js when the batch starts printing
  // Premium (Signature Match) work goes to a ceramist; standard (Studio
  // Finish) has no ceramic stage, so it goes straight to QC rather than
  // queueing for a ceramist who has nothing to do.
  printed:           ['finishing', 'qa', 'cancelled'],
  finishing:         ['qa', 'cancelled'],                            // ceramist done → QC

  // ─ Legacy Production (still valid for non-batched cases) ─
  post_processing:   ['qa', 'cad_assigned', 'cancelled'],
  qa:                ['ready_for_dispatch', 'post_processing', 'cancelled'],

  // ─ Dispatch & payment ─
  // Payment lands the case back on ready_for_dispatch — paid, waiting to
  // be physically packed. Nothing goes straight to packaged: somebody has
  // to actually put it in a box.
  ready_for_dispatch:['packaged', 'payment_pending', 'cancelled'],
  payment_pending:   ['ready_for_dispatch', 'overdue', 'cancelled'],
  overdue:           ['ready_for_dispatch', 'payment_pending', 'cancelled'],
  packaged:          ['dispatched', 'cancelled'],
  dispatched:        ['completed', 'archived'],

  // ─ End states ─
  completed:         ['archived'],
  archived:          [],
  cancelled:         [],

  // ─ Legacy states ─
  designing:         ['design_ready', 'blocked', 'action_required', 'cancelled'],
  pending_approval:  ['design_approved', 'design_revision', 'cancelled'],
  printing:          ['printed', 'qa', 'post_processing', 'cancelled'],  // printed = batch complete
  shipped:           ['completed', 'archived'],
};

// ─── Who may drive a case INTO each status ─────────────────────
// The state machine says which moves are legal; this says who is allowed
// to make them. Production states belong to lab staff — a clinic may only
// submit, cancel, or confirm delivery of a case it owns.
const TRANSITION_ROLES = {
  draft:              ['clinic', 'manager', 'admin'],
  submitted:          ['clinic', 'manager', 'admin'],
  action_required:    ['cad_designer', 'technician', 'manager', 'admin'],
  cancelled:          ['clinic', 'manager', 'admin'],

  cad_assigned:       ['manager', 'admin'],
  blocked:            ['cad_designer', 'manager', 'admin'],
  design_ready:       ['cad_designer', 'manager', 'admin'],
  // Sent to the doctor by the manager after lab QC.
  awaiting_doctor_approval: ['manager', 'admin'],
  // The doctor requests changes; manager may also do it on their behalf.
  design_revision:    ['clinic', 'manager', 'admin'],
  // Clinical sign-off belongs to the ordering doctor. Manager/admin retain
  // it for the escalation path when a doctor never responds.
  design_approved:    ['clinic', 'manager', 'admin'],

  batched:            ['technician', 'manager', 'admin'],
  printing:           ['technician', 'manager', 'admin'],
  printed:            ['technician', 'manager', 'admin'],
  finishing:          ['technician', 'ceramist', 'manager', 'admin'],
  post_processing:    ['technician', 'manager', 'admin'],
  qa:                 ['technician', 'ceramist', 'manager', 'admin'],

  ready_for_dispatch: ['technician', 'manager', 'admin'],
  payment_pending:    ['manager', 'admin'],
  overdue:            ['manager', 'admin'],
  packaged:           ['technician', 'dispatch', 'manager', 'admin'],
  dispatched:         ['technician', 'dispatch', 'manager', 'admin'],
  shipped:            ['technician', 'dispatch', 'manager', 'admin'],

  completed:          ['clinic', 'dispatch', 'manager', 'admin'],
  archived:           ['manager', 'admin'],
};

// Statuses that physically hand the prosthesis over. None may be reached
// until the case is paid for, or was knowingly dispatched on Net-30 credit.
const DISPATCH_STATUSES = ['packaged', 'dispatched', 'shipped'];

const STATUS_LABELS = {
  draft:              'Draft',
  submitted:          'Submitted',
  action_required:    'Action Required',
  cad_assigned:       'CAD Assigned',
  blocked:            'Blocked — Scan Issue',
  design_ready:       'Design Ready for Review',
  awaiting_doctor_approval: 'Awaiting Your Approval',
  design_revision:    'Revision Requested',
  design_approved:    'Design Approved',
  // Batch production
  batched:            'Batched — Awaiting Print',
  printing:           'Printing (Batch)',
  printed:            'Printed — Awaiting Ceramist',
  finishing:          'Ceramist Finishing',
  // Legacy production
  post_processing:    'Post-Processing',
  qa:                 'QA / Final Check',
  ready_for_dispatch: 'Ready for Dispatch',
  payment_pending:    'Payment Pending',
  packaged:           'Packaged',
  dispatched:         'Dispatched',
  overdue:            'Overdue',
  completed:          'Delivered',
  archived:           'Archived',
  cancelled:          'Cancelled',
  // Legacy
  designing:          'Designing (CAD)',
  pending_approval:   'Pending Approval',
  shipped:            'Shipped',
};

const CASE_PRICING = {
  crown_bridge: 1500, surgical_guide: 3000, splint: 1800,
  retainer: 1200, aligner: 2500, denture: 4500, veneer: 2000,
  model: 400, default: 1000,
};

const CASE_TYPE_CODES = {
  crown_bridge: 'CB', surgical_guide: 'SG', splint: 'SP',
  retainer: 'RT', aligner: 'AL', denture: 'DN', veneer: 'VN',
  model: 'MD', draft: 'DR',
};

async function generateCaseId(doctorId, caseType) {
  // 1. Fetch doctor's geo-coded username (e.g. "MH272")
  const doctor = await prisma.user.findUnique({
    where: { id: doctorId },
    select: { username: true },
  });
  const docUsername = doctor?.username || 'XX000';

  // 2. Map case type to 2-letter code
  const typeCode = CASE_TYPE_CODES[caseType] || 'XX';

  // 3. Compute current YYMM (e.g. "2604" for April 2026)
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const monthKey = `month:${yy}${mm}`;

  // 4. Atomically increment monthly counter
  const monthCounter = await prisma.counter.upsert({
    where: { id: monthKey },
    update: { value: { increment: 1 } },
    create: { id: monthKey, value: 1 },
  });

  // 5. Atomically increment per-doctor lifetime counter
  const docCounter = await prisma.counter.upsert({
    where: { id: `doc:${doctorId}` },
    update: { value: { increment: 1 } },
    create: { id: `doc:${doctorId}`, value: 1 },
  });

  // 6. Assemble: MH272CB-26040003-007
  const monthlySeq = String(monthCounter.value).padStart(4, '0');
  const docLifetimeSeq = String(docCounter.value).padStart(3, '0');

  return `${docUsername}${typeCode}-${yy}${mm}${monthlySeq}-${docLifetimeSeq}`;
}

function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return allowed && allowed.includes(to);
}

// ─── GET /api/cases ────────────────────────────────────────────
// Scoped by role at the WHERE clause level. Blinded at serializer level.
router.get('/', authenticate, async (req, res) => {
  try {
    const role = req.user.role;
    let where = {};

    switch (role) {
      case 'admin':
      case 'manager':
        where = {}; // All cases
        break;
      case 'technician':
        // Technician scope: ONLY cases explicitly assigned to THIS technician.
        // They never see unassigned cases — the manager must assign first.
        where = {
          assignedTechId: req.user.id,
          status: {
            in: [
              // Batch flow
              'design_approved', 'batched', 'printing', 'printed', 'finishing',
              // Legacy / post-batch
              'post_processing', 'qa',
              'ready_for_dispatch', 'payment_pending', 'overdue',
              'packaged', 'dispatched',
              // Legacy states
              'shipped',
            ],
          },
        };
        break;
      case 'cad_designer':
        // Only cases explicitly assigned to this designer
        where = { assignedDesignerId: req.user.id };
        break;
      case 'dispatch':
        // Only cases ready for physical handling
        where = { status: { in: ['ready_for_dispatch', 'packaged'] } };
        break;
      case 'clinic':
        // Server-enforced: only this clinic's cases. doctorId from JWT, never from query params.
        where = { doctorId: req.user.id };
        break;
      default:
        return res.status(403).json({ error: 'Unknown role — cannot scope case list' });
    }

    const cases = await prisma.case.findMany({
      where,
      include: {
        doctor:           { select: { id: true, customId: true, username: true, name: true, clinic: true } },
        assignedTech:     { select: { id: true, name: true, username: true } },
        assignedDesigner: { select: { id: true, name: true, username: true } },
        timeline:         { orderBy: { createdAt: 'asc' } },
        messages:         { orderBy: { createdAt: 'asc' } },
        files:            { orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ priorityFlag: 'desc' }, { createdAt: 'desc' }],
    });

    const transformed = cases.map(c => blindCaseData(c, role));
    res.json(transformed);
  } catch (err) {
    console.error('GET /cases error:', err);
    res.status(500).json({ error: 'Failed to fetch cases' });
  }
});

// ─── GET /api/cases/:customId ──────────────────────────────────
router.get('/:customId', authenticate, async (req, res) => {
  try {
    const c = await prisma.case.findUnique({
      where: { customId: req.params.customId },
      include: {
        doctor:           { select: { id: true, customId: true, username: true, name: true, clinic: true } },
        assignedTech:     { select: { id: true, name: true, username: true } },
        assignedDesigner: { select: { id: true, name: true, username: true } },
        timeline:         { orderBy: { createdAt: 'asc' } },
        messages:         { orderBy: { createdAt: 'asc' } },
        files:            { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Ownership check: clinics can only access their own cases
    if (req.user.role === 'clinic' && c.doctorId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    // CAD designers can only access assigned cases
    if (req.user.role === 'cad_designer' && c.assignedDesignerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(blindCaseData(c, req.user.role));
  } catch (err) {
    console.error('GET /cases/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch case' });
  }
});

// ─── POST /api/cases ───────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { patientName, caseType, type: reqType, material, shade, toothNumbers, archTarget, implantSystem, instructions, isDraft, materialSkuId, finishingTier, specificType } = req.body;

    // Generate smart geo-coded case ID
    const doctorId = req.body.doctorId || req.user.id;

    // ─── Trust Level Check ──────────────────────────────────
    const doctor = await prisma.user.findUnique({ where: { id: doctorId } });
    if (doctor && doctor.trustLevel === 'suspended') {
      return res.status(403).json({ error: 'Account suspended. Please submit a resolution ticket.', suspended: true });
    }
    if (doctor && doctor.trustLevel === 'banned') {
      return res.status(403).json({ error: 'Account permanently banned.', banned: true });
    }

    const customId = await generateCaseId(doctorId, caseType || 'draft');
    const depositRequired = paymentEngine.getDepositRequired(doctor?.trustLevel);
    
    // Safety lock: if deposit is required, initialize strictly as draft until cleared
    let initialStatus = (depositRequired > 0 || isDraft) ? 'draft' : 'submitted';

    // Submitted cases enter the open designer pool immediately
    const poolEnteredAt = (!isDraft && depositRequired === 0) ? new Date() : null;

    // ─── SKU Validation & Pricing ──────────────────────────────
    let resolvedMaterialSkuId = materialSkuId || null;
    let skuRecord = null;

    if (materialSkuId) {
      skuRecord = await prisma.materialSKU.findUnique({ where: { id: materialSkuId } });
      if (!skuRecord) {
        return res.status(400).json({ error: 'Selected material does not exist.' });
      }
      if (!skuRecord.active) {
        return res.status(400).json({ error: `${skuRecord.displayName} is currently out of stock.` });
      }
      // Verify the SKU supports this case type
      try {
        const skuCaseTypes = JSON.parse(skuRecord.caseTypes);
        if (!skuCaseTypes.includes(caseType)) {
          return res.status(400).json({ error: `${skuRecord.displayName} is not available for ${caseType} cases.` });
        }
      } catch { /* JSON parse fail — allow through */ }
    }

    // ─── Parse tooth count ─────────────────────────────────────
    // Needed by crowns/bridges, inlays and veneers alike, so it is
    // parsed for every case type rather than crowns only.
    let teeth = [];
    if (typeof toothNumbers === 'string') {
      try { teeth = JSON.parse(toothNumbers); } catch { teeth = []; }
    } else if (Array.isArray(toothNumbers)) {
      teeth = toothNumbers;
    }
    const toothCount = teeth.length > 0 ? teeth.length : 1;

    // ─── Price the case ────────────────────────────────────────
    // All category rules (aligner tiers, per-implant guides, veneer
    // base cases, Signature Match) live in lib/pricing.js, which also
    // applies GST @5% on top of the published net prices.
    let quote;
    try {
      quote = pricing.quoteCase({
        caseType,
        sku: skuRecord,
        toothCount,
        archTarget,
        implantCount:        req.body.implantCount,
        virtualSurgicalPlan: !!req.body.virtualSurgicalPlan,
        alignerTier:         req.body.alignerTier,
        extraAlignerSets:    req.body.extraAlignerSets,
        specificType,
        finishingTier,
      });
    } catch (err) {
      if (err instanceof pricing.PricingError) {
        return res.status(400).json({ error: err.message, ...err.details });
      }
      throw err;
    }

    const netAmountPaise = quote.netPaise;
    const gstAmountPaise = quote.gstPaise;
    // Not const — a redeemed Scan Day credit zeroes this below.
    let totalAmountPaise = quote.totalPaise;

    let displayType = reqType || (caseType || 'Draft').replace('_', ' & ').toUpperCase();

    const newCase = await prisma.case.create({
      data: {
        customId,
        patient: patientName || 'Draft Patient',
        caseType: caseType || 'draft',
        type: displayType,
        material: material || (skuRecord?.displayName) || 'N/A',
        shade: shade || 'N/A',
        toothNumbers: JSON.stringify(toothNumbers || []),
        archTarget: archTarget || '',
        implantSystem: implantSystem || '',
        instructions: instructions || '',
        status: initialStatus,
        // Derive from the doctor record — this name ends up on the GST
        // invoice, so it must not depend on a client-supplied value.
        clinic: doctor?.clinic || req.body.clinic || 'Unknown Clinic',
        due: 'TBD',
        doctorId: doctorId,
        totalAmountPaise,
        poolEnteredAt,       // ← enters pool on submit
        // ─── SKU Catalog fields ──────────────────────
        materialSkuId: resolvedMaterialSkuId,
        finishingTier: finishingTier || 'standard',
        // ─── Category-specific pricing inputs ────────
        implantCount:        req.body.implantCount != null ? Number(req.body.implantCount) : null,
        virtualSurgicalPlan: !!req.body.virtualSurgicalPlan,
        alignerTier:         req.body.alignerTier || null,
        extraAlignerSets:    Number(req.body.extraAlignerSets) || 0,
        // Snapshot the warranty sold with this tier — the published
        // term may change, but this case is owed what it was sold.
        warrantyYears:       skuRecord?.warrantyYears ?? null,
      },
      include: { doctor: { select: { id: true, name: true, clinic: true, trustLevel: true } }, timeline: true, messages: true },
    });

    // ─── Collect Deposit if Strike 1/2 ────────────────────────
    let depositResult = null;
    let caseIsLive = false; // True when case is submitted & enters the pool

    if (depositRequired > 0 && !isDraft) {
      depositResult = await paymentEngine.collectDeposit(doctorId, newCase.id, depositRequired);

      if (depositResult.collected) {
        // Deposit cleared instantly from wallet — case enters the live pool NOW
        // Fix #1: also set poolEnteredAt so pool system can see it
        await prisma.case.update({
          where: { id: newCase.id },
          data: { status: 'submitted', poolEnteredAt: new Date() },
        });
        await prisma.timeline.create({ data: { caseId: newCase.id, label: 'Case Submitted' } });
        caseIsLive = true;
      } else {
        // Awaiting external payment — case stays as draft until webhook fires
        await prisma.timeline.create({ data: { caseId: newCase.id, label: 'Awaiting Security Deposit' } });
      }
    } else if (!isDraft) {
      // Normal flow (no deposit needed) — already live from creation
      await prisma.timeline.create({ data: { caseId: newCase.id, label: 'Case Submitted' } });
      caseIsLive = true;
    }

    // Broadcast via Socket.io — only when case is actually live (not pending deposit)
    const io = req.app.get('io');
    if (io && caseIsLive) {
      io.emit('case:created', { customId: newCase.customId });
      // Notify all designers that a new case is available in the open pool
      io.emit('pool:new_case', { customId: newCase.customId, caseType: caseType });
    }

    // ─── Scan Day launch offer ────────────────────────────────
    // A crown order inside an open scan-visit window may earn the
    // clinic complimentary crowns. Best-effort: never fail the order
    // because the reward bookkeeping had a problem.
    let scanDayReward = null;
    if (!isDraft) {
      // Redemption changes what the clinic is charged, so it is NOT
      // best-effort — a failure here must surface, not be swallowed.
      if (req.body.useCrownCredit) {
        const used = await scanDay.redeemCreditFor(newCase, req.body.crownCreditId);
        if (used) {
          scanDayReward = { redeemed: true, credit: used };
          totalAmountPaise = 0;
        }
      }

      // Earning credits is bookkeeping — never fail an order over it.
      try {
        const { visit, newCredits } = await scanDay.registerCrownOrder(newCase);
        if (newCredits.length) {
          scanDayReward = { ...(scanDayReward || {}), earned: newCredits.length, visitId: visit?.customId };
          await prisma.timeline.create({
            data: {
              caseId: newCase.id,
              label: `🎁 Scan Day reward — ${newCredits.length} complimentary crown${newCredits.length > 1 ? 's' : ''} earned`,
              info: newCredits[0].reason,
            },
          });
        }
      } catch (offerErr) {
        console.error('Scan Day offer processing failed:', offerErr.message);
      }
    }

    // The opening entry of the case's record.
    await logAudit({
      req,
      action:     AUDIT_ACTIONS.CASE_CREATED,
      entityType: 'case',
      entityId:   newCase.id,
      afterState: {
        customId: newCase.customId,
        caseType: newCase.caseType,
        status:   newCase.status,
        totalAmountPaise,
      },
      reason:     isDraft ? 'Draft created' : 'Prescription submitted',
      metadata:   { customId: newCase.customId, clinic: newCase.clinic },
    });

    res.status(201).json({
      success: true,
      id: newCase.customId,
      totalAmountPaise,
      totalAmountINR: paymentConfig.paiseToINR(totalAmountPaise),
      // Itemised so the clinic can see exactly how the figure was built.
      pricing: {
        lines: quote.lines,
        netPaise: netAmountPaise,
        gstPaise: gstAmountPaise,
        gstRate: quote.gstRate,
      },
      warrantyYears: newCase.warrantyYears,
      scanDayReward,
      depositRequired,
      depositResult,
    });
  } catch (err) {
    console.error('POST /cases error:', err);
    res.status(500).json({ error: 'Failed to create case' });
  }
});

// ─── PUT /api/cases/:customId/status ───────────────────────────
router.put('/:customId/status', authenticate, async (req, res) => {
  try {
    const { newStatus, timelineLabel, timelineInfo, rejectionReason, tracking, force, reason } = req.body;
    const c = await prisma.case.findUnique({ where: { customId: req.params.customId } });

    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Force-override requires admin or manager, and a reason
    if (force) {
      if (!['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Only admin or manager can force-override case states' });
      }
      if (!reason || !reason.trim()) {
        return res.status(400).json({ error: 'A reason is mandatory for force state overrides' });
      }
    }

    // ─── Authorization ────────────────────────────────────────
    // A clinic may only ever touch its own case, whatever the move.
    if (req.user.role === 'clinic' && c.doctorId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!force) {
      const allowedRoles = TRANSITION_ROLES[newStatus];
      if (!allowedRoles) {
        return res.status(400).json({ error: `Unknown target status: ${newStatus}` });
      }
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          error: `Your role cannot move a case to "${newStatus}"`,
          yourRole: req.user.role,
        });
      }
    }

    // State machine validation
    if (!force && !isValidTransition(c.status, newStatus)) {
      return res.status(400).json({
        error: `Invalid transition: ${c.status} → ${newStatus}`,
        allowed: VALID_TRANSITIONS[c.status],
      });
    }

    // ─── Assignment guards (even for normal transitions) ───────
    const cadStatuses = ['cad_assigned', 'design_ready', 'design_revision', 'blocked'];
    if (cadStatuses.includes(newStatus) && !c.assignedDesignerId) {
      return res.status(400).json({
        error: 'Cannot enter CAD pipeline — a designer must be assigned first',
      });
    }

    const productionStatuses = ['design_approved', 'batched', 'printing', 'printed', 'finishing', 'post_processing', 'qa', 'ready_for_dispatch', 'packaged'];
    if (productionStatuses.includes(newStatus) && !c.assignedTechId) {
      return res.status(400).json({
        error: 'Cannot enter production — a technician must be assigned first',
      });
    }

    // ─── Hard Rule: no hand-over without payment ──────────────
    // Checked BEFORE the write. Covers the whole dispatch group, not just
    // the legacy 'shipped' status — packaged/dispatched are the states the
    // batch-era flow actually uses, and they were previously ungated.
    if (!force && DISPATCH_STATUSES.includes(newStatus)) {
      if (!c.paymentConfirmedAt && !c.dispatchedOnCredit) {
        return res.status(400).json({
          error: 'Cannot dispatch without confirmed payment',
          caseStatus: c.status,
          amountDuePaise: (c.totalAmountPaise || 0) - (c.depositPaidPaise || 0),
        });
      }
    }

    // ─── Dispatch requires a real hand-over record ────────────
    // A courier and consignment number are what let the clinic chase a
    // parcel, and they are the only proof the lab actually sent it.
    if (!force && (newStatus === 'dispatched' || newStatus === 'shipped')) {
      const courier = tracking?.courier || c.trackingCourier;
      const number  = tracking?.number  || c.trackingNumber;
      if (!courier || !number) {
        return res.status(400).json({
          error: 'Enter the courier and consignment number before dispatching.',
        });
      }
    }

    const updateData = { status: newStatus };

    if (newStatus === 'packaged') {
      updateData.packagedAt = c.packagedAt || new Date();
    }
    if (newStatus === 'dispatched' || newStatus === 'shipped') {
      updateData.dispatchedAt = c.dispatchedAt || new Date();
    }

    if (rejectionReason) updateData.rejectionReason = rejectionReason;
    if (newStatus === 'submitted' && c.status === 'action_required') updateData.rejectionReason = null;
    if (tracking) {
      updateData.trackingNumber = tracking.number;
      updateData.trackingCourier = tracking.courier;
    }

    // Update case
    await prisma.case.update({ where: { customId: req.params.customId }, data: updateData });

    // Add timeline entry
    const label = timelineLabel || `Status → ${STATUS_LABELS[newStatus] || newStatus}`;
    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label,
        info: timelineInfo || null,
      },
    });

    // ─── Handle ready_for_dispatch: Trigger payment flow ─────
    let finalReturnedStatus = newStatus;

    if (newStatus === 'ready_for_dispatch') {
      try {
        const paymentResult = await paymentEngine.processReadyForDispatch(c.id);
        // Wallet/credit settle immediately — the case stays on
        // ready_for_dispatch, paid and waiting to be packed.
        if (paymentResult.mode === 'wallet_auto' || paymentResult.mode === 'credit') {
          const io2 = req.app.get('io');
          if (io2) {
            io2.emit('payment:confirmed', { caseId: c.customId });
            io2.emit('invoice:created', {});
            io2.emit('wallet:updated', { userId: c.doctorId });
          }
          return res.json({ success: true, paymentResult, finalStatus: 'ready_for_dispatch' });
        } else if (paymentResult.mode === 'credit_blocked') {
          finalReturnedStatus = 'ready_for_dispatch';
        } else {
          finalReturnedStatus = 'payment_pending';
        }
      } catch (payErr) {
        console.error('Payment processing error:', payErr);
        // Continue — case is still updated to ready_for_dispatch
      }
    }

    // (The dispatch payment gate now runs before the write, above — it
    // used to sit here, after the case had already been updated, and only
    // matched the legacy 'shipped' status.)

    // ─── Handle Cancellation/Rejection Refunds ────────────────
    if (newStatus === 'cancelled') {
      try {
        const refundResult = await paymentEngine.issueRefund(c.id, rejectionReason || 'Case cancelled');
        if (refundResult.refunded) {
          const io2 = req.app.get('io');
          if (io2) io2.emit('wallet:updated', { userId: c.doctorId }); // Tell UI to bump wallet
        }
      } catch (refundErr) {
        console.error('Refund processing error:', refundErr);
      }
    }

    // ─── Audit EVERY transition, not just the forced ones ──────
    // A case has to be reconstructable long after it closes: who moved
    // it, from what to what, when, and from where. The Timeline entry
    // above is the clinic-facing story and carries no actor at all.
    await logAudit({
      req,
      action:     force ? AUDIT_ACTIONS.CASE_STATE_FORCE : AUDIT_ACTIONS.CASE_STATUS_CHANGE,
      entityType: 'case',
      entityId:   c.id,
      beforeState:{ status: c.status },
      afterState: { status: newStatus },
      reason:     reason || (force ? '' : `${c.status} → ${newStatus}`),
      metadata:   {
        customId: c.customId,
        forced: !!force,
        ...(tracking ? { courier: tracking.courier, consignment: tracking.number } : {}),
        ...(rejectionReason ? { rejectionReason } : {}),
      },
    });

    // ─── Update designer stats on key milestones ───────────────────
    // Trigger recalculation when design work completes or is revised
    if (c.assignedDesignerId) {
      const statsUpdateStatuses = ['design_approved', 'design_revision', 'design_ready'];
      if (statsUpdateStatuses.includes(newStatus)) {
        // Fire-and-forget — don’t block the response
        updateDesignerStats(c.assignedDesignerId).catch(e =>
          console.error('Stats update failed:', e)
        );
      }
      // Sync active count when designer’s case finishes the CAD pipeline
      if (['design_approved', 'cancelled'].includes(newStatus)) {
        incrementActiveCount(c.assignedDesignerId, -1).catch(() => {});
      }
    }

    // Broadcast status change
    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.customId, newStatus: finalReturnedStatus });

    res.json({ success: true, finalStatus: finalReturnedStatus });
  } catch (err) {
    console.error('PUT /cases/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update case status' });
  }
});

// ─── PUT /api/cases/:customId/design-approval ─────────────────
// The ordering doctor signs off on the CAD design, or sends it back.
// Body: { action: 'approve' | 'revise', reason? }
router.put('/:customId/design-approval', authenticate, requireRole('clinic'), async (req, res) => {
  try {
    const { action, reason } = req.body;
    if (!['approve', 'revise'].includes(action)) {
      return res.status(400).json({ error: 'action must be "approve" or "revise"' });
    }
    if (action === 'revise' && (!reason || !reason.trim())) {
      return res.status(400).json({ error: 'Tell the lab what needs changing' });
    }

    const c = await prisma.case.findUnique({ where: { customId: req.params.customId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });
    if (c.doctorId !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    if (c.status !== 'awaiting_doctor_approval') {
      return res.status(400).json({
        error: `This case is not awaiting your approval (status: ${c.status}).`,
      });
    }

    // Production cannot start without a technician, same guard the manager
    // path enforces — otherwise approval strands the case.
    if (action === 'approve' && !c.assignedTechId) {
      return res.status(400).json({ error: 'The lab has not assigned a technician yet. Please try again shortly.' });
    }

    const newStatus = action === 'approve' ? 'design_approved' : 'design_revision';

    await prisma.case.update({
      where: { id: c.id },
      data: {
        status: newStatus,
        ...(action === 'approve'
          ? { doctorApprovedAt: new Date(), doctorApprovalMethod: 'doctor', rejectionReason: null }
          : { rejectionReason: reason.trim() }),
      },
    });

    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label: action === 'approve'
          ? '✅ Design approved by doctor'
          : '↩️ Changes requested by doctor',
        info: action === 'revise' ? reason.trim() : undefined,
      },
    });

    // The clinical sign-off. This is the entry anyone auditing a
    // remake or a complaint will look for first, so it records the
    // doctor, the moment, and their stated reason verbatim.
    await logAudit({
      req,
      action:     action === 'approve' ? AUDIT_ACTIONS.DESIGN_APPROVED : AUDIT_ACTIONS.DESIGN_REVISION,
      entityType: 'case',
      entityId:   c.id,
      beforeState:{ status: c.status },
      afterState: { status: newStatus, doctorApprovalMethod: action === 'approve' ? 'doctor' : null },
      reason:     action === 'approve' ? 'Design approved by ordering doctor' : reason.trim(),
      metadata:   { customId: c.customId },
    });

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: c.customId, newStatus });

    res.json({ success: true, newStatus });
  } catch (err) {
    console.error('PUT /cases/:id/design-approval error:', err);
    res.status(500).json({ error: 'Failed to record design decision' });
  }
});

// ─── PUT /api/cases/:customId ──────────────────────────────────
router.put('/:customId', authenticate, async (req, res) => {
  try {
    const { tech, due, tracking, ...otherData } = req.body;
    const c = await prisma.case.findUnique({ where: { customId: req.params.customId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // A clinic may only edit its own case.
    if (req.user.role === 'clinic' && c.doctorId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updateData = {};
    if (tech !== undefined) updateData.tech = tech;
    if (due !== undefined) updateData.due = due;
    if (tracking) {
      updateData.trackingNumber = tracking.number;
      updateData.trackingCourier = tracking.courier;
    }

    // Allow updating other safe fields
    const safeFields = ['patient', 'material', 'shade', 'instructions', 'archTarget', 'implantSystem', 'referencePhotoUrl', 'materialSkuId', 'finishingTier'];
    safeFields.forEach(f => { if (otherData[f] !== undefined) updateData[f] = otherData[f]; });

    await prisma.case.update({ where: { customId: req.params.customId }, data: updateData });

    // ─── Audit the edit, field by field ────────────────────────
    // Only the fields that actually changed, with their old and new
    // values, so a later reader can see that (say) the shade was
    // altered after the design was approved — and by whom.
    const changed = {};
    Object.keys(updateData).forEach(k => {
      if (c[k] !== updateData[k]) changed[k] = { from: c[k] ?? null, to: updateData[k] ?? null };
    });

    if (Object.keys(changed).length > 0) {
      await logAudit({
        req,
        action:     AUDIT_ACTIONS.CASE_EDITED,
        entityType: 'case',
        entityId:   c.id,
        beforeState: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.from])),
        afterState:  Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v.to])),
        reason:     `Edited: ${Object.keys(changed).join(', ')}`,
        metadata:   { customId: c.customId },
      });
    }

    // If tech assigned, add timeline entry
    if (tech && tech !== 'Unassigned' && tech !== c.tech) {
      await prisma.timeline.create({
        data: { caseId: c.id, label: `Assigned to ${tech}` },
      });
      await logAudit({
        req,
        action:     AUDIT_ACTIONS.CASE_ASSIGNED,
        entityType: 'case',
        entityId:   c.id,
        beforeState:{ tech: c.tech },
        afterState: { tech },
        reason:     `Assigned to ${tech}`,
        metadata:   { customId: c.customId },
      });
    }

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.customId });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /cases/:id error:', err);
    res.status(500).json({ error: 'Failed to update case' });
  }
});

// ─── POST /api/cases/:customId/messages ────────────────────────
router.post('/:customId/messages', authenticate, async (req, res) => {
  try {
    const { text, from } = req.body;
    const c = await prisma.case.findUnique({ where: { customId: req.params.customId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    // A clinic may only post into its own case's chat.
    if (req.user.role === 'clinic' && c.doctorId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const message = await prisma.message.create({
      data: {
        text,
        from: from || (req.user.role === 'clinic' ? 'doctor' : 'lab'),
        caseId: c.id,
        userId: req.user.id,
      },
    });

    const io = req.app.get('io');
    if (io) io.emit('case:message', { customId: req.params.customId, message: { from: message.from, text: message.text, time: new Date(message.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) } });

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('POST /cases/:id/messages error:', err);
    res.status(500).json({ error: 'Failed to add message' });
  }
});

// ─── DELETE /api/cases/:customId ───────────────────────────────
router.delete('/:customId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const c = await prisma.case.findUnique({ where: { customId: req.params.customId } });
    if (!c) return res.status(404).json({ error: 'Case not found' });

    await prisma.case.delete({ where: { id: c.id } });

    const io = req.app.get('io');
    if (io) io.emit('case:deleted', { customId: req.params.customId });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /cases/:id error:', err);
    res.status(500).json({ error: 'Failed to delete case' });
  }
});

// ─── POST /api/cases/:customId/upload ─────────────────────────
// Upload scan files (from clinic) or design files (from technician/designer)
router.post('/:customId/upload', authenticate, upload.array('files', 10), async (req, res) => {
  try {
    const c = await prisma.case.findUnique({ where: { customId: req.params.customId } });
    if (!c) {
      if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
      return res.status(404).json({ error: 'Case not found' });
    }

    // A clinic may only attach files to its own case.
    if (req.user.role === 'clinic' && c.doctorId !== req.user.id) {
      if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // --- File Content Validation (Anti-Malware) ---
    for (const file of req.files) {
      try {
        const buffer = Buffer.alloc(8);
        const fd = fs.openSync(file.path, 'r');
        fs.readSync(fd, buffer, 0, 8, 0);
        fs.closeSync(fd);
        
        const hex = buffer.toString('hex').toUpperCase();
        
        // Reject executables and scripts
        const isMalicious = 
          hex.startsWith('4D5A') || // Windows EXE/DLL (MZ)
          hex.startsWith('7F454C46') || // Linux ELF
          hex.startsWith('2321'); // Shell script (#!)

        if (isMalicious) {
          // Cleanup all uploaded files
          req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
          return res.status(400).json({ error: `File ${file.originalname} contains prohibited executable content.` });
        }
      } catch (err) {
        console.error('File validation error:', err);
        req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
        return res.status(500).json({ error: 'Failed to validate file contents.' });
      }
    }
    // ----------------------------------------------

    // Map role to uploadedBy label and default category
    const roleMap = {
      clinic:       { uploadedBy: 'clinic',       category: 'scan' },
      technician:   { uploadedBy: 'lab',          category: 'design' },
      cad_designer: { uploadedBy: 'cad_designer', category: 'design' },
      dispatch:     { uploadedBy: 'dispatch',     category: 'dispatch_photo' },
      manager:      { uploadedBy: 'lab',          category: 'design' },
      admin:        { uploadedBy: 'lab',          category: 'design' },
    };
    const { uploadedBy, category: defaultCategory } = roleMap[req.user.role] || { uploadedBy: 'lab', category: 'scan' };
    const category = req.body.category || defaultCategory;

    const fileRecords = await Promise.all(
      req.files.map(file =>
        prisma.caseFile.create({
          data: {
            filename: file.originalname,
            path: file.path,
            size: file.size,
            mimetype: file.mimetype,
            category,
            uploadedBy,
            caseId: c.id,
          },
        })
      )
    );

    // Files are evidence. Who attached what, and when, has to survive.
    await logAudit({
      req,
      action:     AUDIT_ACTIONS.CASE_FILE_UPLOADED,
      entityType: 'case',
      entityId:   c.id,
      afterState: { files: fileRecords.map(f => ({ id: f.id, filename: f.filename, size: f.size, category: f.category })) },
      reason:     `Uploaded ${fileRecords.length} ${category} file${fileRecords.length > 1 ? 's' : ''}`,
      metadata:   { customId: c.customId, category },
    });

    const transformedFiles = fileRecords.map(f => ({
      id: f.id,
      name: f.filename,
      url: `/uploads/${path.basename(f.path)}`,
      size: f.size,
      mimetype: f.mimetype,
      category: f.category,
      uploadedBy: f.uploadedBy,
      createdAt: f.createdAt,
    }));

    // Broadcast file upload
    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.customId });

    res.status(201).json({ success: true, files: transformedFiles });
  } catch (err) {
    console.error('POST /cases/:id/upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// ─── DELETE /api/cases/:customId/files/:fileId ─────────────────
router.delete('/:customId/files/:fileId', authenticate, async (req, res) => {
  try {
    const file = await prisma.caseFile.findUnique({ where: { id: req.params.fileId } });
    if (!file) return res.status(404).json({ error: 'File not found' });

    // ─── Authorisation ─────────────────────────────────────────
    // This endpoint authorised nothing: any signed-in user could delete
    // any file on any case by id, including another clinic's scans and
    // the lab's design files. The fileId was not even checked against
    // the case in the URL.
    const c = await prisma.case.findUnique({ where: { customId: req.params.customId } });
    if (!c || file.caseId !== c.id) {
      return res.status(404).json({ error: 'File not found on this case' });
    }

    const role = req.user.role;
    if (role === 'clinic') {
      if (c.doctorId !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
      // A clinic may withdraw what it attached, never the lab's work.
      if (file.uploadedBy !== 'clinic') {
        return res.status(403).json({ error: 'Only the lab can remove lab-uploaded files.' });
      }
    } else if (['technician', 'cad_designer', 'ceramist'].includes(role)) {
      const assigned = [c.assignedTechId, c.assignedDesignerId, c.assignedCeramistId].includes(req.user.id);
      if (!assigned) {
        return res.status(403).json({ error: 'You are not assigned to this case.' });
      }
    } else if (!['admin', 'manager'].includes(role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Record it BEFORE the row is gone, or the audit loses its subject.
    await logAudit({
      req,
      action:     AUDIT_ACTIONS.CASE_FILE_DELETED,
      entityType: 'case',
      entityId:   c.id,
      beforeState:{ id: file.id, filename: file.filename, size: file.size, category: file.category, uploadedBy: file.uploadedBy },
      afterState: null,
      reason:     req.body?.reason || `Deleted file ${file.filename}`,
      metadata:   { customId: c.customId },
    });

    // Delete physical file
    try { fs.unlinkSync(file.path); } catch { /* file may already be gone */ }

    // Delete DB record
    await prisma.caseFile.delete({ where: { id: req.params.fileId } });

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: req.params.customId });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /cases/:id/files/:fileId error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

module.exports = router;
