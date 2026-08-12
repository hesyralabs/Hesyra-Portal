// ═══════════════════════════════════════════════════════════════
// CASE RECORDS / EXPORT
//
// A statement of every case in a period, for people who need to answer
// questions about work that closed months ago: what was ordered, by
// whom, what it cost, when it moved, and when it shipped.
//
// Two rules this module holds to:
//   1. Nothing is excluded by status. Archived and cancelled cases are
//      part of the record — an export that quietly drops them is worse
//      than no export, because it reads as complete.
//   2. Money is derived the same way it was charged. totalAmountPaise
//      is the GST-inclusive figure the clinic actually paid, so net and
//      tax are back-computed from it rather than recalculated from the
//      price list, which may have moved since.
// ═══════════════════════════════════════════════════════════════
const prisma = require('./prisma');
const config = require('./config');

// ─── Date ranges ───────────────────────────────────────────────
// Boundaries are local days. The lab is in Nagpur and an operator
// asking for "today" means their today, not UTC's.
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

const PRESETS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'custom'];

/**
 * Resolve a preset or an explicit from/to into a concrete range.
 * Throws on an unusable custom range rather than silently returning
 * everything — a wrong date should not look like a quiet success.
 */
function resolveRange({ preset, from, to }) {
  const now = new Date();

  switch (preset) {
    case 'today':
      return { from: startOfDay(now), to: endOfDay(now), label: 'Today' };

    case 'yesterday': {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y), label: 'Yesterday' };
    }

    case 'last7': {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);            // inclusive of today = 7 days
      return { from: startOfDay(s), to: endOfDay(now), label: 'Last 7 days' };
    }

    case 'last30': {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return { from: startOfDay(s), to: endOfDay(now), label: 'Last 30 days' };
    }

    case 'thisMonth': {
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(s), to: endOfDay(now), label: 'This month' };
    }

    case 'custom':
    default: {
      if (!from || !to) {
        const err = new Error('A custom range needs both a start and an end date.');
        err.status = 400;
        throw err;
      }
      const f = startOfDay(new Date(from));
      const t = endOfDay(new Date(to));
      if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
        const err = new Error('Those dates could not be read. Use YYYY-MM-DD.');
        err.status = 400;
        throw err;
      }
      if (f > t) {
        const err = new Error('The start date is after the end date.');
        err.status = 400;
        throw err;
      }
      const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return { from: f, to: t, label: `${fmt(f)} — ${fmt(t)}` };
    }
  }
}

// ─── Columns ───────────────────────────────────────────────────
// One definition drives the preview table, the spreadsheet header and
// the column widths, so the three can never disagree.
const COLUMNS = [
  { key: 'customId',       header: 'Case ID',        width: 22, type: 'text' },
  { key: 'createdAt',      header: 'Created',        width: 18, type: 'datetime' },
  { key: 'clinic',         header: 'Clinic',         width: 26, type: 'text' },
  { key: 'doctor',         header: 'Doctor',         width: 20, type: 'text' },
  { key: 'clinicCode',     header: 'Code',           width: 10, type: 'text' },
  { key: 'patient',        header: 'Patient ref',    width: 22, type: 'text' },
  { key: 'caseType',       header: 'Case type',      width: 18, type: 'text' },
  { key: 'variant',        header: 'Variant',        width: 18, type: 'text' },
  { key: 'material',       header: 'Material',       width: 20, type: 'text' },
  { key: 'shade',          header: 'Shade',          width: 9,  type: 'text' },
  { key: 'teeth',          header: 'Teeth',          width: 18, type: 'text' },
  { key: 'units',          header: 'Units',          width: 8,  type: 'number' },
  { key: 'status',         header: 'Status',         width: 20, type: 'text' },
  // Who actually did the work, with the account it was done from. A bare
  // role label ("CAD Designer") does not identify anybody once there is
  // more than one of them on the bench.
  { key: 'designer',       header: 'Designer',       width: 26, type: 'text' },
  { key: 'technician',     header: 'Technician',     width: 26, type: 'text' },
  { key: 'ceramist',       header: 'Ceramist',       width: 26, type: 'text' },
  { key: 'approvedAt',     header: 'Design approved',width: 18, type: 'datetime' },
  { key: 'approvedBy',     header: 'Approved by',    width: 26, type: 'text' },
  { key: 'readyAt',        header: 'Ready',          width: 18, type: 'datetime' },
  { key: 'packedBy',       header: 'Packed by',      width: 22, type: 'text' },
  { key: 'dispatchedAt',   header: 'Dispatched',     width: 18, type: 'datetime' },
  { key: 'dispatchedBy',   header: 'Dispatched by',  width: 22, type: 'text' },
  { key: 'courier',        header: 'Courier',        width: 16, type: 'text' },
  { key: 'consignment',    header: 'Consignment',    width: 20, type: 'text' },
  { key: 'netAmount',      header: 'Net (₹)',        width: 13, type: 'money' },
  { key: 'gstAmount',      header: 'GST (₹)',        width: 12, type: 'money' },
  { key: 'totalAmount',    header: 'Total (₹)',      width: 14, type: 'money' },
  { key: 'paid',           header: 'Paid',           width: 9,  type: 'text' },
  { key: 'paidAt',         header: 'Paid on',        width: 18, type: 'datetime' },
  { key: 'complimentary',  header: 'Scan Day crown', width: 15, type: 'text' },
  { key: 'warrantyYears',  header: 'Warranty (yrs)', width: 14, type: 'number' },
];

const CASE_TYPE_LABELS = {
  crown_bridge: 'Crown & Bridge', veneer: 'Veneer', inlay_onlay: 'Inlay / Onlay',
  denture: 'Denture', aligner: 'Clear Aligner', retainer: 'Retainer',
  splint: 'Splint / Nightguard', surgical_guide: 'Surgical Guide',
  space_maintainer: 'Space Maintainer', pediatric_aligner: 'Pediatric Aligner',
  posterior_bite_block: 'Posterior Bite Block',
};

const paise = (p) => Math.round((p || 0)) / 100;

// "Rahul Nair (cad_001)" — the person, and the account it was done from.
// Falls back to whichever identifier exists so a row is never blank when
// somebody was in fact assigned.
function who(user, legacyLabel) {
  if (!user) return legacyLabel && legacyLabel !== 'Unassigned' ? legacyLabel : '';
  const id = user.username || user.customId;
  return id ? `${user.name} (${id})` : user.name || '';
}

/**
 * Every GST rate the catalogue can charge, as a label: "5%" when there
 * is one, "5% / 8%" when case types differ.
 */
function gstRateLabel() {
  const rates = new Set([
    config.GST_RATE,
    ...Object.values(config.GST_RATE_BY_CASE_TYPE || {}),
  ]);
  return [...rates].sort((a, b) => a - b).map(r => `${Math.round(r * 100)}%`).join(' / ');
}

function shapeRow(c) {
  let teeth = [];
  try { teeth = JSON.parse(c.toothNumbers || '[]'); } catch { teeth = []; }

  // Back-computed from what was charged, not re-priced from the list,
  // and at the rate that applies to THIS case type — aligners are 8%,
  // prosthetics 5%. A single rate across the export splits every
  // aligner row wrongly while still totalling correctly.
  const total = c.totalAmountPaise || 0;
  const rate = config.gstRateFor(c.caseType);
  const net = Math.round(total / (1 + rate));
  const gst = total - net;

  return {
    customId:       c.customId,
    createdAt:      c.createdAt,
    clinic:         c.doctor?.clinic || c.clinic || '',
    doctor:         who(c.doctor),
    clinicCode:     c.doctor?.username || '',
    patient:        c.patient || '',
    caseType:       CASE_TYPE_LABELS[c.caseType] || c.caseType || '',
    variant:        c.type || '',
    material:       c.material || '',
    shade:          c.shade || '',
    teeth:          teeth.join(', '),
    units:          teeth.length || 1,
    status:         c.status,
    designer:       who(c.assignedDesigner),
    technician:     who(c.assignedTech, c.tech),
    ceramist:       who(c.assignedCeramist),
    approvedAt:     c.doctorApprovedAt,
    // The column said "Approved by" and carried the *method* — "doctor"
    // or "auto". That answers a different question than the one anybody
    // reading an audit column is asking.
    approvedBy:     c.doctorApprovalMethod === 'auto'
                      ? 'System — auto-approved at deadline'
                      : c.doctorApprovalMethod
                        ? who(c.doctor)
                        : '',
    readyAt:        c.readyForDispatchAt,
    packedBy:       who(c.packedBy),
    dispatchedAt:   c.dispatchedAt,
    dispatchedBy:   who(c.dispatchedBy),
    courier:        c.trackingCourier || '',
    consignment:    c.trackingNumber || '',
    netAmount:      paise(net),
    gstAmount:      paise(gst),
    totalAmount:    paise(total),
    paid:           c.paymentConfirmedAt ? 'Yes' : (c.dispatchedOnCredit ? 'On credit' : 'No'),
    paidAt:         c.paymentConfirmedAt,
    complimentary:  c.complimentary ? 'Yes' : '',
    warrantyYears:  c.warrantyYears || 0,
  };
}

/**
 * Every case created inside the range. Deliberately unfiltered by
 * status — see the note at the top of this file.
 */
async function fetchCases({ from, to, status, clinicId }) {
  const where = { createdAt: { gte: from, lte: to } };
  if (status) where.status = status;
  if (clinicId) where.doctorId = clinicId;

  const cases = await prisma.case.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: {
      doctor:           { select: { name: true, clinic: true, username: true, customId: true } },
      assignedTech:     { select: { name: true, username: true, customId: true } },
      assignedDesigner: { select: { name: true, username: true, customId: true } },
      assignedCeramist: { select: { name: true, username: true, customId: true } },
      packedBy:         { select: { name: true, username: true, customId: true } },
      dispatchedBy:     { select: { name: true, username: true, customId: true } },
    },
  });

  return cases.map(shapeRow);
}

function summarise(rows) {
  const byStatus = {};
  rows.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });

  return {
    caseCount:   rows.length,
    unitCount:   rows.reduce((n, r) => n + (r.units || 0), 0),
    netTotal:    +rows.reduce((n, r) => n + r.netAmount, 0).toFixed(2),
    gstTotal:    +rows.reduce((n, r) => n + r.gstAmount, 0).toFixed(2),
    grandTotal:  +rows.reduce((n, r) => n + r.totalAmount, 0).toFixed(2),
    paidTotal:   +rows.filter(r => r.paid === 'Yes').reduce((n, r) => n + r.totalAmount, 0).toFixed(2),
    unpaidTotal: +rows.filter(r => r.paid !== 'Yes').reduce((n, r) => n + r.totalAmount, 0).toFixed(2),
    complimentary: rows.filter(r => r.complimentary === 'Yes').length,
    byStatus,
  };
}

/**
 * Build the .xlsx. Two sheets: the statement, and a summary an
 * accountant can reconcile against without reading 400 rows.
 */
async function buildWorkbook({ rows, summary, range, generatedBy }) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Hesyra Portal';
  wb.created = new Date();

  // ─── Sheet 1: the statement ─────────────────────────────────
  const ws = wb.addWorksheet('Cases', {
    views: [{ state: 'frozen', ySplit: 1 }],   // header stays put while scrolling
  });

  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));

  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.getRow(1).height = 20;

  rows.forEach(r => ws.addRow(r));

  // Number and date formats, applied by column type.
  COLUMNS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money')    col.numFmt = '#,##0.00';
    if (c.type === 'number')   col.numFmt = '0';
    if (c.type === 'datetime') col.numFmt = 'dd mmm yyyy hh:mm';
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  // Totals row, so the sheet foots without anyone re-adding it.
  const totalRow = ws.addRow({
    customId: `${rows.length} case${rows.length === 1 ? '' : 's'}`,
    units:       summary.unitCount,
    netAmount:   summary.netTotal,
    gstAmount:   summary.gstTotal,
    totalAmount: summary.grandTotal,
  });
  totalRow.font = { bold: true };
  totalRow.border = { top: { style: 'thin' } };

  // ─── Sheet 2: summary ───────────────────────────────────────
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ width: 30 }, { width: 26 }];

  const put = (label, value, bold = false) => {
    const r = sum.addRow([label, value]);
    if (bold) r.font = { bold: true };
    return r;
  };

  put('Hesyra Labs — case statement', '', true);
  put('Period', range.label);
  put('From', range.from);
  put('To', range.to);
  put('Generated', new Date());
  put('Generated by', generatedBy || '');
  sum.addRow([]);
  put('Cases', summary.caseCount, true);
  put('Units', summary.unitCount);
  put('Complimentary (Scan Day)', summary.complimentary);
  sum.addRow([]);
  put('Net (₹)', summary.netTotal, true);
  // Rates vary by case type, so the heading names them rather than
  // asserting one — a statement covering aligners and crowns carries
  // both 8% and 5% and labelling it "GST @ 5%" would be false.
  put(`GST @ ${gstRateLabel()} (₹)`, summary.gstTotal);
  put('Total (₹)', summary.grandTotal, true);
  put('Collected (₹)', summary.paidTotal);
  put('Outstanding (₹)', summary.unpaidTotal);
  sum.addRow([]);
  put('By status', '', true);
  Object.entries(summary.byStatus)
    .sort((a, b) => b[1] - a[1])
    .forEach(([s, n]) => put(`  ${s}`, n));

  sum.getColumn(2).numFmt = '#,##0.00';
  sum.getCell('B3').numFmt = 'dd mmm yyyy';
  sum.getCell('B4').numFmt = 'dd mmm yyyy';
  sum.getCell('B5').numFmt = 'dd mmm yyyy hh:mm';

  return wb;
}

/** A stable, sortable filename. */
function exportFilename(range, ext = 'xlsx') {
  const d = (x) => new Date(x).toISOString().slice(0, 10);
  return `hesyra-cases_${d(range.from)}_to_${d(range.to)}.${ext}`;
}

module.exports = {
  PRESETS,
  COLUMNS,
  resolveRange,
  fetchCases,
  summarise,
  buildWorkbook,
  exportFilename,
};
