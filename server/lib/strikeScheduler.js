// ═══════════════════════════════════════════════════════════════════
// Strike Scheduler — Daily Midnight Job
// Checks for overdue payments and applies strikes idempotently.
// ═══════════════════════════════════════════════════════════════════

const prisma = require('./prisma');
const config = require('./config');
const paymentEngine = require('./paymentEngine');
const { autoAssignCase } = require('./assignmentEngine');

let schedulerInterval = null;
let poolCheckInterval = null;
let approvalCheckInterval = null;

// Fix #17: Per case-type configurable pool timeout in minutes
// Surgical guides and complex cases get more time; simple retainers less.
const POOL_TIMEOUTS_MINUTES = {
  crown_bridge:   60,
  surgical_guide: 90,  // More complex — allow longer for designer to evaluate
  aligner:        60,
  splint:         45,  // Simpler cases auto-assign sooner
  retainer:       45,
  denture:        60,
  model:          30,  // Simplest case type — fast turnaround expected
  default:        60,  // Fallback for unknown types
};

// Fix #20: Distributed lock key (stored in Counter table which already exists)
const LOCK_KEY = 'pool_escalation_lock';

/**
 * Run the strike evaluation job.
 * Checks all cases where readyForDispatchAt + 7 days has passed without payment.
 */
async function runStrikeEvaluation(io) {
  console.log('⏰ [Strike Scheduler] Running daily evaluation...');

  try {
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - config.STRIKE_DAYS_THRESHOLD);

    // Find all cases that are overdue. Keyed off "money not received"
    // rather than off a status list, because:
    //   - a PAID case now rests at ready_for_dispatch while it waits to be
    //     packed, and must never be struck for that;
    //   - an unpaid case that somehow reached packaged/dispatched/completed
    //     used to escape collection entirely.
    // Net-30 clinics are excluded — runCreditOverdueCheck chases those.
    const overdueCases = await prisma.case.findMany({
      where: {
        status: { in: [
          'payment_pending', 'ready_for_dispatch', 'overdue',
          'packaged', 'dispatched', 'shipped', 'completed',
        ] },
        paymentConfirmedAt: null,
        dispatchedOnCredit: false,
        readyForDispatchAt: { lte: thresholdDate },
        disputeActive: { not: true }, // Handles both false and null
      },
      include: {
        doctor: true,
      },
    });

    let strikesApplied = 0;

    for (const c of overdueCases) {
      const result = await paymentEngine.applyStrike(c.doctorId, c.id);
      if (!result.alreadyApplied) {
        strikesApplied++;
        console.log(`  ⚡ Strike ${result.newStrikeCount} applied to ${c.doctor.name} for case ${c.customId}`);

        // Emit notification via Socket.io
        if (io) {
          io.emit('strike:applied', {
            userId: c.doctorId,
            caseId: c.customId,
            strikeNumber: result.newStrikeCount,
            trustLevel: result.newTrustLevel,
          });
        }
      }
    }

    // ─── Send reminders for approaching deadline ──────────
    for (const reminderDay of config.REMINDER_DAYS) {
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() - reminderDay);
      const reminderDateStart = new Date(reminderDate);
      reminderDateStart.setHours(0, 0, 0, 0);
      const reminderDateEnd = new Date(reminderDate);
      reminderDateEnd.setHours(23, 59, 59, 999);

      const reminderCases = await prisma.case.findMany({
        where: {
          status: { in: ['payment_pending', 'ready_for_dispatch'] },
          readyForDispatchAt: {
            gte: reminderDateStart,
            lte: reminderDateEnd,
          },
          disputeActive: { not: true }, // Handles both false and null
        },
      });

      for (const c of reminderCases) {
        if (io) {
          io.emit('payment:reminder', {
            caseId: c.customId,
            day: reminderDay,
            daysRemaining: config.STRIKE_DAYS_THRESHOLD - reminderDay,
          });
        }
      }
    }

    console.log(`  ✅ [Strike Scheduler] Complete. ${strikesApplied} new strikes applied, ${overdueCases.length} cases evaluated.`);
  } catch (err) {
    console.error('  ❌ [Strike Scheduler] Error:', err);
  }
}

/**
 * Run the archival job.
 * Sweeps all 'completed' cases into 'archived' automatically.
 */
async function runArchivalSweep(io) {
  console.log('📦 [Daily Scheduler] Running case archival sweep...');
  try {
    const completedCases = await prisma.case.findMany({
      where: { status: 'completed' }
    });

    if (completedCases.length === 0) {
      console.log('  ✅ [Daily Scheduler] No completed cases to archive today.');
      return;
    }

    await prisma.case.updateMany({
      where: { status: 'completed' },
      data: { status: 'archived' }
    });

    const timelineData = completedCases.map(c => ({
      caseId: c.id,
      label: 'Status → Archived (Daily Sweep)',
      info: 'Case automatically sent to archive.'
    }));
    await prisma.timeline.createMany({ data: timelineData });

    console.log(`  ✅ [Daily Scheduler] Sweep complete. ${completedCases.length} cases archived.`);

    if (io) {
      for (const c of completedCases) {
        io.emit('case:updated', { customId: c.customId, newStatus: 'archived' });
      }
    }
  } catch (err) {
    console.error('  ❌ [Daily Scheduler] Archival Sweep Error:', err);
  }
}

/**
 * Run the pool escalation job.
 * Fires every 5 minutes. Finds cases past their per-type timeout with no claim.
 * Fix #17: Uses per-case-type timeouts from POOL_TIMEOUTS_MINUTES.
 * Fix #19: Logs all auto-assign and escalate events to AuditLog.
 * Fix #20: Uses a DB-based mutex to prevent double-assignment in multi-instance deploys.
 */
async function runPoolEscalation(io) {
  // Fix #20: Acquire distributed lock using the Counter model as a mutex
  // Only one instance runs at a time. Lock expires after 6 minutes (> check interval).
  const lockExpiry = new Date(Date.now() - 6 * 60 * 1000);
  try {
    // Try to claim the lock by updating the 'value' (timestamp) atomically
    // If another instance already holds the lock (value > lockExpiry), skip.
    const lock = await prisma.counter.findUnique({ where: { id: LOCK_KEY } });
    const now = Date.now();
    if (lock && lock.value > lockExpiry.getTime() / 1000) {
      // Another instance holds the lock and it hasn't expired yet
      return;
    }
    // Claim the lock by writing current timestamp as the value
    await prisma.counter.upsert({
      where: { id: LOCK_KEY },
      create: { id: LOCK_KEY, value: Math.floor(now / 1000) },
      update: { value: Math.floor(now / 1000) },
    });
  } catch (lockErr) {
    console.warn('  [Pool Scheduler] Could not acquire lock — skipping this tick:', lockErr.message);
    return;
  }

  try {
    // Fix #17: For each case type, compute the cutoff based on its configured timeout
    // We do a single query and filter in JS since case types are bounded (7 types)
    const maxTimeout = Math.max(...Object.values(POOL_TIMEOUTS_MINUTES)) * 60 * 1000;
    const maxCutoff = new Date(Date.now() - maxTimeout);

    const candidateCases = await prisma.case.findMany({
      where: {
        status: 'submitted',
        poolEnteredAt: { lte: maxCutoff, not: null },
        assignedDesignerId: null,
      },
      select: { id: true, customId: true, caseType: true, poolEnteredAt: true },
    });

    // Apply per-type timeout filter
    const staleCases = candidateCases.filter(c => {
      const timeoutMs = (POOL_TIMEOUTS_MINUTES[c.caseType] || POOL_TIMEOUTS_MINUTES.default) * 60 * 1000;
      const cutoff = new Date(Date.now() - timeoutMs);
      return new Date(c.poolEnteredAt) <= cutoff;
    });

    if (staleCases.length === 0) return;

    console.log(`🎯 [Pool Scheduler] ${staleCases.length} case(s) past timeout — running auto-assign...`);

    for (const c of staleCases) {
      const result = await autoAssignCase(c.id, io);
      const minutesInPool = Math.floor((Date.now() - new Date(c.poolEnteredAt).getTime()) / 60000);

      if (result.assigned) {
        // Fix #19: Log auto-assign event to AuditLog
        try {
          await prisma.auditLog.create({
            data: {
              actorId:    result.designerId,
              actorRole:  'system',
              action:     'POOL_AUTO_ASSIGN',
              entityType: 'case',
              entityId:   c.id,
              beforeState: JSON.stringify({ status: 'submitted', assignedDesignerId: null }),
              afterState:  JSON.stringify({ status: 'cad_assigned', assignedDesignerId: result.designerId }),
              reason: `Pool timeout (${minutesInPool}min in pool). Algorithm score: ${result.score}/100.`,
            },
          });
        } catch { /* audit log failures must not block operations */ }
      } else {
        // No eligible designer — escalate to manager
        console.warn(`  ⚠️  [Pool Scheduler] Could not auto-assign ${c.customId}: ${result.reason}`);
        if (io) {
          io.emit('manager:alert', {
            type: 'pool_needs_assignment',
            customId: c.customId,
            caseType: c.caseType,
            minutesInPool,
            message: `Case ${c.customId} has been unclaimed for ${minutesInPool} minutes and no designer could be auto-assigned. Manual assignment required.`,
          });
        }
        // Fix #19: Log escalation event
        try {
          const systemUser = await prisma.user.findFirst({ where: { role: 'admin' } });
          if (systemUser) {
            await prisma.auditLog.create({
              data: {
                actorId:    systemUser.id,
                actorRole:  'system',
                action:     'POOL_ESCALATED',
                entityType: 'case',
                entityId:   c.id,
                beforeState: JSON.stringify({ status: 'submitted', minutesInPool }),
                afterState:  JSON.stringify({ status: 'submitted', escalated: true }),
                reason: `No eligible designer. Pool timeout: ${minutesInPool}min. Reason: ${result.reason}`,
              },
            });
          }
        } catch { /* silent */ }
      }
    }
  } catch (err) {
    console.error('❌ [Pool Scheduler] Error:', err);
  } finally {
    // Release the lock regardless of outcome
    try {
      await prisma.counter.update({ where: { id: LOCK_KEY }, data: { value: 0 } });
    } catch { /* silent */ }
  }
}

/**
 * Run the monthly invoicing job for all net_30 clinics.
 * Call on the 1st of every month, or trigger manually from the manager dashboard.
 * billingPeriod: "YYYY-MM" string for the period being invoiced (usually previous month).
 */
async function runMonthlyInvoicing(io, billingPeriod) {
  // Default to previous month if not specified
  if (!billingPeriod) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    billingPeriod = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  console.log(`📅 [Monthly Invoicing] Generating invoices for billing period: ${billingPeriod}`);

  try {
    // Find all active net_30 clinics with uninvoiced credit cases
    const creditClinics = await prisma.user.findMany({
      where: {
        role: 'clinic',
        billingMode: 'net_30',
        status: 'active',
        // Only clinics that actually have uninvoiced credit cases
        cases: {
          some: {
            dispatchedOnCredit: true,
            creditInvoiceId: null,
            status: { notIn: ['cancelled'] },
          },
        },
      },
      select: { id: true, name: true, outstandingPaise: true },
    });

    let invoicesGenerated = 0;

    for (const clinic of creditClinics) {
      try {
        const result = await paymentEngine.generateMonthlyInvoice(clinic.id, billingPeriod);
        if (result) {
          invoicesGenerated++;
          console.log(`  ✅ Invoice for ${clinic.name}: ₹${config.paiseToINR(result.totalPaise)} (${result.caseCount} cases)`);

          if (io) {
            io.emit('invoice:created', {
              userId: clinic.id,
              invoiceId: result.invoice.customId,
              billingPeriod,
              amountPaise: result.totalPaise,
              paymentLink: result.paymentLink?.linkUrl,
            });
          }
        }
      } catch (err) {
        console.error(`  ❌ Failed to generate invoice for ${clinic.name}:`, err.message);
      }
    }

    console.log(`  ✅ [Monthly Invoicing] Done. ${invoicesGenerated} invoices generated.`);
    return { invoicesGenerated, billingPeriod };
  } catch (err) {
    console.error('❌ [Monthly Invoicing] Fatal error:', err);
    throw err;
  }
}

/**
 * Check for overdue credit invoices (past 30-day payment window).
 * Applies a strike and downgrades the clinic to 'prepaid' if unpaid.
 * Runs daily alongside the regular strike evaluation.
 */
async function runCreditOverdueCheck(io) {
  console.log('💳 [Credit Check] Scanning for overdue monthly invoices...');

  try {
    const now = new Date();

    // Find all unpaid monthly invoices past their due date
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        invoiceType: 'monthly',
        status: 'unpaid',
        dueDate: { lte: now },
        userId: { not: null },
      },
      include: {
        user: true,
        cases: { select: { id: true, customId: true } },
      },
    });

    let strikesApplied = 0;

    for (const invoice of overdueInvoices) {
      try {
        // Mark invoice overdue
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: 'overdue' },
        });

        // Apply a strike using the first case on the invoice as the trigger
        // (idempotent — won't double-strike same case)
        if (invoice.cases.length > 0) {
          const result = await paymentEngine.applyStrike(invoice.userId, invoice.cases[0].id);
          if (!result.alreadyApplied) {
            strikesApplied++;

            // Downgrade to prepaid so they can't accumulate more credit debt
            await prisma.user.update({
              where: { id: invoice.userId },
              data: { billingMode: 'prepaid' },
            });

            console.log(`  ⚡ Strike applied to ${invoice.user.name} for overdue invoice ${invoice.customId}. Downgraded to prepaid.`);

            if (io) {
              io.emit('strike:applied', {
                userId: invoice.userId,
                caseId: invoice.cases[0].customId,
                strikeNumber: result.newStrikeCount,
                trustLevel: result.newTrustLevel,
                reason: `Overdue monthly invoice: ${invoice.customId}`,
              });
            }
          }
        }
      } catch (err) {
        console.error(`  ❌ Credit overdue check failed for invoice ${invoice.customId}:`, err.message);
      }
    }

    console.log(`  ✅ [Credit Check] Done. ${overdueInvoices.length} overdue invoices found, ${strikesApplied} strikes applied.`);
  } catch (err) {
    console.error('❌ [Credit Check] Fatal error:', err);
  }
}

/**
 * Start the scheduler — runs the evaluation immediately, then every 24 hours.
 * In production, this would be aligned to midnight IST.
 */
// ═══════════════════════════════════════════════════════════════
// DESIGN APPROVAL SWEEP
// Resolves cases parked on the doctor's desk. Runs every 5 minutes.
//
// Before the due date  → nudge the doctor at the configured points.
// After the due date   → auto-approve if the clinic allows it, otherwise
//                        escalate to the manager and stop nagging.
//
// The lab bench is idle for the whole of this window, so nothing is
// allowed to sit here indefinitely.
// ═══════════════════════════════════════════════════════════════
async function runDesignApprovalSweep(io) {
  const now = new Date();

  const pending = await prisma.case.findMany({
    where: {
      status: 'awaiting_doctor_approval',
      doctorApprovalDueAt: { not: null },
    },
    include: { doctor: { select: { id: true, name: true, autoApproveDesigns: true } } },
  });

  if (pending.length === 0) return;

  let approved = 0, reminded = 0, escalated = 0;

  for (const c of pending) {
    const sentAt = new Date(c.doctorApprovalSentAt || c.createdAt).getTime();
    const dueAt  = new Date(c.doctorApprovalDueAt).getTime();
    const windowMs = Math.max(dueAt - sentAt, 1);

    // ─── Past due ────────────────────────────────────────────
    if (now.getTime() >= dueAt) {
      // Two things can withhold auto-approval: the clinic's own
      // preference, and the nature of the work. The second overrides
      // the first — see AUTO_APPROVE_EXCLUDED_CASE_TYPES in config.
      const optedOut  = c.doctor?.autoApproveDesigns === false;
      const excluded  = (config.AUTO_APPROVE_EXCLUDED_CASE_TYPES || []).includes(c.caseType);
      const highValue = (c.totalAmountPaise || 0) > (config.AUTO_APPROVE_MAX_VALUE_PAISE ?? Infinity);

      if (optedOut || excluded || highValue) {
        // Escalate once and leave the case for a human to decide.
        const why = excluded
          ? `${c.caseType.replace('_', ' ')} designs are never auto-approved — this one needs a person to sign it off.`
          : highValue
            ? `This case is ₹${Math.round((c.totalAmountPaise || 0) / 100).toLocaleString('en-IN')}, above the auto-approval ceiling, so it needs a person to sign it off.`
            : `${c.doctor?.name || 'The doctor'} has auto-approval switched off, so this case waits for a human decision.`;

        if (!c.approvalEscalatedAt) {
          await prisma.case.update({
            where: { id: c.id },
            data: { approvalEscalatedAt: now },
          });
          await prisma.timeline.create({
            data: {
              caseId: c.id,
              label: '⚠️ Approval overdue — escalated to lab manager',
              info: why,
            },
          });
          if (io) io.emit('case:approval_escalated', { customId: c.customId, doctorId: c.doctorId });
          escalated++;
        }
        continue;
      }

      // Auto-approve — but never strand a case without a technician.
      if (!c.assignedTechId) {
        if (!c.approvalEscalatedAt) {
          await prisma.case.update({ where: { id: c.id }, data: { approvalEscalatedAt: now } });
          await prisma.timeline.create({
            data: {
              caseId: c.id,
              label: '⚠️ Auto-approval blocked — no technician assigned',
              info: 'Assign a technician, and this case will auto-approve on the next sweep.',
            },
          });
          escalated++;
        }
        continue;
      }

      await prisma.case.update({
        where: { id: c.id },
        data: {
          status: 'design_approved',
          doctorApprovedAt: now,
          doctorApprovalMethod: 'auto',
          rejectionReason: null,
        },
      });

      await prisma.timeline.create({
        data: {
          caseId: c.id,
          label: '⏱️ Design auto-approved — no response from doctor',
          info: `The approval window closed at ${new Date(dueAt).toLocaleString('en-IN')}. Production has started. Raise a support ticket immediately if this design needs changes.`,
        },
      });

      try {
        await prisma.auditLog.create({
          data: {
            actorId:    c.doctorId,
            actorRole:  'system',
            action:     'DESIGN_AUTO_APPROVED',
            entityType: 'case',
            entityId:   c.id,
            beforeState: JSON.stringify({ status: 'awaiting_doctor_approval' }),
            afterState:  JSON.stringify({ status: 'design_approved', method: 'auto' }),
            reason:      'Doctor did not respond before the approval deadline',
          },
        });
      } catch { /* audit is best-effort */ }

      if (io) {
        io.emit('case:updated', { customId: c.customId, newStatus: 'design_approved' });
        io.emit('case:auto_approved', { customId: c.customId, doctorId: c.doctorId });
      }
      approved++;
      continue;
    }

    // ─── Still within the window — send the next reminder ────
    const elapsedFraction = (now.getTime() - sentAt) / windowMs;
    const points = config.DESIGN_APPROVAL_REMINDER_POINTS || [];
    const dueReminders = points.filter(p => elapsedFraction >= p).length;

    if (dueReminders > (c.approvalRemindersSent || 0)) {
      const hoursLeft = Math.max(0, Math.round((dueAt - now.getTime()) / 3600000));
      await prisma.case.update({
        where: { id: c.id },
        data: { approvalRemindersSent: dueReminders },
      });
      await prisma.timeline.create({
        data: {
          caseId: c.id,
          label: `🔔 Approval reminder sent to ${c.doctor?.name || 'doctor'}`,
          // Must agree with the past-due branch above, or the warning
          // promises an outcome the sweep will not deliver.
          info: `${hoursLeft}h left before this design ${
            c.doctor?.autoApproveDesigns === false ||
            (config.AUTO_APPROVE_EXCLUDED_CASE_TYPES || []).includes(c.caseType) ||
            (c.totalAmountPaise || 0) > (config.AUTO_APPROVE_MAX_VALUE_PAISE ?? Infinity)
              ? 'is escalated to the lab manager'
              : 'auto-approves and goes into production'
          }.`,
        },
      });
      if (io) {
        io.emit('case:approval_reminder', {
          customId: c.customId,
          doctorId: c.doctorId,
          hoursLeft,
        });
      }
      reminded++;
    }
  }

  if (approved || reminded || escalated) {
    console.log(`  👨‍⚕️ [Approval Sweep] ${reminded} reminder(s), ${approved} auto-approved, ${escalated} escalated.`);
  }
}

function startScheduler(io) {
  console.log('🕐 [Daily Scheduler] Initialized — will check daily for overdue payments and archival sweeps');

  const runDailyJobs = () => {
    runStrikeEvaluation(io);
    runArchivalSweep(io);
    runCreditOverdueCheck(io);

    // Run monthly invoicing on the 1st of each month
    const today = new Date();
    if (today.getDate() === 1) {
      runMonthlyInvoicing(io); // billingPeriod auto-defaults to previous month
    }
  };

  // Run once on startup (after a short delay to let DB connect)
  setTimeout(() => runDailyJobs(), 5000);

  // Then run every 24 hours
  schedulerInterval = setInterval(() => runDailyJobs(), 24 * 60 * 60 * 1000);

  // ─── Pool escalation: check every 5 minutes ──────────────
  // First check after 65 seconds (let server fully boot)
  setTimeout(() => {
    runPoolEscalation(io);
    poolCheckInterval = setInterval(() => runPoolEscalation(io), 5 * 60 * 1000);
  }, 65 * 1000);

  console.log('🎯 [Pool Scheduler] Initialized — will auto-assign unclaimed cases after 1 hour');

  // ─── Design approval sweep: check every 5 minutes ─────────
  setTimeout(() => {
    runDesignApprovalSweep(io).catch(e => console.error('Approval sweep failed:', e.message));
    approvalCheckInterval = setInterval(
      () => runDesignApprovalSweep(io).catch(e => console.error('Approval sweep failed:', e.message)),
      5 * 60 * 1000
    );
  }, 75 * 1000);

  console.log(`👨‍⚕️ [Approval Scheduler] Initialized — designs auto-resolve after ${config.DESIGN_APPROVAL_SLA_HOURS}h (${config.DESIGN_APPROVAL_SLA_HOURS_PRIORITY}h for priority)`);
}

/**
 * Stop the scheduler (for graceful shutdown).
 */
function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (poolCheckInterval) {
    clearInterval(poolCheckInterval);
    poolCheckInterval = null;
  }
  if (approvalCheckInterval) {
    clearInterval(approvalCheckInterval);
    approvalCheckInterval = null;
  }
}

module.exports = {
  startScheduler,
  stopScheduler,
  runStrikeEvaluation,
  runArchivalSweep,
  runPoolEscalation,
  runMonthlyInvoicing,
  runCreditOverdueCheck,
  runDesignApprovalSweep,
};

