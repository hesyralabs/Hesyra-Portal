const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// ─── GET /api/invoices ─────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const invoices = await prisma.invoice.findMany({
      include: { cases: { select: { customId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const transformed = invoices.map(inv => ({
      id: inv.customId,
      _dbId: inv.id,
      date: new Date(inv.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      amount: inv.amount,
      status: inv.status,
      clinic: inv.clinic,
      cases: inv.cases.map(c => c.customId),
    }));

    res.json(transformed);
  } catch (err) {
    console.error('GET /invoices error:', err);
    res.status(500).json({ error: 'Failed to fetch invoices' });
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
