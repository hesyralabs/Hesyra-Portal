const express = require('express');
const prisma = require('../lib/prisma');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ═══════════════════════════════════════════════════════════════
// PUBLIC CATALOG — Active materials for a given caseType
// Any authenticated user can fetch (doctors use this in NewCase form).
// ═══════════════════════════════════════════════════════════════

// GET /api/catalog/materials?caseType=crown_bridge
router.get('/materials', async (req, res) => {
  try {
    const { caseType } = req.query;
    const all = await prisma.materialSKU.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Filter by caseType if provided (caseTypes is a JSON string array)
    let filtered = all;
    if (caseType) {
      filtered = all.filter(m => {
        try {
          const types = JSON.parse(m.caseTypes);
          return types.includes(caseType);
        } catch { return false; }
      });
    }

    // Shape response based on role
    const isLabStaff = ['admin', 'manager', 'technician', 'ceramist'].includes(req.user.role);

    res.json(filtered.map(m => ({
      id: m.id,
      slug: m.slug,
      displayName: m.displayName,
      internalName: isLabStaff ? m.internalName : undefined,
      category: m.category,
      shadeApplicable: m.shadeApplicable,
      finishingTiers: JSON.parse(m.finishingTiers || '["standard"]'),
      // Pricing is published in the Hesyra price list, so it is not
      // confidential — clinics see the same rates as the lab and can
      // price a case up front instead of finding out at checkout.
      basePrice: m.basePrice,
      premiumUpcharge: m.premiumUpcharge,
      // Lets the case form show a "from" price per category without
      // firing one request per case type.
      caseTypes: (() => { try { return JSON.parse(m.caseTypes || '[]'); } catch { return []; } })(),
      sortOrder: m.sortOrder,
      stockNote: isLabStaff ? m.stockNote : undefined,
    })));
  } catch (err) {
    console.error('GET /catalog/materials error:', err);
    res.status(500).json({ error: 'Failed to fetch materials' });
  }
});

// ─── GET /api/catalog/pricing-rules ────────────────────────────
// The category rules that are not expressible as a material SKU:
// aligner treatment tiers, per-implant guide pricing, veneer base
// cases, and the categories that are quote-on-request.
router.get('/pricing-rules', (req, res) => {
  const pricing = require('../lib/pricing');
  const config = require('../lib/config');
  res.json({
    // gstRate is the default. gstRateByCaseType overrides it per type —
    // the New Case estimate has to apply the same rule the server does,
    // or the quoted total stops matching the invoice.
    gstRate: config.GST_RATE,
    gstRateByCaseType: config.GST_RATE_BY_CASE_TYPE,
    alignerTiers: Object.entries(pricing.ALIGNER_TIERS).map(([id, t]) => ({
      id,
      label: t.label,
      note: t.note,
      casePaise: t.casePaise ?? null,
      includedSets: t.includedSets ?? null,
      extraSetPaise: t.extraSetPaise ?? null,
      perSetPaise: t.perSetPaise ?? null,
      bothArchPaise: t.bothArchPaise ?? null,
      perArchPaise: t.perArchPaise ?? null,
      payPerSet: !!t.payPerSet,
      unlimited: !!t.unlimited,
    })),
    guidePricing: pricing.GUIDE_PRICE_BY_IMPLANTS,
    guideMaxImplants: pricing.GUIDE_MAX_PRICED_IMPLANTS,
    vspAddOnPaise: pricing.VSP_ADDON_PAISE,
    veneerRules: pricing.VENEER_RULES,
    quoteOnRequest: pricing.QUOTE_ON_REQUEST,
  });
});

// ═══════════════════════════════════════════════════════════════
// ADMIN/MANAGER CATALOG — Full CRUD
// ═══════════════════════════════════════════════════════════════

// GET /api/catalog/materials/all — All materials (including inactive) for admin panel
router.get('/materials/all', requireRole('manager', 'admin'), async (req, res) => {
  try {
    const all = await prisma.materialSKU.findMany({ orderBy: { sortOrder: 'asc' } });
    res.json(all.map(m => ({
      ...m,
      caseTypes: JSON.parse(m.caseTypes || '[]'),
      finishingTiers: JSON.parse(m.finishingTiers || '["standard"]'),
    })));
  } catch (err) {
    console.error('GET /catalog/materials/all error:', err);
    res.status(500).json({ error: 'Failed to fetch all materials' });
  }
});

// POST /api/catalog/materials — Create new material (admin only for pricing, manager for stock)
router.post('/materials', requireRole('admin'), async (req, res) => {
  try {
    const { slug, displayName, internalName, caseTypes, category, shadeApplicable, finishingTiers, basePrice, premiumUpcharge, sortOrder, stockNote } = req.body;

    if (!slug || !displayName || !caseTypes || !category) {
      return res.status(400).json({ error: 'slug, displayName, caseTypes, and category are required' });
    }

    const existing = await prisma.materialSKU.findUnique({ where: { slug } });
    if (existing) return res.status(409).json({ error: `Material with slug '${slug}' already exists` });

    const material = await prisma.materialSKU.create({
      data: {
        slug,
        displayName,
        internalName: internalName || null,
        caseTypes: JSON.stringify(caseTypes),
        category,
        shadeApplicable: shadeApplicable !== false,
        finishingTiers: JSON.stringify(finishingTiers || ['standard', 'premium']),
        basePrice: basePrice || null,
        premiumUpcharge: premiumUpcharge || null,
        sortOrder: sortOrder || 0,
        stockNote: stockNote || null,
        active: true,
      },
    });

    res.status(201).json(material);
  } catch (err) {
    console.error('POST /catalog/materials error:', err);
    res.status(500).json({ error: 'Failed to create material' });
  }
});

// PUT /api/catalog/materials/:slug — Update material
// Admin: can change everything (including pricing)
// Manager: can only toggle active + stockNote
router.put('/materials/:slug', requireRole('manager', 'admin'), async (req, res) => {
  try {
    const existing = await prisma.materialSKU.findUnique({ where: { slug: req.params.slug } });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    const isAdmin = req.user.role === 'admin';
    const { displayName, internalName, caseTypes, category, shadeApplicable, finishingTiers, basePrice, premiumUpcharge, sortOrder, active, stockNote } = req.body;

    const updateData = {};

    // Manager can only toggle active and stockNote
    if (active !== undefined) updateData.active = active;
    if (stockNote !== undefined) updateData.stockNote = stockNote;

    // Admin-only fields
    if (isAdmin) {
      if (displayName !== undefined) updateData.displayName = displayName;
      if (internalName !== undefined) updateData.internalName = internalName;
      if (caseTypes !== undefined) updateData.caseTypes = JSON.stringify(caseTypes);
      if (category !== undefined) updateData.category = category;
      if (shadeApplicable !== undefined) updateData.shadeApplicable = shadeApplicable;
      if (finishingTiers !== undefined) updateData.finishingTiers = JSON.stringify(finishingTiers);
      if (basePrice !== undefined) updateData.basePrice = basePrice;
      if (premiumUpcharge !== undefined) updateData.premiumUpcharge = premiumUpcharge;
      if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    }

    const updated = await prisma.materialSKU.update({
      where: { slug: req.params.slug },
      data: updateData,
    });

    res.json({ ...updated, caseTypes: JSON.parse(updated.caseTypes), finishingTiers: JSON.parse(updated.finishingTiers) });
  } catch (err) {
    console.error('PUT /catalog/materials error:', err);
    res.status(500).json({ error: 'Failed to update material' });
  }
});

// DELETE /api/catalog/materials/:slug — Soft-delete (sets active: false)
router.delete('/materials/:slug', requireRole('admin'), async (req, res) => {
  try {
    const existing = await prisma.materialSKU.findUnique({ where: { slug: req.params.slug } });
    if (!existing) return res.status(404).json({ error: 'Material not found' });

    await prisma.materialSKU.update({ where: { slug: req.params.slug }, data: { active: false } });
    res.json({ success: true, message: `${existing.displayName} deactivated` });
  } catch (err) {
    console.error('DELETE /catalog/materials error:', err);
    res.status(500).json({ error: 'Failed to deactivate material' });
  }
});

// PUT /api/catalog/materials-reorder — Bulk update sortOrder
router.put('/materials-reorder', requireRole('admin', 'manager'), async (req, res) => {
  try {
    const { order } = req.body; // [{ slug, sortOrder }]
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array required' });

    await prisma.$transaction(
      order.map(item => prisma.materialSKU.update({
        where: { slug: item.slug },
        data: { sortOrder: item.sortOrder },
      }))
    );

    res.json({ success: true });
  } catch (err) {
    console.error('PUT /catalog/materials-reorder error:', err);
    res.status(500).json({ error: 'Failed to reorder' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SHADE PALETTE — Centralized VITA Classical + Bleach
// ═══════════════════════════════════════════════════════════════
router.get('/shades', (req, res) => {
  const shades = [
    // VITA Classical A series
    { id: 'A1', group: 'A', name: 'A1', hex: '#f5e6c8' },
    { id: 'A2', group: 'A', name: 'A2', hex: '#ecd9b0' },
    { id: 'A3', group: 'A', name: 'A3', hex: '#dcc48e' },
    { id: 'A3.5', group: 'A', name: 'A3.5', hex: '#d4b97a' },
    { id: 'A4', group: 'A', name: 'A4', hex: '#c9a862' },
    // B series
    { id: 'B1', group: 'B', name: 'B1', hex: '#f0e4c6' },
    { id: 'B2', group: 'B', name: 'B2', hex: '#e8d8b2' },
    { id: 'B3', group: 'B', name: 'B3', hex: '#dbc793' },
    { id: 'B4', group: 'B', name: 'B4', hex: '#ccb57a' },
    // C series
    { id: 'C1', group: 'C', name: 'C1', hex: '#e8dcc0' },
    { id: 'C2', group: 'C', name: 'C2', hex: '#ddd0a8' },
    { id: 'C3', group: 'C', name: 'C3', hex: '#cfc092' },
    { id: 'C4', group: 'C', name: 'C4', hex: '#bfab78' },
    // D series
    { id: 'D2', group: 'D', name: 'D2', hex: '#e6ddca' },
    { id: 'D3', group: 'D', name: 'D3', hex: '#d8ceb4' },
    { id: 'D4', group: 'D', name: 'D4', hex: '#c8bc9a' },
    // Bleach
    { id: 'BL1', group: 'BL', name: 'BL1', hex: '#faf6ee' },
    { id: 'BL2', group: 'BL', name: 'BL2', hex: '#f5efe4' },
    { id: 'BL3', group: 'BL', name: 'BL3', hex: '#ede6d8' },
    { id: 'BL4', group: 'BL', name: 'BL4', hex: '#e5dece' },
  ];
  res.json(shades);
});

// ═══════════════════════════════════════════════════════════════
// SIGNATURE MATCH UPCHARGE TABLE — Admin-only real-time pricing
// Returns upcharge rules per case type
// ═══════════════════════════════════════════════════════════════
router.get('/upcharges', (req, res) => {
  // These are the Signature Match upcharges.
  // They are stored as constants but admin can override per-SKU via premiumUpcharge field.
  // The per-SKU premiumUpcharge takes priority; this is the fallback.
  const upcharges = {
    crown_bridge: { type: 'per_unit', amount: 19900, label: '₹199/unit' },      // ₹199 per crown
    bridge_per_tooth: { type: 'per_tooth', amount: 12000, label: '₹120/tooth' }, // ₹120 per tooth in bridge
    veneer: { type: 'per_unit', amount: 50000, label: '₹500/unit' },             // ₹500 per veneer
    denture: { type: 'per_unit', amount: 50000, label: '₹500/unit' },            // ₹500 per denture
  };
  res.json(upcharges);
});

module.exports = router;
