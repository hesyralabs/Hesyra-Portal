// ═══════════════════════════════════════════════════════════════════
// Hesyra Assignment Engine — Hybrid Auto-Assignment Algorithm
//
// Scoring formula:
//   SCORE = (W1 × workloadScore) + (W2 × proficiencyScore)
//         + (W3 × speedScore) + (W4 × qualityScore)
//
// Weights are tunable. Defaults are operationally balanced for a
// small dental lab where workload balance is the top priority.
// ═══════════════════════════════════════════════════════════════════

const prisma = require('./prisma');

// ─── Algorithm Weights ───────────────────────────────────────────
const WEIGHTS = {
  workload:    0.40,  // Heaviest weight — always try to balance load
  proficiency: 0.25,  // Has designer done this case type before?
  speed:       0.20,  // How fast does this designer typically work?
  quality:     0.15,  // How low is their revision rate?
};

// ─── Config ──────────────────────────────────────────────────────
const MAX_ACTIVE_CASES = 8;   // Hard ceiling — designer won't be assigned if at this limit
const MAX_TURNAROUND_HOURS = 72; // Benchmark for speed scoring (3 days)

/**
 * Compute a normalized 0–100 score for a designer against a given case type.
 * Lower score = less suitable. Higher score = best pick.
 */
function computeScore(stats, caseType) {
  // ─── 1. Workload Score ─────────────────────────────────────────
  // Fully free (0 cases) = 1.0. At max (MAX_ACTIVE_CASES cases) = 0.0.
  const activeCases = stats.currentActiveCases || 0;
  if (activeCases >= MAX_ACTIVE_CASES) return -1; // Hard exclude
  const workloadScore = 1 - (activeCases / MAX_ACTIVE_CASES);

  // ─── 2. Proficiency Score ──────────────────────────────────────
  // % of completed cases that were this type. New designers get 0.5 (neutral).
  let proficiencyScore = 0.5;
  if (stats.totalCompleted > 0) {
    let breakdown = {};
    try { breakdown = JSON.parse(stats.caseTypeBreakdown || '{}'); } catch {}
    const countForType = breakdown[caseType] || 0;
    proficiencyScore = countForType / stats.totalCompleted;
  }

  // ─── 3. Speed Score ───────────────────────────────────────────
  // Lower avgTurnaroundHours = higher score. New designers get 0.5 (neutral).
  let speedScore = 0.5;
  if (stats.totalCompleted > 0 && stats.avgTurnaroundHours > 0) {
    speedScore = Math.max(0, 1 - (stats.avgTurnaroundHours / MAX_TURNAROUND_HOURS));
  }

  // ─── 4. Quality Score ─────────────────────────────────────────
  // Lower revisionRate = higher score. New designers start at 0.5.
  let qualityScore = 0.5;
  if (stats.totalCompleted > 0) {
    qualityScore = Math.max(0, 1 - (stats.revisionRate || 0));
  }

  // ─── Weighted Sum ─────────────────────────────────────────────
  const rawScore = (
    WEIGHTS.workload    * workloadScore +
    WEIGHTS.proficiency * proficiencyScore +
    WEIGHTS.speed       * speedScore +
    WEIGHTS.quality     * qualityScore
  );

  return Math.round(rawScore * 100);
}

/**
 * Find the best available designer for a given case type.
 * Returns { designer, score } or null if no eligible designer found.
 */
async function findBestDesigner(caseType) {
  // Fetch all active CAD designers along with their stats (or defaults)
  const designers = await prisma.user.findMany({
    where: { role: 'cad_designer', status: 'active' },
    include: { designerStats: true },
  });

  if (designers.length === 0) return null;

  let best = null;
  let bestScore = -1;

  for (const designer of designers) {
    // Use stored stats or default zero-stats for new designers
    const stats = designer.designerStats || {
      currentActiveCases: 0,
      totalCompleted: 0,
      totalRevisions: 0,
      avgTurnaroundHours: 0,
      revisionRate: 0,
      caseTypeBreakdown: '{}',
    };

    const score = computeScore(stats, caseType);
    console.log(`  [AssignEngine] ${designer.name}: score=${score} (workload=${stats.currentActiveCases}/${MAX_ACTIVE_CASES})`);

    if (score > bestScore) {
      bestScore = score;
      best = { designer, score };
    }
  }

  if (!best || bestScore < 0) return null; // All designers at capacity
  return best;
}

/**
 * Auto-assign a case to the best-scoring designer.
 * Updates the Case, creates timeline entry, emits socket events.
 * Returns { assigned: bool, designerId?, designerName?, score? }
 */
async function autoAssignCase(caseDbId, io) {
  const caseRecord = await prisma.case.findUnique({ where: { id: caseDbId } });
  if (!caseRecord) return { assigned: false, reason: 'Case not found' };

  // Guard: already assigned
  if (caseRecord.assignedDesignerId) {
    return { assigned: false, reason: 'Case already assigned' };
  }

  const best = await findBestDesigner(caseRecord.caseType);
  if (!best) {
    console.warn(`  [AssignEngine] No eligible designer found for case ${caseRecord.customId}`);
    return { assigned: false, reason: 'No eligible designer available' };
  }

  const { designer, score } = best;

  // Fix #2: Use atomic updateMany with null guard to prevent race conditions.
  // If a designer claimed the case between findUnique and now, count === 0 and we bail.
  const atomicResult = await prisma.case.updateMany({
    where: {
      id: caseDbId,
      assignedDesignerId: null,  // ← Atomic guard: fail if already claimed by anyone
      status: 'submitted',
    },
    data: {
      assignedDesignerId: designer.id,
      status: 'cad_assigned',
      claimedAt: new Date(),
      claimedBy: designer.id,
      assignmentMethod: 'auto_assign',
    },
  });

  if (atomicResult.count === 0) {
    console.warn(`  [AssignEngine] Race condition: ${caseRecord.customId} was claimed before auto-assign completed.`);
    return { assigned: false, reason: 'Case was claimed by a designer during auto-assign' };
  }

  // Timeline entry
  await prisma.timeline.create({
    data: {
      caseId: caseDbId,
      label: `⏰ Auto-assigned to ${designer.name} (score: ${score}/100)`,
      info: `Pool timeout elapsed. Algorithm selected designer based on workload, proficiency, speed, and quality.`,
    },
  });

  // Update designer stats workload count
  await incrementActiveCount(designer.id, +1);

  // Emit socket events
  if (io) {
    io.emit('case:updated', { customId: caseRecord.customId, newStatus: 'cad_assigned' });
    io.emit('pool:auto_assigned', {
      customId: caseRecord.customId,
      designerId: designer.id,
      designerName: designer.name,
      score,
    });
    io.emit('manager:alert', {
      type: 'auto_assigned',
      customId: caseRecord.customId,
      designerName: designer.name,
      score,
      message: `Case ${caseRecord.customId} auto-assigned to ${designer.name} after pool timeout (score: ${score}/100)`,
    });
  }

  console.log(`  [AssignEngine] ✅ ${caseRecord.customId} → ${designer.name} (score: ${score}/100)`);
  return { assigned: true, designerId: designer.id, designerName: designer.name, score };
}

/**
 * Recalculate and persist a designer's stats from their case history.
 * Fix #7: Uses aggregation queries instead of loading all cases+timelines into memory.
 * Scales efficiently even with 500+ completed cases per designer.
 */
async function updateDesignerStats(designerId) {
  try {
    const completedStatuses = [
      'design_approved', 'post_processing', 'qa',
      'ready_for_dispatch', 'packaged', 'dispatched', 'completed', 'archived',
    ];
    const activeStatuses = ['cad_assigned', 'design_ready', 'design_revision', 'blocked', 'designing'];

    // ─── 1. Aggregated counts (single DB query each) ──────────────
    const [totalCompleted, currentActiveCases] = await Promise.all([
      prisma.case.count({
        where: { assignedDesignerId: designerId, status: { in: completedStatuses } },
      }),
      prisma.case.count({
        where: { assignedDesignerId: designerId, status: { in: activeStatuses } },
      }),
    ]);

    // ─── 2. Revision count — count timeline events, not full case loads ──
    // Find all timeline entries that indicate a revision, scoped to this designer's cases
    const revisionEvents = await prisma.timeline.count({
      where: {
        case: { assignedDesignerId: designerId, status: { notIn: ['cancelled'] } },
        OR: [
          { label: { contains: 'Revision Requested' } },
          { label: { contains: 'design_revision' } },
        ],
      },
    });
    const revisionRate = totalCompleted > 0 ? Math.min(1, revisionEvents / totalCompleted) : 0;

    // ─── 3. Avg turnaround — only pull the relevant timeline events ──
    // Get assignment events and design-ready events for completed cases only
    const [assignEvents, readyEvents] = await Promise.all([
      prisma.timeline.findMany({
        where: {
          case: { assignedDesignerId: designerId, status: { in: completedStatuses } },
          OR: [
            { label: { contains: 'CAD work assigned' } },
            { label: { contains: 'Auto-assigned' } },
            { label: { contains: 'Self-selected' } },
            { label: { contains: 'Assigned to' } },
          ],
        },
        select: { caseId: true, createdAt: true },
      }),
      prisma.timeline.findMany({
        where: {
          case: { assignedDesignerId: designerId, status: { in: completedStatuses } },
          OR: [
            { label: { contains: 'Design submitted' } },
            { label: { contains: 'design_ready' } },
          ],
        },
        select: { caseId: true, createdAt: true },
      }),
    ]);

    // Map caseId → earliest assignment time
    const assignMap = new Map();
    for (const e of assignEvents) {
      if (!assignMap.has(e.caseId) || e.createdAt < assignMap.get(e.caseId)) {
        assignMap.set(e.caseId, e.createdAt);
      }
    }
    // Map caseId → earliest ready time
    const readyMap = new Map();
    for (const e of readyEvents) {
      if (!readyMap.has(e.caseId) || e.createdAt < readyMap.get(e.caseId)) {
        readyMap.set(e.caseId, e.createdAt);
      }
    }

    let totalHours = 0;
    let measuredCases = 0;
    for (const [caseId, assignedAt] of assignMap.entries()) {
      const readyAt = readyMap.get(caseId);
      if (readyAt) {
        const hours = (new Date(readyAt) - new Date(assignedAt)) / 3600000;
        if (hours > 0) { totalHours += hours; measuredCases++; }
      }
    }
    const avgTurnaroundHours = measuredCases > 0 ? totalHours / measuredCases : 0;

    // ─── 4. Case type breakdown — aggregate with groupBy ─────────
    const typeGroups = await prisma.case.groupBy({
      by: ['caseType'],
      where: { assignedDesignerId: designerId, status: { in: completedStatuses } },
      _count: { id: true },
    });
    const caseTypeBreakdown = {};
    for (const g of typeGroups) {
      caseTypeBreakdown[g.caseType] = g._count.id;
    }

    // ─── 5. Upsert the computed stats ─────────────────────────────
    await prisma.designerStats.upsert({
      where: { designerId },
      create: {
        designerId, totalCompleted, totalRevisions: revisionEvents,
        revisionRate, avgTurnaroundHours,
        caseTypeBreakdown: JSON.stringify(caseTypeBreakdown), currentActiveCases,
      },
      update: {
        totalCompleted, totalRevisions: revisionEvents,
        revisionRate, avgTurnaroundHours,
        caseTypeBreakdown: JSON.stringify(caseTypeBreakdown), currentActiveCases,
      },
    });

    console.log(`  [AssignEngine] Stats updated for ${designerId}: completed=${totalCompleted}, revRate=${(revisionRate*100).toFixed(1)}%, avgTurnaround=${avgTurnaroundHours.toFixed(1)}h`);
  } catch (err) {
    console.error('  [AssignEngine] Failed to update designer stats:', err);
  }
}


/**
 * Lightweight atomic increment/decrement of the active case count.
 * Fix #3: Uses Prisma's built-in atomic increment to eliminate read-then-write race conditions.
 */
async function incrementActiveCount(designerId, delta) {
  try {
    await prisma.designerStats.upsert({
      where: { designerId },
      // On first-ever claim for this designer, create the record
      create: {
        designerId,
        currentActiveCases: Math.max(0, delta), // delta is +1 on first claim
      },
      // Atomic increment/decrement — no read required, no race possible
      update: {
        currentActiveCases: {
          ...(delta > 0
            ? { increment: delta }
            : { decrement: Math.abs(delta) }
          ),
        },
      },
    });

    // Clamp to 0 — Prisma doesn't enforce non-negative on Int fields natively
    // Run a follow-up only if a decrement could go negative (rare but safe)
    if (delta < 0) {
      await prisma.designerStats.updateMany({
        where: { designerId, currentActiveCases: { lt: 0 } },
        data: { currentActiveCases: 0 },
      });
    }
  } catch (err) {
    console.error('  [AssignEngine] Failed to increment active count:', err);
  }
}

module.exports = {
  findBestDesigner,
  autoAssignCase,
  updateDesignerStats,
  incrementActiveCount,
  computeScore,
  MAX_ACTIVE_CASES,
};
