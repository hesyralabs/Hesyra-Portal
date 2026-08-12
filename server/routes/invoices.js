const express = require('express');
const prisma = require('../lib/prisma');
const config = require('../lib/config');
const invoiceDocument = require('../lib/invoiceDocument');
const invoiceMailer = require('../lib/invoiceMailer');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

/**
 * Load an invoice the caller is entitled to see.
 * A clinic may only reach its own; lab staff may reach any.
 */
async function getVisibleInvoice(customId, user) {
  const inv = await prisma.invoice.findUnique({ where: { customId } });
  if (!inv) return { error: 404 };
  if (user.role === 'clinic' && inv.userId !== user.id) return { error: 403 };
  return { invoice: inv };
}

// ─── GET /api/invoices ─────────────────────────────────────────
// Scoped to the caller. This previously returned EVERY invoice in the
// database to any authenticated account — so any clinic could read
// every other clinic's invoice numbers, amounts and practice names off
// its own billing page.
router.get('/', authenticate, async (req, res) => {
  try {
    const where = req.user.role === 'clinic' ? { userId: req.user.id } : {};

    const invoices = await prisma.invoice.findMany({
      where,
      include: { cases: { select: { customId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const transformed = invoices.map(inv => {
      // `amount` means the taxable value on a per-case invoice and the
      // gross on a monthly one (HANDOFF §8). The client should never
      // have to know that, so both are resolved here.
      const amountPaise = Math.round((inv.amount || 0) * 100);
      const taxPaise    = inv.taxAmountPaise || 0;
      const grossPaise  = inv.invoiceType === 'monthly' ? amountPaise : amountPaise + taxPaise;

      return {
        id: inv.customId,
        _dbId: inv.id,
        date: new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        createdAt: inv.createdAt,
        amount: inv.amount,
        netPaise: grossPaise - taxPaise,
        taxPaise,
        grossPaise,
        gstRate: inv.gstRate,
        status: inv.status,
        clinic: inv.clinic,
        invoiceType: inv.invoiceType,
        billingPeriod: inv.billingPeriod,
        dueDate: inv.dueDate,
        paidAt: inv.paidAt,
        emailedAt: inv.emailedAt,
        cases: inv.cases.map(c => c.customId),
        pdfUrl: `/api/invoices/${inv.customId}/pdf`,
      };
    });

    res.json(transformed);
  } catch (err) {
    console.error('GET /invoices error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// ─── GET /api/invoices/:customId/pdf ───────────────────────────
// The tax invoice itself. Inline by default so it opens in the
// browser's viewer; ?download=1 forces a save.
router.get('/:customId/pdf', authenticate, async (req, res) => {
  try {
    const { invoice, error } = await getVisibleInvoice(req.params.customId, req.user);
    if (error === 404) return res.status(404).json({ error: 'Invoice not found' });
    if (error === 403) return res.status(403).json({ error: 'Access denied' });

    const built = await invoiceDocument.renderInvoice(invoice.customId);
    if (!built) return res.status(404).json({ error: 'Invoice not found' });

    const filename = invoiceDocument.invoiceFilename(invoice.customId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', built.pdf.length);
    res.setHeader(
      'Content-Disposition',
      `${req.query.download ? 'attachment' : 'inline'}; filename="${filename}"`
    );
    res.send(built.pdf);
  } catch (err) {
    console.error('GET /invoices/:id/pdf error:', err);
    res.status(500).json({ error: 'Failed to render invoice' });
  }
});

// ─── POST /api/invoices/:customId/email ────────────────────────
// Send (or resend) the invoice to the clinic. A clinic may request its
// own copy; lab staff may send any.
router.post('/:customId/email', authenticate, async (req, res) => {
  try {
    const { invoice, error } = await getVisibleInvoice(req.params.customId, req.user);
    if (error === 404) return res.status(404).json({ error: 'Invoice not found' });
    if (error === 403) return res.status(403).json({ error: 'Access denied' });

    const result = await invoiceMailer.sendInvoice(invoice.customId);

    if (!result.sent) {
      // Never report a send that did not happen.
      const status = result.reason === 'MAIL_NOT_CONFIGURED' ? 503 : 400;
      return res.status(status).json({
        error: result.reason === 'MAIL_NOT_CONFIGURED'
          ? 'Email delivery is not configured on this server. Set SMTP_HOST, SMTP_PORT and SMTP_FROM in server/.env and restart.'
          : result.reason,
      });
    }

    res.json({ success: true, sentTo: result.to });
  } catch (err) {
    console.error('POST /invoices/:id/email error:', err);
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

// ─── PUT /api/invoices/:customId ───────────────────────────────
router.put('/:customId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const inv = await prisma.invoice.findUnique({ where: { customId: req.params.customId } });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const newStatus = inv.status === 'paid' ? 'unpaid' : 'paid';
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: newStatus } });

    const io = req.app.get('io');
    if (io) io.emit('invoice:updated', { customId: req.params.customId, status: newStatus });

    res.json({ success: true, status: newStatus });
  } catch (err) {
    console.error('PUT /invoices/:id error:', err);
    res.status(500).json({ error: 'Failed to update invoice' });
  }
});

// ─── DELETE /api/invoices/:customId ────────────────────────────
router.delete('/:customId', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const inv = await prisma.invoice.findUnique({ where: { customId: req.params.customId } });
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    await prisma.invoice.delete({ where: { id: inv.id } });

    const io = req.app.get('io');
    if (io) io.emit('invoice:deleted', { customId: req.params.customId });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /invoices/:id error:', err);
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

module.exports = router;
