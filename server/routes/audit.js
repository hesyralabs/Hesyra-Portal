const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requirePermission } = require('../middleware/auth');

const router = express.Router();

// All audit routes require authentication + admin permission
router.use(authenticate, requirePermission('audit.view'));

// ─── GET /api/audit ────────────────────────────────────────────
// Paginated, filterable audit log
router.get('/', async (req, res) => {
  try {
    const {
      page     = 1,
      limit    = 50,
      action,
      entityType,
      actorId,
      from,  // ISO date string
      to,    // ISO date string
    } = req.query;

    const where = {};
    if (action)     where.action     = action;
    if (entityType) where.entityType = entityType;
    if (actorId)    where.actorId    = actorId;
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to)   where.timestamp.lte = new Date(to);
    }

    const [entries, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, name: true, role: true, email: true } },
        },
        orderBy: { timestamp: 'desc' },
        skip:  (Number(page) - 1) * Number(limit),
        take:  Number(limit),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({
      entries,
      pagination: {
        total,
        page:  Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (err) {
    console.error('GET /audit error:', err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

// ─── GET /api/audit/actions ────────────────────────────────────
// Return list of distinct action types for filter dropdowns
router.get('/actions', async (req, res) => {
  try {
    const actions = await prisma.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
    });
    res.json(actions.map(a => a.action));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch action types' });
  }
});

// ─── GET /api/audit/export ─────────────────────────────────────
// CSV export of audit log (admin only)
router.get('/export', requirePermission('audit.export'), async (req, res) => {
  try {
    const { from, to } = req.query;

    const where = {};
    if (from || to) {
      where.timestamp = {};
      if (from) where.timestamp.gte = new Date(from);
      if (to)   where.timestamp.lte = new Date(to);
    }

    const entries = await prisma.auditLog.findMany({
      where,
      include: { actor: { select: { name: true, email: true, role: true } } },
      orderBy: { timestamp: 'desc' },
    });

    // Build CSV
    const headers = ['timestamp', 'actor_name', 'actor_email', 'actor_role', 'action', 'entity_type', 'entity_id', 'reason', 'ip_address'];
    const rows = entries.map(e => [
      e.timestamp.toISOString(),
      e.actor?.name  || '',
      e.actor?.email || '',
      e.actorRole,
      e.action,
      e.entityType,
      e.entityId,
      `"${(e.reason || '').replace(/"/g, '""')}"`,
      e.ipAddress || '',
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="hesyra-audit-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('GET /audit/export error:', err);
    res.status(500).json({ error: 'Failed to export audit log' });
  }
});

module.exports = router;
