const prisma = require('./prisma');

// ─── Audit Action Constants ────────────────────────────────────
const AUDIT_ACTIONS = {
  PAYMENT_OVERRIDE:     'PAYMENT_OVERRIDE',
  CASE_STATE_FORCE:     'CASE_STATE_FORCE',

  // ─── Ordinary case lifecycle ─────────────────────────────────
  // Previously only *forced* overrides were audited, so a case that
  // moved through the whole pipeline normally left no record of who
  // moved it — the Timeline is a patient-facing narrative with no
  // actor, no before/after and no IP. Reconstructing "who sent this to
  // print" after the fact was impossible. These cover the normal path.
  CASE_CREATED:         'CASE_CREATED',
  CASE_STATUS_CHANGE:   'CASE_STATUS_CHANGE',
  CASE_EDITED:          'CASE_EDITED',
  CASE_ASSIGNED:        'CASE_ASSIGNED',
  CASE_FILE_UPLOADED:   'CASE_FILE_UPLOADED',
  CASE_FILE_DELETED:    'CASE_FILE_DELETED',
  CASE_DELETED:         'CASE_DELETED',
  DESIGN_APPROVED:      'DESIGN_APPROVED',
  DESIGN_REVISION:      'DESIGN_REVISION',
  DESIGN_AUTO_APPROVED: 'DESIGN_AUTO_APPROVED',
  PAYMENT_CONFIRMED:    'PAYMENT_CONFIRMED',
  ACCOUNT_SUSPEND:      'ACCOUNT_SUSPEND',
  ACCOUNT_REACTIVATE:   'ACCOUNT_REACTIVATE',
  ACCOUNT_CREATE:       'ACCOUNT_CREATE',
  ROLE_CHANGE:          'ROLE_CHANGE',
  BONUS_CREDIT:         'BONUS_CREDIT',
  // Granting or revoking Net-30 terms. Was logged as CASE_STATE_FORCE
  // "reusing the closest action type", which mislabelled a financial
  // decision and put user rows into case-override searches.
  CREDIT_TERMS_CHANGED: 'CREDIT_TERMS_CHANGED',
  REFUND:               'REFUND',
  REMAKE_APPROVED:      'REMAKE_APPROVED',
  REMAKE_REJECTED:      'REMAKE_REJECTED',
  BROADCAST_SENT:       'BROADCAST_SENT',
  PASSWORD_RESET:       'PASSWORD_RESET',
  TICKET_ESCALATED:     'TICKET_ESCALATED',
  DESIGNER_DEACTIVATED: 'DESIGNER_DEACTIVATED',
};

// ─── logAudit ─────────────────────────────────────────────────
// Writes an immutable audit entry. Runs in its own try/catch so a
// failed write NEVER blocks the action it records — but it logs a
// critical error that should trigger a monitoring alert in production.
//
// Usage:
//   await logAudit({
//     req,                          // Express request (for actorId, role, ip)
//     action: AUDIT_ACTIONS.REFUND,
//     entityType: 'wallet',
//     entityId: walletId,
//     beforeState: { balancePaise: 5000 },
//     afterState:  { balancePaise: 8000 },
//     reason: 'Case MH272CB-26040002 cancelled before dispatch',
//   });
async function logAudit({
  req,
  actorId,
  actorRole,
  action,
  entityType,
  entityId,
  beforeState = null,
  afterState  = null,
  reason      = '',
  metadata    = null,
}) {
  // Prefer values pulled from req.user if req is provided
  const resolvedActorId   = actorId   || req?.user?.id;
  const resolvedActorRole = actorRole || req?.user?.role;
  const ipAddress = req?.headers?.['x-forwarded-for']?.split(',')[0].trim()
                 || req?.socket?.remoteAddress
                 || null;

  // Guard: reason is mandatory for override-type actions
  const overrideActions = [
    AUDIT_ACTIONS.PAYMENT_OVERRIDE,
    AUDIT_ACTIONS.CASE_STATE_FORCE,
    AUDIT_ACTIONS.BONUS_CREDIT,
    AUDIT_ACTIONS.REFUND,
    AUDIT_ACTIONS.REMAKE_APPROVED,
    AUDIT_ACTIONS.REMAKE_REJECTED,
    AUDIT_ACTIONS.ROLE_CHANGE,
  ];
  if (overrideActions.includes(action) && !reason.trim()) {
    // Log the missing-reason event itself, but don't throw — the action already happened
    console.error(`⚠️ AUDIT: reason field is empty for action "${action}" on ${entityType}/${entityId}`);
  }

  try {
    await prisma.auditLog.create({
      data: {
        actorId:     resolvedActorId,
        actorRole:   resolvedActorRole,
        action,
        entityType,
        entityId,
        beforeState: beforeState ? JSON.stringify(beforeState) : null,
        afterState:  afterState  ? JSON.stringify(afterState)  : null,
        reason:      reason || '',
        ipAddress,
        metadata:    metadata ? JSON.stringify(metadata) : null,
      },
    });
  } catch (err) {
    // CRITICAL: Audit write failed. The action already completed.
    // In production this must trigger an alert (PagerDuty, Sentry, etc.)
    console.error('🚨 AUDIT LOG WRITE FAILED — action completed but not recorded:', {
      action, entityType, entityId, actorId: resolvedActorId, err: err.message,
    });
    // TODO: fire monitoring alert here
  }
}

module.exports = { logAudit, AUDIT_ACTIONS };
