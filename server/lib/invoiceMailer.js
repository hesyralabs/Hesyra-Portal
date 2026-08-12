// ═══════════════════════════════════════════════════════════════════
// Invoice delivery
//
// Emails a tax invoice to the clinic with the PDF attached.
//
// The rule this file follows, and the reason it is separate from the
// route that calls it: sending must never be able to fail the thing
// that generated the invoice. A clinic whose SMTP bounced still has a
// valid invoice on their dashboard, and the case is still paid. So
// send() reports what happened and never throws into its caller.
// ═══════════════════════════════════════════════════════════════════

const mailer = require('./mailer');
const invoiceDocument = require('./invoiceDocument');
const config = require('./config');
const prisma = require('./prisma');

const rupees = (paise) => (paise / 100).toLocaleString('en-IN', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function bodyText(data) {
  const lines = [
    `Dear ${data.buyer.contact || data.buyer.name || 'Doctor'},`,
    '',
    data.isMonthly
      ? `Your consolidated invoice for ${data.period} is attached.`
      : 'Your invoice for the case below is attached.',
    '',
    `Invoice   ${data.number}`,
    `Date      ${new Date(data.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    `Amount    Rs. ${rupees(data.grossPaise)} (incl. GST)`,
    data.status === 'paid' ? 'Status    Paid — no action needed' : 'Status    Payment due',
  ];

  if (data.dueDate && data.status !== 'paid') {
    lines.push(`Due       ${new Date(data.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
  }

  lines.push('', 'Cases on this invoice:');
  for (const l of data.lines) {
    lines.push(`  ${l.caseId} — ${l.description} — Rs. ${rupees(l.grossPaise)}`);
  }

  lines.push(
    '',
    'A copy is always available on your Hesyra Portal dashboard under Billing.',
    '',
    config.HESYRA_LEGAL_NAME,
    config.HESYRA_ADDRESS,
    `GSTIN ${data.seller.gstin}`,
  );

  return lines.join('\n');
}

function bodyHtml(data) {
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const rows = data.lines.map(l => `
    <tr>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;">
        <div style="color:#111827;">${esc(l.description)}</div>
        <div style="color:#6b7280;font-size:12px;">${esc(l.caseId)}</div>
      </td>
      <td style="padding:6px 0;border-bottom:1px solid #e5e7eb;text-align:right;color:#111827;white-space:nowrap;">
        Rs. ${rupees(l.grossPaise)}
      </td>
    </tr>`).join('');

  const paid = data.status === 'paid';

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;color:#111827;line-height:1.5;">
  <p style="margin:0 0 16px;">Dear ${esc(data.buyer.contact || data.buyer.name || 'Doctor')},</p>
  <p style="margin:0 0 20px;">${data.isMonthly
    ? `Your consolidated invoice for <strong>${esc(data.period)}</strong> is attached as a PDF.`
    : 'Your invoice is attached as a PDF.'}</p>

  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr>
      <td style="padding:6px 0;color:#6b7280;">Invoice</td>
      <td style="padding:6px 0;text-align:right;"><strong>${esc(data.number)}</strong></td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#6b7280;">Amount (incl. GST)</td>
      <td style="padding:6px 0;text-align:right;"><strong>Rs. ${rupees(data.grossPaise)}</strong></td>
    </tr>
    <tr>
      <td style="padding:6px 0;color:#6b7280;">Status</td>
      <td style="padding:6px 0;text-align:right;color:${paid ? '#047857' : '#c2410c'};">
        <strong>${paid ? 'Paid' : 'Payment due'}</strong>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:20px;">
    <tr><th colspan="2" style="text-align:left;font-size:12px;color:#6b7280;padding-bottom:4px;">CASES</th></tr>
    ${rows}
  </table>

  <p style="margin:22px 0 0;font-size:13px;color:#6b7280;">
    A copy is always available on your Hesyra Portal dashboard under Billing.
  </p>
  <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">
    ${esc(config.HESYRA_LEGAL_NAME)}<br>${esc(config.HESYRA_ADDRESS)}<br>GSTIN ${esc(data.seller.gstin)}
  </p>
</div>`;
}

/**
 * Email an invoice to the clinic it belongs to.
 *
 * Returns a result rather than throwing:
 *   { sent: true,  to }
 *   { sent: false, reason }
 * Every caller generates the invoice first and mails second, so a mail
 * failure must not roll back an invoice that legitimately exists.
 */
async function sendInvoice(invoiceCustomId, { to } = {}) {
  try {
    const built = await invoiceDocument.renderInvoice(invoiceCustomId);
    if (!built) return { sent: false, reason: 'Invoice not found' };

    const { data, pdf } = built;
    const recipient = to || data.buyer.email;

    if (!recipient) {
      return { sent: false, reason: 'The clinic has no email address on file' };
    }
    if (!mailer.isConfigured()) {
      return { sent: false, reason: 'MAIL_NOT_CONFIGURED' };
    }

    // Refuse to email a document that says on its own face that it is
    // not a valid tax invoice. It is still downloadable in-app, where
    // the warning is visible in context — but posting it to a clinic's
    // accountant is how a placeholder GSTIN ends up in a filing.
    if (!data.gstinConfigured) {
      return { sent: false, reason: 'HESYRA_GSTIN is not configured — refusing to email an invalid tax invoice' };
    }

    await mailer.sendMail({
      to: recipient,
      subject: data.isMonthly
        ? `Hesyra Labs — invoice ${data.number} for ${data.period}`
        : `Hesyra Labs — invoice ${data.number}`,
      text: bodyText(data),
      html: bodyHtml(data),
      attachments: [{
        filename: invoiceDocument.invoiceFilename(data.number),
        content: pdf,
        contentType: 'application/pdf',
      }],
    });

    await prisma.invoice.update({
      where: { customId: invoiceCustomId },
      data: { emailedAt: new Date(), emailedTo: recipient },
    }).catch(() => {});

    return { sent: true, to: recipient };
  } catch (err) {
    console.warn(`[Invoice] Could not email ${invoiceCustomId}:`, err.message);
    return { sent: false, reason: err.message };
  }
}

module.exports = { sendInvoice, bodyText, bodyHtml };
