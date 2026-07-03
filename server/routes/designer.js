const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// All designer routes require authentication + cad_designer role
router.use(authenticate, requireRole('cad_designer'));

// ─── File upload config ────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    const ext = path.extname(file.originalname);
    cb(null, `design-${req.params.id}-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB — design files are large
  fileFilter: (req, file, cb) => {
    const allowed = ['.stl', '.ply', '.obj', '.zip', '.3mf', '.step', '.stp', '.png', '.jpg', '.jpeg', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error(`File type ${ext} not allowed`));
  },
});

// ─── File serializer ─────────────────────────────────────────
// Single place that maps a DB CaseFile record → safe JSON.
// Strips raw server paths, exposes only public URL.
function serializeFile(f) {
  return {
    id:         f.id,
    name:       f.filename,
    url:        `/uploads/${path.basename(f.path)}`,
    size:       f.size,
    category:   f.category,        // 'scan' | 'design'
    mimetype:   f.mimetype,
    uploadedBy: f.uploadedBy,      // 'clinic' | 'cad_designer' | 'technician'
    createdAt:  f.createdAt,
  };
}

// ─── Ownership check helper ─────────────────────────────────
// CAD designer must be assigned to the case — enforced at query level.
// FIXED: includes ALL file categories (scan + design) so designer can
//        see the dentist's STL scans they need to work from.
async function getOwnedCase(caseCustomId, designerId) {
  const c = await prisma.case.findUnique({
    where: { customId: caseCustomId },
    include: {
      files:    { orderBy: { createdAt: 'asc' } },   // ← ALL categories, not just 'design'
      timeline: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!c) return null;
  // Server-side ownership enforcement — not just UI filtering
  if (c.assignedDesignerId !== designerId) return null;
  return c;
}

// ═══════════════════════════════════════════════════════════════
// DESIGNER CASE QUEUE
// ═══════════════════════════════════════════════════════════════

// ─── GET /api/designer/cases ───────────────────────────────────
// Returns ONLY cases assigned to this designer — server-scoped.
// Blinded: no patient name, no clinic name, no financial data.
// Includes BOTH scan files (from dentist) and design files (own uploads).
router.get('/cases', async (req, res) => {
  try {
    const cases = await prisma.case.findMany({
      where: {
        assignedDesignerId: req.user.id,
        status: { notIn: ['cancelled', 'archived'] },
      },
      select: {
        customId:      true,
        caseType:      true,
        type:          true,
        // Clinical data needed for design work
        toothNumbers:  true,
        archTarget:    true,
        implantSystem: true,
        shade:         true,
        material:      true,
        instructions:  true,
        rejectionReason: true,  // Populated when manager requests revision
        // Status & priority
        status:        true,
        due:           true,
        priorityFlag:  true,
        createdAt:     true,
        // ALL files — designer needs scan files from dentist to work
        files: {
          select: {
            id: true, filename: true, category: true, mimetype: true,
            createdAt: true, path: true, size: true, uploadedBy: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        // BLINDED: patient, clinic, doctor, financials
      },
      orderBy: [{ priorityFlag: 'desc' }, { due: 'asc' }, { createdAt: 'asc' }],
    });

    const transformed = cases.map(c => ({
      ...c,
      toothNumbers: (() => { try { return JSON.parse(c.toothNumbers || '[]'); } catch { return []; } })(),
      files: c.files.map(serializeFile),
      // Derived convenience counts for the queue card
      scanFileCount:   c.files.filter(f => f.category === 'scan').length,
      designFileCount: c.files.filter(f => f.category === 'design').length,
    }));

    res.json(transformed);
  } catch (err) {
    console.error('GET /designer/cases error:', err);
    res.status(500).json({ error: 'Failed to fetch assigned cases' });
  }
});

// ─── GET /api/designer/cases/:id ──────────────────────────────
// Full case detail — ownership checked, both file categories returned.
router.get('/cases/:id', async (req, res) => {
  try {
    const c = await getOwnedCase(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Case not found or not assigned to you' });

    const allFiles   = c.files.map(serializeFile);
    const scanFiles   = allFiles.filter(f => f.category === 'scan');
    const designFiles = allFiles.filter(f => f.category === 'design');

    res.json({
      customId:       c.customId,
      caseType:       c.caseType,
      type:           c.type,
      toothNumbers:   (() => { try { return JSON.parse(c.toothNumbers || '[]'); } catch { return []; } })(),
      archTarget:     c.archTarget,
      implantSystem:  c.implantSystem,
      shade:          c.shade,
      material:       c.material,
      instructions:   c.instructions,
      rejectionReason: c.rejectionReason,  // manager revision note
      status:         c.status,
      due:            c.due,
      priorityFlag:   c.priorityFlag,
      // Files split by category — frontend can render them separately
      scanFiles,
      designFiles,
      files: allFiles, // also expose flat list for backwards compat
      timeline: c.timeline.map(t => ({
        label: t.label,
        info:  t.info,
        time:  new Date(t.createdAt).toLocaleString('en-IN', {
          day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        }),
      })),
    });
  } catch (err) {
    console.error('GET /designer/cases/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch case' });
  }
});

// ─── POST /api/designer/cases/:id/upload ────────────────────────
// Upload design file(s). Advances status from cad_assigned → stays cad_assigned
// (designer can upload iteratively; they explicitly submit when ready).
router.post('/cases/:id/upload', upload.array('files', 10), async (req, res) => {
  try {
    const c = await getOwnedCase(req.params.id, req.user.id);
    if (!c) {
      if (req.files) req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
      return res.status(404).json({ error: 'Case not found or not assigned to you' });
    }

    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

    // Only allow upload if designer is actively working the case
    const workableStatuses = ['cad_assigned', 'design_revision', 'designing'];
    if (!workableStatuses.includes(c.status)) {
      req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch(e){} });
      return res.status(400).json({
        error: `Cannot upload files in status '${c.status}'. Case must be in: ${workableStatuses.join(', ')}`,
      });
    }

    // --- File Content Validation (Anti-Malware) ---
    for (const file of req.files) {
      try {
        const buffer = Buffer.alloc(8);
        const fd = fs.openSync(file.path, 'r');
        fs.readSync(fd, buffer, 0, 8, 0);
        fs.closeSync(fd);
        
        const hex = buffer.toString('hex').toUpperCase();
        
        const isMalicious = 
          hex.startsWith('4D5A') || // Windows EXE/DLL (MZ)
          hex.startsWith('7F454C46') || // Linux ELF
          hex.startsWith('2321'); // Shell script (#!)

        if (isMalicious) {
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

    const created = await Promise.all(files.map(file =>
      prisma.caseFile.create({
        data: {
          filename:   file.originalname,
          path:       file.path,
          size:       file.size,
          mimetype:   file.mimetype,
          category:   'design',
          uploadedBy: 'cad_designer',
          caseId:     c.id,
        },
      })
    ));

    await prisma.timeline.create({
      data: { caseId: c.id, label: `🎨 Design file(s) uploaded (${files.length})` },
    });

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: c.customId });

    res.status(201).json({
      success: true,
      files: created.map(serializeFile),
    });
  } catch (err) {
    console.error('POST /designer/cases/:id/upload error:', err);
    res.status(500).json({ error: 'Failed to upload design' });
  }
});

// ─── DELETE /api/designer/cases/:id/files/:fileId ───────────────
// Delete own uploaded design file (only during active work, only own files).
router.delete('/cases/:id/files/:fileId', async (req, res) => {
  try {
    const c = await getOwnedCase(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Case not found or not assigned to you' });

    const file = c.files.find(f => f.id === req.params.fileId);
    if (!file) return res.status(404).json({ error: 'File not found' });
    if (file.category !== 'design' || file.uploadedBy !== 'cad_designer') {
      return res.status(403).json({ error: 'You can only delete your own design files' });
    }
    if (!['cad_assigned', 'design_revision', 'designing'].includes(c.status)) {
      return res.status(400).json({ error: 'Cannot delete files after design has been submitted for review' });
    }

    // Remove from disk
    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    await prisma.caseFile.delete({ where: { id: file.id } });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /designer/cases/:id/files/:fileId error:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ─── PUT /api/designer/cases/:id/submit ──────────────────────────
// Explicitly submit design for manager review → design_ready.
// Requires at least one design file to be uploaded.
router.put('/cases/:id/submit', async (req, res) => {
  try {
    const c = await getOwnedCase(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Case not found or not assigned to you' });

    const canSubmit = ['cad_assigned', 'design_revision', 'designing'].includes(c.status);
    if (!canSubmit) {
      return res.status(400).json({ error: `Cannot submit from status '${c.status}'` });
    }

    const designFiles = c.files.filter(f => f.category === 'design');
    if (designFiles.length === 0) {
      return res.status(400).json({ error: 'Upload at least one design file before submitting for review' });
    }

    await prisma.case.update({ where: { id: c.id }, data: { status: 'design_ready' } });
    await prisma.timeline.create({
      data: { caseId: c.id, label: `✅ Design submitted for manager review (${designFiles.length} file${designFiles.length > 1 ? 's' : ''})` },
    });

    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: c.customId, newStatus: 'design_ready' });

    res.json({ success: true, newStatus: 'design_ready' });
  } catch (err) {
    console.error('PUT /designer/cases/:id/submit error:', err);
    res.status(500).json({ error: 'Failed to submit design' });
  }
});

// Keep old endpoint path for backwards compat with existing frontend calls
router.put('/cases/:id/design-ready', async (req, res) => {
  // Delegate to the new canonical endpoint logic inline
  try {
    const c = await getOwnedCase(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Case not found or not assigned to you' });
    const canSubmit = ['cad_assigned', 'design_revision', 'designing'].includes(c.status);
    if (!canSubmit) return res.status(400).json({ error: `Cannot submit from status '${c.status}'` });
    const designFiles = c.files.filter(f => f.category === 'design');
    if (designFiles.length === 0) return res.status(400).json({ error: 'Upload at least one design file before submitting for review' });
    await prisma.case.update({ where: { id: c.id }, data: { status: 'design_ready' } });
    await prisma.timeline.create({ data: { caseId: c.id, label: `✅ Design submitted for manager review (${designFiles.length} file${designFiles.length > 1 ? 's' : ''})` } });
    const io = req.app.get('io');
    if (io) io.emit('case:updated', { customId: c.customId, newStatus: 'design_ready' });
    res.json({ success: true, newStatus: 'design_ready' });
  } catch (err) { res.status(500).json({ error: 'Failed to submit design' }); }
});

// ─── PUT /api/designer/cases/:id/block ────────────────────────
// Flag case as blocked — scan unusable, missing info, etc.
router.put('/cases/:id/block', async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A reason is required when blocking a case' });
    }

    const c = await getOwnedCase(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Case not found or not assigned to you' });

    const blockableStatuses = ['cad_assigned', 'design_revision', 'designing'];
    if (!blockableStatuses.includes(c.status)) {
      return res.status(400).json({ error: `Cannot block a case in status '${c.status}'` });
    }

    await prisma.case.update({ where: { id: c.id }, data: { status: 'blocked' } });
    await prisma.timeline.create({
      data: {
        caseId: c.id,
        label:  '🚫 Case blocked by designer',
        info:   reason.trim(),
      },
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('case:updated', { customId: c.customId, newStatus: 'blocked' });
      // Targeted notification for managers
      io.emit('manager:alert', {
        type: 'case_blocked',
        customId: c.customId,
        reason: reason.trim(),
        message: `Case ${c.customId} was blocked by designer: ${reason.trim()}`,
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /designer/cases/:id/block error:', err);
    res.status(500).json({ error: 'Failed to block case' });
  }
});

// ─── PUT /api/designer/cases/:id/notes ──────────────────────────
// Add an internal note visible to manager + technician (never to clinic).
router.put('/cases/:id/notes', async (req, res) => {
  try {
    const { note } = req.body;
    if (!note || !note.trim()) return res.status(400).json({ error: 'Note cannot be empty' });

    const c = await getOwnedCase(req.params.id, req.user.id);
    if (!c) return res.status(404).json({ error: 'Case not found or not assigned to you' });

    const timestamp = new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const existing  = c.internalNotes || '';
    const updated   = `${existing}[${timestamp} · Designer] ${note.trim()}\n`;

    await prisma.case.update({ where: { id: c.id }, data: { internalNotes: updated } });

    // Also log to timeline so managers see it in the case history
    await prisma.timeline.create({
      data: { caseId: c.id, label: '📝 Designer note added', info: note.trim() },
    });

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /designer/cases/:id/notes error:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

module.exports = router;
