// ═══════════════════════════════════════════════════════════════════
// Tax Invoice Document
//
// Renders a GST tax invoice as a PDF. This is the document a clinic
// files, forwards to their accountant, and produces if anybody asks
// what they paid — so it states the registration it is issued under,
// the place of supply, the tax split, and the total in words, because
// an Indian tax invoice that omits any of those is not one.
//
// Money is handled in paise throughout and converted to rupees only at
// the moment of printing. Nothing here re-prices anything: every figure
// is recovered from what the clinic was actually charged.
// ═══════════════════════════════════════════════════════════════════

const PDFDocument = require('pdfkit');
const prisma = require('./prisma');
const config = require('./config');
const razorpay = require('./razorpay');

const CASE_TYPE_LABELS = {
  crown_bridge:     'Crown & Bridge',
  veneer:           'Ceramic Veneers',
  denture:          'Digital Denture',
  inlay_onlay:      'Inlay / Onlay',
  aligner:          'Clear Aligners',
  retainer:         'Clear Retainer',
  surgical_guide:   'Surgical Guide',
  splint:           'Splint / Nightguard',
  space_maintainer: 'Space Maintainer',
  model:            'Study Model',
};

const rupees = (paise) => (paise / 100).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDate = (d) => new Date(d).toLocaleDateString('en-IN', {
  day: '2-digit', month: 'short', year: 'numeric',
});

/**
 * Gather everything the document needs, normalised.
 *
 * NOTE on Invoice.amount — it carries two different meanings depending
 * on invoiceType, which is a known defect recorded in HANDOFF §8:
 *   per_case → the TAXABLE value, tax excluded
 *   monthly  → the GROSS, tax included
 * Both are normalised to grossPaise/netPaise/taxPaise here so the
 * document is right in either case. Fixing the column itself touches
 * the outstanding-balance arithmetic, so it is handled rather than
 * papered over.
 */
async function buildInvoiceData(invoiceCustomId) {
  const invoice = await prisma.invoice.findUnique({
    where: { customId: invoiceCustomId },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, clinic: true,
          clinicAddress: true, clinicCity: true, clinicState: true, clinicPinCode: true,
        },
      },
      cases: {
        select: {
          customId: true, caseType: true, type: true, patient: true,
          toothNumbers: true, totalAmountPaise: true, complimentary: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!invoice) return null;

  const amountPaise = Math.round((invoice.amount || 0) * 100);
  const taxPaise    = invoice.taxAmountPaise || 0;

  const grossPaise = invoice.invoiceType === 'monthly'
    ? amountPaise
    : amountPaise + taxPaise;
  const netPaise = grossPaise - taxPaise;

  // One row per case, each carrying its own rate — a month can mix an
  // aligner at 8% with crowns at 5%, and a single rate on the document
  // would misstate every line it does not apply to.
  const lines = invoice.cases.map((c, i) => {
    const rate      = config.gstRateFor(c.caseType);
    const lineGross = c.totalAmountPaise || 0;
    const lineTax   = Math.round(lineGross * rate / (1 + rate));
    let teeth = [];
    try { teeth = JSON.parse(c.toothNumbers || '[]'); } catch { teeth = []; }

    return {
      sr:          i + 1,
      caseId:      c.customId,
      description: [
        CASE_TYPE_LABELS[c.caseType] || c.caseType || 'Dental appliance',
        c.type && c.type !== CASE_TYPE_LABELS[c.caseType] ? `(${c.type})` : '',
      ].filter(Boolean).join(' '),
      hsn:         config.HSN_CODE,
      units:       teeth.length || 1,
      ratePercent: rate * 100,
      netPaise:    lineGross - lineTax,
      taxPaise:    lineTax,
      grossPaise:  lineGross,
      complimentary: c.complimentary,
    };
  });

  // Prefer the split stored on the invoice — it is what was decided at
  // issue time. Older rows predate those columns, so fall back to
  // recomputing from the clinic's state.
  const stored = invoice.cgstPaise !== null || invoice.igstPaise !== null;
  const treatment = razorpay.resolveTaxTreatment(invoice.user?.clinicState);
  const half = Math.floor(taxPaise / 2);

  const tax = stored
    ? {
        interState: invoice.interState,
        cgstPaise:  invoice.cgstPaise || 0,
        sgstPaise:  invoice.sgstPaise || 0,
        igstPaise:  invoice.igstPaise || 0,
        placeOfSupply: invoice.placeOfSupply || treatment.placeOfSupply,
        assumed:    invoice.placeOfSupplyAssumed,
      }
    : {
        interState: treatment.interState,
        cgstPaise:  treatment.interState ? 0 : half,
        sgstPaise:  treatment.interState ? 0 : taxPaise - half,
        igstPaise:  treatment.interState ? taxPaise : 0,
        placeOfSupply: treatment.placeOfSupply,
        assumed:    treatment.assumed,
      };

  return {
    invoice,
    number:     invoice.customId,
    issuedAt:   invoice.createdAt,
    dueDate:    invoice.dueDate,
    paidAt:     invoice.paidAt,
    status:     invoice.status,
    isMonthly:  invoice.invoiceType === 'monthly',
    period:     invoice.billingPeriod,
    seller: {
      name:    config.HESYRA_LEGAL_NAME,
      address: config.HESYRA_ADDRESS,
      gstin:   invoice.gstin || config.HESYRA_GSTIN,
      state:   treatment.homeState,
    },
    buyer: {
      name:    invoice.user?.clinic || invoice.clinic,
      contact: invoice.user?.name || null,
      email:   invoice.user?.email || null,
      address: [
        invoice.user?.clinicAddress,
        invoice.user?.clinicCity,
        invoice.user?.clinicState,
        invoice.user?.clinicPinCode,
      ].filter(Boolean).join(', ') || null,
      state:   invoice.user?.clinicState || null,
    },
    lines,
    netPaise,
    taxPaise,
    grossPaise,
    tax,
    amountInWords: razorpay.amountInWords(grossPaise),
    gstinConfigured: config.isGstinConfigured(),
  };
}

// ─── Layout constants ─────────────────────────────────────────────
const M = 42;                 // page margin
const INK        = '#111827';
const INK_SOFT   = '#6b7280';
const RULE       = '#d1d5db';
const BAND       = '#f3f4f6';

/**
 * Render the invoice to a PDF Buffer.
 *
 * Deliberately black on white rather than the portal's dark brand
 * palette: this gets printed and photocopied, and a dark document
 * empties a toner cartridge and scans badly.
 */
function renderInvoicePdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - M * 2;
    const right = (t, x, y, w) => doc.text(t, x, y, { width: w, align: 'right' });

    // ─── Header ───────────────────────────────────────────────
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(18)
       .text(data.seller.name, M, M);
    doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT)
       .text(data.seller.address, M, doc.y + 2)
       .text(`GSTIN: ${data.seller.gstin}`)
       .text(`HSN: ${config.HSN_CODE}`);

    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK);
    right('TAX INVOICE', M, M, W);
    doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT);
    right(`No.  ${data.number}`, M, M + 22, W);
    right(`Date  ${shortDate(data.issuedAt)}`, M, M + 35, W);
    if (data.dueDate) right(`Due  ${shortDate(data.dueDate)}`, M, M + 48, W);

    let y = Math.max(doc.y, M + 74) + 12;
    doc.moveTo(M, y).lineTo(M + W, y).strokeColor(RULE).lineWidth(1).stroke();
    y += 14;

    // ─── Parties ──────────────────────────────────────────────
    const colW = W / 2 - 10;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK_SOFT).text('BILLED TO', M, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK)
       .text(data.buyer.name || '—', M, y + 12, { width: colW });
    doc.font('Helvetica').fontSize(9).fillColor(INK_SOFT);
    if (data.buyer.contact) doc.text(data.buyer.contact, { width: colW });
    if (data.buyer.address) doc.text(data.buyer.address, { width: colW });
    if (data.buyer.email)   doc.text(data.buyer.email, { width: colW });

    const rightX = M + W / 2 + 10;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK_SOFT).text('PLACE OF SUPPLY', rightX, y);
    doc.font('Helvetica').fontSize(10).fillColor(INK)
       .text(data.tax.placeOfSupply || '—', rightX, y + 12, { width: colW });
    doc.fontSize(9).fillColor(INK_SOFT)
       .text(data.tax.interState ? 'Inter-state supply — IGST' : 'Intra-state supply — CGST + SGST',
             rightX, doc.y, { width: colW });
    if (data.isMonthly && data.period) {
      doc.text(`Billing period: ${data.period}`, rightX, doc.y, { width: colW });
    }

    y = doc.y + 18;

    // ─── Line items ───────────────────────────────────────────
    // Column x-offsets, tuned so the widest realistic figure
    // (a ₹98,280 aligner case) does not collide with its neighbour.
    const cx = {
      sr:   M,
      desc: M + 22,
      hsn:  M + 210,
      qty:  M + 252,
      rate: M + 282,
      net:  M + 330,
      gst:  M + 400,
      amt:  M + 462,
    };
    const wid = { desc: 180, hsn: 36, qty: 24, rate: 42, net: 64, gst: 56, amt: W - (cx.amt - M) };

    doc.rect(M, y, W, 20).fill(BAND);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(8);
    doc.text('#',    cx.sr,   y + 6);
    doc.text('DESCRIPTION', cx.desc, y + 6, { width: wid.desc });
    doc.text('HSN',  cx.hsn,  y + 6, { width: wid.hsn });
    doc.text('QTY',  cx.qty,  y + 6, { width: wid.qty, align: 'right' });
    doc.text('GST',  cx.rate, y + 6, { width: wid.rate, align: 'right' });
    doc.text('TAXABLE', cx.net, y + 6, { width: wid.net, align: 'right' });
    doc.text('TAX',  cx.gst,  y + 6, { width: wid.gst, align: 'right' });
    doc.text('TOTAL', cx.amt, y + 6, { width: wid.amt, align: 'right' });
    y += 20;

    doc.font('Helvetica').fontSize(8.5);
    for (const l of data.lines) {
      // Break the page before a row rather than through one.
      if (y > doc.page.height - 190) {
        doc.addPage();
        y = M;
      }

      doc.fillColor(INK);
      doc.text(String(l.sr), cx.sr, y + 5);
      doc.text(l.description, cx.desc, y + 5, { width: wid.desc, lineBreak: false });
      doc.fillColor(INK_SOFT).fontSize(7.5)
         .text(`${l.caseId}${l.complimentary ? ' · complimentary' : ''}`, cx.desc, y + 15, { width: wid.desc, lineBreak: false });
      doc.fillColor(INK).fontSize(8.5);
      doc.text(l.hsn, cx.hsn, y + 5, { width: wid.hsn });
      doc.text(String(l.units), cx.qty, y + 5, { width: wid.qty, align: 'right' });
      doc.text(`${l.ratePercent}%`, cx.rate, y + 5, { width: wid.rate, align: 'right' });
      doc.text(rupees(l.netPaise), cx.net, y + 5, { width: wid.net, align: 'right' });
      doc.text(rupees(l.taxPaise), cx.gst, y + 5, { width: wid.gst, align: 'right' });
      doc.text(rupees(l.grossPaise), cx.amt, y + 5, { width: wid.amt, align: 'right' });

      y += 26;
      doc.moveTo(M, y).lineTo(M + W, y).strokeColor(RULE).lineWidth(0.5).stroke();
    }

    // ─── Totals ───────────────────────────────────────────────
    y += 12;
    const tx = M + W - 220;
    const tw = 220;
    const totalRow = (label, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10.5 : 9)
         .fillColor(bold ? INK : INK_SOFT);
      doc.text(label, tx, y, { width: 120 });
      doc.fillColor(INK).text(`Rs. ${value}`, tx + 120, y, { width: tw - 120, align: 'right' });
      y += bold ? 18 : 14;
    };

    totalRow('Taxable value', rupees(data.netPaise));
    if (data.tax.interState) {
      totalRow('IGST', rupees(data.tax.igstPaise));
    } else {
      totalRow('CGST', rupees(data.tax.cgstPaise));
      totalRow('SGST', rupees(data.tax.sgstPaise));
    }
    doc.moveTo(tx, y + 2).lineTo(M + W, y + 2).strokeColor(RULE).lineWidth(1).stroke();
    y += 8;
    totalRow('Total', rupees(data.grossPaise), true);

    // ─── Words + status ───────────────────────────────────────
    y += 6;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK_SOFT).text('AMOUNT IN WORDS', M, y);
    doc.font('Helvetica').fontSize(9.5).fillColor(INK)
       .text(data.amountInWords, M, y + 12, { width: W - 240 });

    y = doc.y + 16;
    const paid = data.status === 'paid';
    doc.roundedRect(M, y, 128, 22, 4)
       .fillAndStroke(paid ? '#ecfdf5' : '#fff7ed', paid ? '#6ee7b7' : '#fdba74');
    doc.fillColor(paid ? '#047857' : '#c2410c').font('Helvetica-Bold').fontSize(9)
       .text(paid ? `PAID  ${data.paidAt ? shortDate(data.paidAt) : ''}` : 'PAYMENT DUE',
             M + 10, y + 7, { width: 108 });

    // ─── Footer ───────────────────────────────────────────────
    const fy = doc.page.height - 96;
    doc.moveTo(M, fy).lineTo(M + W, fy).strokeColor(RULE).lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(INK_SOFT);
    doc.text(
      'Declaration: we certify that this invoice shows the actual price of the goods and services described and that all particulars are true and correct.',
      M, fy + 8, { width: W - 150 }
    );
    doc.text('This is a computer-generated invoice and does not require a signature.', M, doc.y + 3, { width: W - 150 });

    // An invoice issued against a placeholder registration must say so
    // on its face rather than look valid.
    if (!data.gstinConfigured) {
      doc.fillColor('#b91c1c').font('Helvetica-Bold')
         .text('NOT A VALID TAX INVOICE — GSTIN not configured.', M, doc.y + 4, { width: W - 150 });
    }

    doc.font('Helvetica-Bold').fontSize(8).fillColor(INK_SOFT);
    doc.text(`For ${data.seller.name}`, M + W - 140, fy + 8, { width: 140, align: 'right' });
    doc.font('Helvetica').fontSize(7.5)
       .text('Authorised signatory', M + W - 140, fy + 40, { width: 140, align: 'right' });

    doc.end();
  });
}

/** Convenience: build and render in one step. Returns null if not found. */
async function renderInvoice(invoiceCustomId) {
  const data = await buildInvoiceData(invoiceCustomId);
  if (!data) return null;
  return { data, pdf: await renderInvoicePdf(data) };
}

/** The filename a clinic sees when they save it. */
function invoiceFilename(invoiceCustomId) {
  return `Hesyra-Invoice-${invoiceCustomId}.pdf`;
}

module.exports = {
  buildInvoiceData,
  renderInvoicePdf,
  renderInvoice,
  invoiceFilename,
  CASE_TYPE_LABELS,
};
