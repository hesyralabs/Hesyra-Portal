// ═══════════════════════════════════════════════════════════════
// CASE RECORDS
//
// Two things live here:
//   1. The full history of a single case — every state it passed
//      through, who moved it, and what changed. Readable long after
//      the case closes.
//   2. A period statement across all cases: preview, .xlsx download,
//      or mailed to the requesting admin.
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');
const exporter = require('../lib/caseExport');
const mailer = require('../lib/mailer');

const router = express.Router();

// Admin only. This is the one place in the portal where every case,
// every clinic and every rupee sit in a single downloadable file, so it
// is gated to the narrowest role rather than to whoever happens to need
// a number today.
router.use(authenticate, requireRole('admin'));

// ─── GET /api/records/cases/:customId/history ──────────────────
// The whole life of one case, merged into a single ordered list.
router.get('/cases/:customId/history', async (req, res) => {
  try {
    const c = await prisma.case.findUnique({
      where: { customId: req.params.customId },
      include: {
        doctor:           { select: { name: true, clinic: true, username: true, email: true } },
        assignedTech:     { select: { name: true } },
        assignedDesigner: { select: { name: true } },
        timeline:         { orderBy: { createdAt: 'asc' } },
        files:            { select: { id: true, filename: true, size: true, category: true, uploadedBy: true, createdAt: true } },
        invoices:         { select: { customId: true, status: true, amount: true, paidAt: true, createdAt: true } },
        paymentRecords:   true,
      },
    });

    if (!c) return res.status(404).json({ error: 'Case not found' });

    // Audit rows are keyed by the case's internal id.
    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'case', entityId: c.id },
      orderBy: { timestamp: 'asc' },
    });

    const actorIds = [...new Set(audit.map(a => a.actorId).filter(Boolean))];
    const actors = actorIds.length
      ? await prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true, username: true, role: true },
        })
      : [];
    const actorById = Object.fromEntries(actors.map(a => [a.id, a]));

    const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

    // One stream, so a reader does not have to interleave three lists
    // by hand. `source` says how much weight to give an entry: audit
    // rows carry an actor and an IP, timeline rows are the narrative
    // shown to the clinic.
    const events = [
      ...audit.map(a => ({
        at:     a.timestamp,
        source: 'audit',
        action: a.action,
        actor:  actorById[a.actorId]
                  ? `${actorById[a.actorId].name} (${actorById[a.actorId].username || a.actorRole})`
                  : a.actorRole || 'system',
        actorRole: a.actorRole,
        reason: a.reason || '',
        before: parse(a.beforeState),
        after:  parse(a.afterState),
        meta:   parse(a.metadata),
        ip:     a.ipAddress || null,
      })),
      ...c.timeline.map(t => ({
        at:     t.createdAt,
        source: 'timeline',
        action: 'TIMELINE',
        actor:  null,
        label:  t.label,
        reason: t.info || '',
      })),
      ...c.files.map(f => ({
        at:     f.createdAt,
        source: 'file',
        action: 'FILE_PRESENT',
        actor:  f.uploadedBy,
        label:  f.filename,
        meta:   { size: f.size, category: f.category },
      })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json({
      case: {
        id: c.customId,
        patient: c.patient,
        caseType: c.caseType,
        type: c.type,
        status: c.status,
        clinic: c.doctor?.clinic || c.clinic,
        clinicCode: c.doctor?.username,
        doctor: c.doctor?.name,
        material: c.material,
        shade: c.shade,
        createdAt: c.createdAt,
        totalAmountPaise: c.totalAmountPaise,
        complimentary: c.complimentary,
        paymentConfirmedAt: c.paymentConfirmedAt,
        dispatchedAt: c.dispatchedAt,
        trackingCourier: c.trackingCourier,
        trackingNumber: c.trackingNumber,
        designer: c.assignedDesigner?.name || null,
        technician: c.assignedTech?.name || c.tech || null,
      },
      invoices: c.invoices,
      events,
      counts: { audit: audit.length, timeline: c.timeline.length, files: c.files.length },
    });
  } catch (err) {
    console.error('GET /records/cases/:id/history error:', err);
    res.status(500).json({ error: 'Failed to load case history' });
  }
});

// The JWT carries id, role and email but no display name, so the
// "Generated by" line came out as a raw uuid. Resolving it here beats
// widening the token, which would log everyone out on deploy.
async function describeActor(user) {
  const u = await prisma.user.findUnique({
    where: { id: user.id },
    select: { name: true, username: true },
  }).catch(() => null);
  const label = u?.name || u?.username || user.email || user.id;
  return `${label} (${user.role})`;
}

// Shared by preview, download and email so the three can never
// disagree about what the range meant.
async function buildReport(query) {
  const range = exporter.resolveRange({
    preset: query.preset,
    from:   query.from,
    to:     query.to,
  });
  const rows = await exporter.fetchCases({
    from: range.from,
    to: range.to,
    status: query.status || undefined,
    clinicId: query.clinicId || undefined,
  });
  return { range, rows, summary: exporter.summarise(rows) };
}

// ─── GET /api/records/cases ────────────────────────────────────
// Preview. Same numbers the spreadsheet will contain.
router.get('/cases', async (req, res) => {
  try {
    const { range, rows, summary } = await buildReport(req.query);
    res.json({
      range: { from: range.from, to: range.to, label: range.label },
      columns: exporter.COLUMNS,
      rows,
      summary,
      filename: exporter.exportFilename(range),
      mailAvailable: mailer.isConfigured(),
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('GET /records/cases error:', err);
    res.status(500).json({ error: 'Failed to build the case statement' });
  }
});

// ─── GET /api/records/cases.xlsx ───────────────────────────────
router.get('/cases.xlsx', async (req, res) => {
  try {
    const { range, rows, summary } = await buildReport(req.query);
    const wb = await exporter.buildWorkbook({
      rows, summary, range,
      generatedBy: await describeActor(req.user),
    });

    const filename = exporter.exportFilename(range);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('GET /records/cases.xlsx error:', err);
    res.status(500).json({ error: 'Failed to generate the spreadsheet' });
  }
});

// ─── POST /api/records/cases/email ─────────────────────────────
// Sends the statement to the signed-in admin's own address. The
// recipient is never taken from the request body: an export endpoint
// that mails arbitrary addresses is a data-exfiltration route.
router.post('/cases/email', async (req, res) => {
  try {
    if (!mailer.isConfigured()) {
      return res.status(503).json({
        error: 'Email delivery is not configured on this server.',
        hint: 'Set SMTP_HOST, SMTP_PORT and SMTP_FROM in server/.env, then restart. Until then, use Download.',
        code: 'MAIL_NOT_CONFIGURED',
      });
    }

    const to = req.user.email;
    if (!to) {
      return res.status(400).json({ error: 'Your account has no email address on file.' });
    }

    const { range, rows, summary } = await buildReport({ ...req.query, ...req.body });
    const wb = await exporter.buildWorkbook({
      rows, summary, range,
      generatedBy: await describeActor(req.user),
    });
    const buffer = await wb.xlsx.writeBuffer();
    const filename = exporter.exportFilename(range);

    const money = (n) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

    await mailer.sendMail({
      to,
      subject: `Hesyra case statement — ${range.label} (${summary.caseCount} cases)`,
      text: [
        `Case statement for ${range.label}.`,
        '',
        `Cases:        ${summary.caseCount}`,
        `Units:        ${summary.unitCount}`,
        `Net:          ${money(summary.netTotal)}`,
        `GST:          ${money(summary.gstTotal)}`,
        `Total:        ${money(summary.grandTotal)}`,
        `Collected:    ${money(summary.paidTotal)}`,
        `Outstanding:  ${money(summary.unpaidTotal)}`,
        '',
        'The attached spreadsheet lists every case in the period, including cancelled and archived ones.',
      ].join('\n'),
      attachments: [{
        filename,
        content: Buffer.from(buffer),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }],
    });

    res.json({ success: true, sentTo: to, filename, caseCount: summary.caseCount });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    if (err.status === 503) return res.status(503).json({ error: err.message, code: err.code });
    console.error('POST /records/cases/email error:', err);
    res.status(500).json({ error: 'The statement was built but could not be emailed.' });
  }
});

// ─── GET /api/records/mail-status ──────────────────────────────
// Lets the UI say something true about the Email button.
router.get('/mail-status', async (req, res) => {
  res.json(await mailer.verify());
});

module.exports = router;
