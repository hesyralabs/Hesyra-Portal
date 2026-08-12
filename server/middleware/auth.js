const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'hesyra-super-secret-key-change-in-prod';

// ─── Session timeouts per role (per RBAC v2.0 spec) ───────────
// Admin: 4h | Manager: 8h | Technician/Dispatch: 12h | Designer: 24h | Clinic: 7d
const JWT_EXPIRY_BY_ROLE = {
  admin:        '4h',
  manager:      '8h',
  technician:   '12h',
  cad_designer: '24h',
  ceramist:     '12h',
  dispatch:     '12h',
  clinic:       '7d',
};

// ─── Permission Map (single source of truth) ──────────────────
// Key: permission string used in requirePermission()
// Value: roles that hold this permission
// NOTE: dispatchPermission flag is checked separately via canDispatch()
const PERMISSIONS = {
  // ── Account Management ──────────────────────────────────────
  'accounts.create':          ['admin'],
  'accounts.suspend':         ['admin'],
  'accounts.reactivate':      ['admin'],
  'accounts.roles':           ['admin'],
  'accounts.reset_pw':        ['admin'],
  'accounts.view_all':        ['admin'],

  // ── Case Visibility ─────────────────────────────────────────
  'cases.view_all':           ['admin', 'manager'],
  'cases.view_assigned_tech': ['technician'],
  'cases.view_assigned_cad':  ['cad_designer'],
  'cases.view_own':           ['clinic'],

  // ── Case Actions ────────────────────────────────────────────
  'cases.create':             ['clinic'],
  'cases.assign_tech':        ['admin', 'manager'],
  'cases.assign_designer':    ['admin', 'manager'],
  'cases.advance_state':      ['admin', 'manager', 'technician'],
  'cases.force_state':        ['admin', 'manager'],  // manager writes audit entry with reason
  'cases.flag_priority':      ['admin', 'manager', 'technician'],
  'cases.internal_notes':     ['admin', 'manager', 'technician'],

  // ── Design ──────────────────────────────────────────────────
  'designs.upload':           ['cad_designer'],
  'designs.mark_ready':       ['cad_designer'],
  'designs.mark_revision':    ['admin', 'manager', 'technician'],
  'designs.approve':          ['clinic'],          // Dentist approves/rejects design
  'designs.block':            ['cad_designer'],    // Scan unusable — notifies manager

  // ── Dispatch (checked via canDispatch() helper, not this map)
  // canDispatch(user) = user.dispatchPermission === true

  // ── Open Pool ───────────────────────────────────────────────
  'pool.view':                ['cad_designer'],
  'pool.claim':               ['cad_designer'],
  'pool.unclaim':             ['cad_designer'],
  'pool.stats':               ['admin', 'manager'],


  // ── Support Tickets ─────────────────────────────────────────
  'tickets.view_all':         ['admin', 'manager'],
  'tickets.respond':          ['admin', 'manager'],
  'tickets.escalate':         ['manager'],
  'tickets.create':           ['clinic'],
  'tickets.view_own':         ['clinic'],

  // ── Remake Adjudication ──────────────────────────────────────
  'remakes.adjudicate':       ['admin', 'manager'],
  'remakes.create':           ['clinic'],

  // ── Financial ───────────────────────────────────────────────
  'wallet.view_all':          ['admin'],
  'wallet.view_any_clinic':   ['admin', 'manager'],   // manager: standing only, no ledger
  'wallet.view_own':          ['clinic'],
  'wallet.modify':            ['admin'],              // balance changes

  // Deciding how much a clinic may owe is a financial decision, not an
  // operational one. It was gated by 'wallet.view_any_clinic' — a READ
  // permission guarding a WRITE — which is how a manager ended up able
  // to grant credit lines.
  'billing.set_terms':        ['admin'],
  // Month-end invoicing bills work already dispatched; it derives
  // amounts rather than setting them, so it stays operational.
  'billing.generate_invoices':['admin', 'manager'],
  'payments.override':        ['admin'],              // manual payment confirm
  'payments.refund':          ['admin'],
  'payments.bonus_credit':    ['admin'],

  // ── Communications ──────────────────────────────────────────
  'comms.broadcast':          ['admin'],
  'comms.direct':             ['admin', 'manager'],

  // ── Audit ───────────────────────────────────────────────────
  'audit.view':               ['admin'],
  'audit.export':             ['admin'],
};

// ─── Generate JWT ──────────────────────────────────────────────
function generateToken(user) {
  const expiry = JWT_EXPIRY_BY_ROLE[user.role] || '24h';
  return jwt.sign(
    {
      id:                 user.id,
      customId:           user.customId,
      role:               user.role,
      email:              user.email,
      dispatchPermission: user.dispatchPermission,
    },
    JWT_SECRET,
    { expiresIn: expiry }
  );
}

// ─── authenticate ──────────────────────────────────────────────
// Verifies JWT and attaches decoded payload to req.user
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── requireRole ──────────────────────────────────────────────
// Simple role-string check. Use requirePermission() for finer control.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

// ─── requirePermission ────────────────────────────────────────
// Permission-based check against the PERMISSIONS map.
// Usage: router.post('/something', authenticate, requirePermission('cases.create'), handler)
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const allowed = PERMISSIONS[permission];
    if (!allowed) {
      console.error(`Unknown permission checked: "${permission}"`);
      return res.status(500).json({ error: 'Server misconfiguration — unknown permission' });
    }
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: `Permission denied: ${permission}`,
        yourRole: req.user.role,
        requiredOneOf: allowed,
      });
    }
    next();
  };
}

// ─── canDispatch ──────────────────────────────────────────────
// Dispatch is checked against the dispatchPermission FLAG, not the role.
// This is what makes the Technician→Dispatch split a config change, not
// a code change. Always use this. Never do: role === 'dispatch'.
//
// The flag is read from the database rather than off the token. It IS
// in the JWT, but a token is issued at login and lives for hours — so
// an admin granting or revoking dispatch would not take effect until
// the user happened to log out, and a revoked dispatcher would keep
// handing over parcels for the rest of their shift.
//
// Managers and admins pass without the flag: they supervise the bench
// rather than staff it, and a lab that cannot hand over a parcel
// because its only dispatcher is on leave is worse than one where a
// manager steps in. The audit trail records who actually did it.
async function hasDispatchPermission(reqUser) {
  if (!reqUser) return false;
  if (['admin', 'manager'].includes(reqUser.role)) return true;

  const prisma = require('../lib/prisma');
  const fresh = await prisma.user.findUnique({
    where: { id: reqUser.id },
    select: { dispatchPermission: true, status: true },
  });

  return Boolean(fresh && fresh.status === 'active' && fresh.dispatchPermission);
}

async function canDispatch(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!(await hasDispatchPermission(req.user))) {
    return res.status(403).json({
      error: 'You do not have dispatch permission. Ask an admin to grant it in User Management.',
    });
  }
  next();
}

// ─── requireManagerWalletAccess ───────────────────────────────
// Manager can VIEW clinic wallets (read-only), not modify them.
// This is a special compound check: admin OR (manager AND read-only intent).
// Route handlers must respect the read-only constraint for manager.
function requireWalletAccess(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!['admin', 'manager'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Permission denied: wallet.view_any_clinic' });
  }
  // Attach a flag so route handler knows to enforce read-only for manager
  req.walletReadOnly = req.user.role === 'manager';
  next();
}

module.exports = {
  generateToken,
  authenticate,
  requireRole,
  requirePermission,
  canDispatch,
  hasDispatchPermission,
  requireWalletAccess,
  PERMISSIONS,
  JWT_SECRET,
};
