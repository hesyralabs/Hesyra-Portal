import React, { useState, useEffect } from 'react';
import { Plus, AlertTriangle, CreditCard, Gift } from 'lucide-react';
import { scanDayAPI } from '../../utils/api';
import Skeleton from '../../components/UI/Skeleton';
import StrikeBadge from '../../components/UI/StrikeBadge';
import WelcomeModal from '../../components/Onboarding/WelcomeModal';
import DeepDiveDrawer from '../../components/Onboarding/DeepDiveDrawer';
import Confetti from '../../components/Onboarding/Confetti';
import { useNavigate, Link } from 'react-router-dom';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import { usePayment } from '../../context/PaymentContext';
import { useOnboarding } from '../../context/OnboardingContext';
import styles from './Dashboard.module.css';

// ── Pipeline model ──────────────────────────────────────────────
// A kanban column is the LAB's mental model: the lab moves cases, the
// dentist does not. What a dentist needs is — does this need me, where
// has it got to, when does it land. So the stage becomes a property
// drawn on each case row rather than a column position. That scales to
// any number of lab statuses and never scrolls sideways.
const STAGES = ['Submitted', 'Design', 'Approved', 'Production', 'Dispatched'];

const STAGE_OF = {
  draft: 0, submitted: 0, action_required: 0,
  cad_assigned: 1, designing: 1, design_ready: 1, design_revision: 1, blocked: 1,
  awaiting_doctor_approval: 1, pending_approval: 1,
  design_approved: 2,
  batched: 3, printing: 3, printed: 3, finishing: 3, post_processing: 3, qa: 3,
  ready_for_dispatch: 3, payment_pending: 3, overdue: 3, packaged: 3,
  dispatched: 4, shipped: 4, completed: 4,
};

// Plain English for the cases that need nothing from the doctor.
const LAB_STATE = {
  submitted: 'Received by lab',
  cad_assigned: 'Being designed',
  designing: 'Being designed',
  design_ready: 'Design in lab review',
  design_revision: 'Design being reworked',
  blocked: 'Held — scan issue',
  design_approved: 'Approved for production',
  batched: 'Queued to print',
  printing: 'Printing',
  printed: 'Printed',
  finishing: 'Ceramist finishing',
  post_processing: 'Finishing',
  qa: 'Quality check',
  ready_for_dispatch: 'Ready to pack',
  packaged: 'Packed',
  completed: 'Delivered',
};

const TONE_RANK = { danger: 0, warn: 1, action: 2, info: 3 };

const Dashboard = () => {
  const { cases } = useCases();
  const { user } = useAuth();
  const { wallet, trustStatus, paiseToINR } = usePayment();
  const { showWelcome, showConfetti, clearConfetti } = useOnboarding();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(true);
  const [segment, setSegment] = useState('all');
  const [query, setQuery] = useState('');
  const [scanDay, setScanDay] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 400);
    return () => clearTimeout(t);
  }, []);

  // Scan Day standing. Keyed to the user so it fetches once the session
  // has actually resolved rather than racing it on mount.
  useEffect(() => {
    if (user?.role !== 'clinic') return;
    let cancelled = false;
    scanDayAPI.myCredits()
      .then(d => { if (!cancelled) setScanDay(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  // Every case on a clinic's own board carries that clinic's code
  // (MH272CB-…). Repeating it on every row spends width telling the
  // doctor something they already know; the full ID stays in the title.
  const shortCaseId = (id) => {
    if (!id) return '';
    const code = user?.username;
    if (code && id.startsWith(code)) return id.slice(code.length);
    return id.replace(/^[A-Z]{2}\d{3}/, '');
  };

  // What the doctor must actually do, if anything. Everything else is
  // the lab's problem and shows as progress, not as a task.
  const actionFor = (c) => {
    switch (c.status) {
      case 'draft':
        return { label: 'Finish and submit', tone: 'info' };
      case 'action_required':
        return { label: 'Information needed', tone: 'warn' };
      case 'awaiting_doctor_approval':
      case 'pending_approval': {
        const h = c.doctorApprovalDueAt
          ? Math.round((new Date(c.doctorApprovalDueAt) - Date.now()) / 3600000)
          : null;
        return {
          label: h === null ? 'Approve design'
            : h > 0 ? `Approve design · ${h}h left`
            : 'Approval overdue',
          tone: h !== null && h <= 6 ? 'warn' : 'action',
        };
      }
      case 'payment_pending':
        return { label: `Pay ${paiseToINR(c.totalAmountPaise)}`, tone: 'action' };
      case 'overdue':
        return { label: `Overdue · ${paiseToINR(c.totalAmountPaise)}`, tone: 'danger' };
      case 'dispatched':
      case 'shipped':
        return { label: 'Confirm receipt', tone: 'info' };
      default:
        return null;
    }
  };

  const SEGMENTS = [
    { key: 'attention', label: 'Needs you',  match: c => !!actionFor(c) },
    { key: 'lab',       label: 'At the lab', match: c => !actionFor(c) && (STAGE_OF[c.status] ?? 0) < 4 },
    { key: 'transit',   label: 'On the way', match: c => ['dispatched', 'shipped'].includes(c.status) },
    { key: 'done',      label: 'Delivered',  match: c => c.status === 'completed' },
  ];

  // The API already scopes /api/cases to the signed-in clinic.
  const dashboardCases = cases.filter(c => !['archived', 'cancelled'].includes(c.status));
  const activeCount = dashboardCases.filter(c => !['dispatched', 'shipped', 'completed'].includes(c.status)).length;

  const attentionCases = dashboardCases
    .filter(c => actionFor(c))
    .sort((a, b) => TONE_RANK[actionFor(a).tone] - TONE_RANK[actionFor(b).tone]);

  const seg = SEGMENTS.find(s => s.key === segment);
  const q = query.trim().toLowerCase();
  const visibleCases = dashboardCases
    .filter(c => (seg ? seg.match(c) : true))
    .filter(c => !q || c.patient?.toLowerCase().includes(q) || c.id?.toLowerCase().includes(q))
    .sort((a, b) => (actionFor(b) ? 1 : 0) - (actionFor(a) ? 1 : 0));

  return (
    <>
      {showWelcome && <WelcomeModal />}
      <DeepDiveDrawer />
      {showConfetti && <Confetti onComplete={clearConfetti} />}

      <div className={styles.workspaceHeader}>
        <div>
          <h1 className={styles.workspaceTitle}>Active Cases</h1>
          <p className={styles.workspaceSubtitle}>
            {dashboardCases.length} total · {activeCount} in progress
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link to="/billing" className={styles.walletChip}>
            <CreditCard size={14} />
            <span>₹{wallet ? (wallet.balancePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }) : '0.00'}</span>
          </Link>
          {trustStatus && trustStatus.trustLevel !== 'clean' && <StrikeBadge compact />}
          <Link to="/new-case" className={styles.btnPrimary}>
            <Plus size={16} /> New Rx Request
          </Link>
        </div>
      </div>

      {/* Surfaces only what the doctor must act on, with the action and
          its deadline stated. Hidden entirely when there is nothing to
          do, so it never becomes wallpaper. */}
      {attentionCases.length > 0 && (
        <section className={styles.attentionBand}>
          <div className={styles.attentionHead}>
            <AlertTriangle size={14} />
            {attentionCases.length} case{attentionCases.length > 1 ? 's need' : ' needs'} you
          </div>
          <div className={styles.attentionItems}>
            {attentionCases.slice(0, 4).map(c => {
              const a = actionFor(c);
              return (
                <button key={c.id} className={`${styles.attentionItem} ${styles[a.tone]}`}
                  onClick={() => navigate(`/case/${c.id}`)}>
                  <span className={styles.attentionPatient}>{c.patient}</span>
                  <span className={styles.attentionAction}>{a.label}</span>
                </button>
              );
            })}
            {attentionCases.length > 4 && (
              <button className={styles.attentionMore} onClick={() => setSegment('attention')}>
                +{attentionCases.length - 4} more
              </button>
            )}
          </div>
        </section>
      )}

      {/* Scan Day — shown only when the clinic has crowns in hand or a
          window still running. Nothing to say, nothing on screen. */}
      {(scanDay?.credits?.length > 0 || scanDay?.progress) && (
        <section className={styles.scanDayBand}>
          <Gift size={14} className={styles.scanDayIcon} />
          <div className={styles.scanDayText}>
            {scanDay.credits.length > 0 && (
              <span className={styles.scanDayCredits}>
                {scanDay.credits.length} complimentary crown{scanDay.credits.length > 1 ? 's' : ''} ready
              </span>
            )}
            {scanDay.progress && (
              <span className={styles.scanDayProgress}>
                {scanDay.credits.length > 0 && <span className={styles.scanDaySep} />}
                Scan Day window · {scanDay.progress.crownOrderCount} crown order
                {scanDay.progress.crownOrderCount === 1 ? '' : 's'}
                {scanDay.progress.nextRewardAt
                  ? ` · ${scanDay.progress.nextRewardAt - scanDay.progress.crownOrderCount} more for +${scanDay.progress.nextRewardCrowns} free`
                  : ' · all rewards earned'}
                {' · closes '}
                {new Date(scanDay.progress.qualifiesUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </span>
            )}
          </div>
          {scanDay.credits.length > 0 && (
            <Link to="/new-case" className={styles.scanDayAction}>Use one</Link>
          )}
        </section>
      )}

      <div className={styles.toolbar}>
        <div className={styles.segments} role="tablist">
          <button role="tab" aria-selected={segment === 'all'}
            className={`${styles.segment} ${segment === 'all' ? styles.segmentOn : ''}`}
            onClick={() => setSegment('all')}>
            All <span className={styles.segCount}>{dashboardCases.length}</span>
          </button>
          {SEGMENTS.map(s => {
            const n = dashboardCases.filter(s.match).length;
            return (
              <button key={s.key} role="tab" aria-selected={segment === s.key} disabled={n === 0}
                className={`${styles.segment} ${segment === s.key ? styles.segmentOn : ''}`}
                onClick={() => setSegment(s.key)}>
                {s.label} <span className={styles.segCount}>{n}</span>
              </button>
            );
          })}
        </div>
        <input className={styles.search} type="search" value={query}
          placeholder="Filter by patient or case ID"
          onChange={e => setQuery(e.target.value)} />
      </div>

      <div className={styles.caseList}>
        <div className={styles.listHead}>
          <span>Patient</span>
          <span>Progress</span>
          <span>Status</span>
          <span className={styles.colRight}>Received</span>
        </div>

        <div className={styles.listBody}>
          {isLoading ? (
            <div className={styles.skeletons}>
              <Skeleton height={52} /><Skeleton height={52} /><Skeleton height={52} />
            </div>
          ) : visibleCases.length === 0 ? (
            <div className={styles.emptyState}>
              {dashboardCases.length === 0
                ? <>No cases yet. <Link to="/new-case" className={styles.emptyLink}>Submit your first prescription</Link>.</>
                : 'Nothing matches this filter.'}
            </div>
          ) : visibleCases.map(c => {
            const stage = STAGE_OF[c.status] ?? 0;
            const action = actionFor(c);
            return (
              <div key={c.id} role="button" tabIndex={0}
                className={`${styles.caseRow} ${action ? styles.rowNeedsYou : ''} ${c.status === 'completed' ? styles.rowDone : ''}`}
                onClick={() => navigate(`/case/${c.id}`)}
                onKeyDown={e => { if (e.key === 'Enter') navigate(`/case/${c.id}`); }}>

                <div className={styles.cellPatient}>
                  <span className={styles.patientName} title={c.patient}>{c.patient}</span>
                  <span className={styles.caseMeta}>
                    <span title={c.id}>{shortCaseId(c.id)}</span>
                    <span className={styles.dot} />
                    <span className={styles.caseType}>{c.type}</span>
                  </span>
                </div>

                {/* The whole point: where the case has got to, readable
                    at a glance, with no sideways scrolling to find it. */}
                <div className={styles.track} aria-label={`${STAGES[stage]} — stage ${stage + 1} of ${STAGES.length}`}>
                  {STAGES.map((label, i) => (
                    <span key={label} title={label}
                      className={`${styles.step} ${i < stage ? styles.stepDone : ''} ${i === stage ? styles.stepNow : ''}`}>
                      <span className={styles.stepBar} />
                      <span className={styles.stepLabel}>{label}</span>
                    </span>
                  ))}
                </div>

                <div className={styles.cellStatus}>
                  {action
                    ? <span className={`${styles.actionChip} ${styles[action.tone]}`}>{action.label}</span>
                    : <span className={styles.labState}>{LAB_STATE[c.status] || c.status}</span>}
                </div>

                <div className={`${styles.cellDate} ${styles.colRight}`}>{c.received || '—'}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

export default Dashboard;
