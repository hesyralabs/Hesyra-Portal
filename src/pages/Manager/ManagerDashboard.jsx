import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Users, AlertCircle, Clock, Package,
  TrendingUp, Zap, CheckCircle, Search, ChevronRight,
  TriangleAlert, Star, Layers, CreditCard, FileText,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import styles from './ManagerDashboard.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const STATUS_CONFIG = {
  submitted:          { label: 'New',              color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  cad_assigned:       { label: 'CAD Assigned',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  design_ready:       { label: 'Design Ready',     color: '#c4b5fd', bg: 'rgba(196,181,253,0.12)' },
  awaiting_doctor_approval: { label: 'With Doctor', color: '#f0abfc', bg: 'rgba(240,171,252,0.12)' },
  design_approved:    { label: 'Approved',          color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  post_processing:    { label: 'Post-Processing',  color: '#fcd34d', bg: 'rgba(252,211,77,0.12)' },
  qa:                 { label: 'QA',               color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  ready_for_dispatch: { label: 'Ready Dispatch',   color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  payment_pending:    { label: 'Awaiting Payment', color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  packaged:           { label: 'Packaged',         color: '#38bdf8', bg: 'rgba(56,189,248,0.12)' },
  dispatched:         { label: 'Dispatched',       color: '#10b981', bg: 'rgba(16,185,129,0.12)' },
  overdue:            { label: 'Overdue',           color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  blocked:            { label: 'Blocked',           color: '#dc2626', bg: 'rgba(220,38,38,0.15)' },
  action_required:    { label: 'Action Required',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
};

// Same five milestones the clinic dashboard and case detail draw, so
// every view in the portal describes progress identically.
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

// Whose desk the case is sitting on. A manager's whole job is moving
// work along, and "who is holding this" is the question the old page
// could not answer at all.
const HOLDER = {
  submitted:                { who: 'Lab — assign a designer', tone: 'act' },
  action_required:          { who: 'Clinic — info needed',    tone: 'wait' },
  cad_assigned:             { who: 'Designer',                tone: 'wait' },
  designing:                { who: 'Designer',                tone: 'wait' },
  design_revision:          { who: 'Designer — rework',       tone: 'warn' },
  design_ready:             { who: 'You — review design',     tone: 'act' },
  awaiting_doctor_approval: { who: 'Doctor',                  tone: 'wait' },
  pending_approval:         { who: 'Doctor',                  tone: 'wait' },
  blocked:                  { who: 'You — blocked',           tone: 'warn' },
  design_approved:          { who: 'Production',              tone: 'wait' },
  batched:                  { who: 'Technician',              tone: 'wait' },
  printing:                 { who: 'Technician',              tone: 'wait' },
  printed:                  { who: 'Awaiting ceramist',       tone: 'warn' },
  finishing:                { who: 'Ceramist',                tone: 'wait' },
  post_processing:          { who: 'Technician',              tone: 'wait' },
  qa:                       { who: 'QC',                      tone: 'wait' },
  ready_for_dispatch:       { who: 'Dispatch — pack it',      tone: 'act' },
  payment_pending:          { who: 'Clinic — payment',        tone: 'warn' },
  overdue:                  { who: 'Clinic — overdue',        tone: 'warn' },
  packaged:                 { who: 'Dispatch — send it',      tone: 'act' },
  dispatched:               { who: 'In transit',              tone: 'done' },
  completed:                { who: 'Delivered',               tone: 'done' },
};

const ManagerDashboard = () => {
  const { user } = useAuth();
  const [cases, setCases] = useState([]);
  const [search, setSearch] = useState('');
  // Pipeline drill-down (a single status) and the segment strip. Both
  // feed the same queue; previously they fed a list that was computed
  // and then never rendered, so clicking either did nothing at all.
  const [statusFilter, setStatusFilter] = useState(null);
  const [segment, setSegment] = useState('all');
  const [loading, setLoading] = useState(true);
  const [poolStats, setPoolStats] = useState({ totalInPool: 0, urgentCount: 0, overdueCount: 0 });
  const [creditClinics, setCreditClinics] = useState([]);   // net_30 clinics
  const [totalOutstandingPaise, setTotalOutstandingPaise] = useState(0);
  const [generating, setGenerating] = useState(false);      // invoice generation in-flight

  const fetchCases = useCallback(async () => {
    try {
      const token = sessionStorage.getItem('hesyra_token');
      const [casesRes, poolRes, clinicsRes] = await Promise.all([
        fetch(`${API}/api/cases`,       { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/pool/stats`,  { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/manager/clinics`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const data    = await casesRes.json();
      const pool    = await poolRes.json();
      const clinics = await clinicsRes.json();

      setCases(Array.isArray(data) ? data : []);
      setPoolStats(pool || { totalInPool: 0, urgentCount: 0, overdueCount: 0 });

      // Aggregate credit outstanding across all net_30 clinics
      const net30 = Array.isArray(clinics) ? clinics.filter(c => c.billingMode === 'net_30') : [];
      setCreditClinics(net30);
      setTotalOutstandingPaise(net30.reduce((sum, c) => sum + (c.outstandingPaise || 0), 0));
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  // Fix #15: Request browser notification permission for pool alerts
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Alert manager via browser notification when pool is overdue
  useEffect(() => {
    if (poolStats.overdueCount > 0 && Notification.permission === 'granted') {
      new Notification('Hesyra — Pool Alert', {
        body: `${poolStats.overdueCount} case(s) are overdue in the open pool and need manual assignment.`,
        icon: '/favicon.ico',
      });
    }
  }, [poolStats.overdueCount]);

  const activeCases = cases.filter(c => !['archived', 'cancelled'].includes(c.status));
  const urgentCases = activeCases.filter(c => c.priorityFlag || ['overdue', 'blocked', 'payment_pending'].includes(c.status));

  const statusCounts = {};
  activeCases.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
  });


  // ─── Age & SLA ───────────────────────────────────────────────
  const hoursSince = (d) => d ? Math.floor((Date.now() - new Date(d)) / 3600000) : null;
  const ageLabel = (h) => h === null ? '—' : h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;

  // A doctor approval that has blown its deadline is the single most
  // common cause of a missed turnaround, so it is surfaced by name.
  const approvalOverdue = activeCases.filter(c =>
    ['awaiting_doctor_approval', 'pending_approval'].includes(c.status) &&
    c.doctorApprovalDueAt && new Date(c.doctorApprovalDueAt) < new Date());

  // Work that is genuinely waiting on the lab, not on someone else.
  const needsManager = activeCases.filter(c =>
    ['design_ready', 'blocked', 'submitted', 'printed'].includes(c.status));

  // ─── Segments ────────────────────────────────────────────────
  // These filter the queue below rather than just counting. Every one
  // of them used to be a number with nothing behind it.
  const SEGMENTS = [
    { key: 'all',        label: 'All active',   match: () => true },
    { key: 'needs',      label: 'Needs the lab', match: c => ['design_ready', 'blocked', 'submitted', 'printed'].includes(c.status) },
    { key: 'doctor',     label: 'With doctor',   match: c => ['awaiting_doctor_approval', 'pending_approval'].includes(c.status) },
    { key: 'production', label: 'In production', match: c => ['design_approved', 'batched', 'printing', 'printed', 'finishing', 'post_processing', 'qa'].includes(c.status) },
    { key: 'dispatch',   label: 'Ready to ship', match: c => ['ready_for_dispatch', 'packaged'].includes(c.status) },
    { key: 'money',      label: 'Payment',       match: c => ['payment_pending', 'overdue'].includes(c.status) },
  ];

  const seg = SEGMENTS.find(s => s.key === segment) || SEGMENTS[0];
  const q = search.trim().toLowerCase();

  const queue = activeCases
    .filter(c => (statusFilter ? c.status === statusFilter : seg.match(c)))
    .filter(c => !q
      || c.id?.toLowerCase().includes(q)
      || c.patient?.toLowerCase().includes(q)
      || c.clinic?.toLowerCase().includes(q)
      || c.doctor?.toLowerCase().includes(q)
      || c.caseType?.toLowerCase().includes(q))
    // Priority first, then oldest — the order a manager works in.
    .sort((a, b) =>
      (b.priorityFlag ? 1 : 0) - (a.priorityFlag ? 1 : 0) ||
      new Date(a.createdAt) - new Date(b.createdAt));

  // Generate monthly invoices manually
  const handleGenerateInvoices = async () => {
    setGenerating(true);
    try {
      const token = sessionStorage.getItem('hesyra_token');
      const res = await fetch(`${API}/api/manager/invoices/generate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`✅ Generated ${data.invoicesGenerated} invoice(s) for ${data.billingPeriod}.`);
        fetchCases();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch {
      alert('Network error generating invoices.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Operations Overview</h1>
          <p className={styles.subtitle}>
            Good {new Date().getHours() < 12 ? 'morning' : 'afternoon'},{' '}
            <strong>{user?.name}</strong> · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {creditClinics.length > 0 && (
            <button
              className={styles.ctaBtn}
              onClick={handleGenerateInvoices}
              disabled={generating}
              style={{ background: generating ? 'rgba(192,132,252,0.15)' : 'rgba(192,132,252,0.18)', color: '#c084fc', border: '1px solid rgba(192,132,252,0.3)' }}
              title="Generate monthly invoices for all Net-30 clinics"
            >
              <FileText size={15} />
              {generating ? 'Generating…' : 'Generate Invoices'}
            </button>
          )}
          <Link to="/manager/cases" className={styles.ctaBtn}>
            View All Cases <ChevronRight size={16} />
          </Link>
        </div>
      </header>

      {/* ─── What needs the lab, right now ───────────────────────
          Shown only when there is something in it. Five tiles reading
          zero taught an operator to ignore the whole row. */}
      {!loading && (approvalOverdue.length > 0 || poolStats.overdueCount > 0 || urgentCases.length > 0 || needsManager.length > 0) && (
        <section className={styles.attentionBand}>
          <TriangleAlert size={15} className={styles.attentionIcon} />
          <div className={styles.attentionItems}>
            {needsManager.length > 0 && (
              <button className={`${styles.attentionChip} ${styles.act}`}
                onClick={() => { setStatusFilter(null); setSegment('needs'); }}>
                {needsManager.length} waiting on the lab
              </button>
            )}
            {approvalOverdue.length > 0 && (
              <button className={`${styles.attentionChip} ${styles.warn}`}
                onClick={() => { setStatusFilter(null); setSegment('doctor'); }}>
                {approvalOverdue.length} approval{approvalOverdue.length > 1 ? 's' : ''} past deadline
              </button>
            )}
            {urgentCases.length > 0 && (
              <button className={`${styles.attentionChip} ${styles.warn}`}
                onClick={() => { setStatusFilter(null); setSegment('all'); setSearch(''); }}>
                {urgentCases.length} urgent or blocked
              </button>
            )}
            {poolStats.overdueCount > 0 && (
              <Link to="/manager/workload" className={`${styles.attentionChip} ${styles.warn}`}>
                {poolStats.overdueCount} unclaimed past timeout
              </Link>
            )}
            {totalOutstandingPaise > 0 && (
              <Link to="/manager/clinics" className={`${styles.attentionChip} ${styles.info}`}>
                ₹{(totalOutstandingPaise / 100).toLocaleString('en-IN')} outstanding · {creditClinics.length} on Net-30
              </Link>
            )}
          </div>
        </section>
      )}

      {/* ─── Segments + search ─── */}
      <div className={styles.toolbar}>
        <div className={styles.segments} role="tablist">
          {SEGMENTS.map(s => {
            const n = activeCases.filter(s.match).length;
            const on = !statusFilter && segment === s.key;
            return (
              <button key={s.key} role="tab" aria-selected={on}
                disabled={n === 0 && s.key !== 'all'}
                className={`${styles.segment} ${on ? styles.segmentOn : ''}`}
                onClick={() => { setStatusFilter(null); setSegment(s.key); }}>
                {s.label} <span className={styles.segCount}>{n}</span>
              </button>
            );
          })}
        </div>
        <input className={styles.search} type="search" value={search}
          placeholder="Case, patient, clinic or doctor"
          onChange={e => setSearch(e.target.value)} />
      </div>

      {/* ─── Fix #13: Pool queue drill-down ─── */}
      {poolStats.cases && poolStats.cases.length > 0 && (
        <section className={styles.poolSection}>
          <div className={styles.sectionHeader}>
            <Layers size={16} className={styles.poolIcon} />
            <span>Open Pool Queue ({poolStats.totalInPool})</span>
            <Link to="/manager/cases" className={styles.sectionLink}>View All Cases →</Link>
          </div>
          <div className={styles.poolList}>
            {poolStats.cases
              .sort((a, b) => b.minutesInPool - a.minutesInPool) // Most stale first
              .map(c => {
                const pct = Math.min(100, (c.minutesInPool / 60) * 100);
                const isOverdue  = c.minutesInPool >= 60;
                const isUrgent   = c.minutesInPool >= 45 && !isOverdue;
                const barColor   = isOverdue ? '#ef4444' : isUrgent ? '#f59e0b' : '#34d399';

                return (
                  <div key={c.id} className={styles.poolRow}>
                    <div className={styles.poolRowLeft}>
                      {c.priorityFlag && <span className={styles.poolPriority}>⚡</span>}
                      <span className={styles.poolCaseId}>{c.id}</span>
                      <span className={styles.poolCaseType}>{c.caseType?.replace(/_/g, ' ')}</span>
                      {isOverdue && <span className={styles.poolOverdueBadge}>⚠️ Overdue</span>}
                      {isUrgent  && <span className={styles.poolUrgentBadge}>⏱ Urgent</span>}
                    </div>
                    <div className={styles.poolRowRight}>
                      <div className={styles.poolTimeBar}>
                        <div
                          className={styles.poolTimeFill}
                          style={{ width: `${pct}%`, background: barColor }}
                        />
                        <span className={styles.poolTimeLabel}>{c.minutesInPool}m</span>
                      </div>
                      <Link
                        to={`/manager/case/${c.id}`}
                        className={styles.poolAssignBtn}
                      >
                        Assign
                      </Link>
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      )}

      {/* ─── The work queue ──────────────────────────────────────
          The page had none: it counted cases and then made you leave to
          see any of them. This is what the segments and the pipeline
          tiles have always been filtering. */}
      <section className={styles.queueCard}>
        <div className={styles.queueHead}>
          <span>Case</span>
          <span>Clinic</span>
          <span>Progress</span>
          <span>Waiting on</span>
          <span className={styles.colRight}>Age</span>
        </div>

        <div className={styles.queueBody}>
          {loading ? (
            <div className={styles.queueEmpty}>Loading cases…</div>
          ) : queue.length === 0 ? (
            <div className={styles.queueEmpty}>
              {/* Name every filter that is actually narrowing the list,
                  so an empty table is never a mystery. */}
              {search && statusFilter
                ? <>No case at <strong>{STATUS_CONFIG[statusFilter]?.label || statusFilter}</strong> matches “{search}”.</>
                : search
                  ? <>Nothing matches “{search}” in <strong>{seg.label}</strong>.</>
                  : statusFilter
                    ? <>Nothing at <strong>{STATUS_CONFIG[statusFilter]?.label || statusFilter}</strong>.</>
                    : <>Nothing in <strong>{seg.label}</strong>.</>}
            </div>
          ) : queue.map(c => {
            const stage = STAGE_OF[c.status] ?? 0;
            const hold = HOLDER[c.status] || { who: c.status, tone: 'wait' };
            const h = hoursSince(c.createdAt);
            const late = ['awaiting_doctor_approval', 'pending_approval'].includes(c.status)
              && c.doctorApprovalDueAt && new Date(c.doctorApprovalDueAt) < new Date();

            return (
              <Link key={c.id} to={`/manager/case/${c.id}`} className={styles.queueRow}>
                <div className={styles.cellCase}>
                  <span className={styles.caseIdRow}>
                    {c.priorityFlag && <Star size={11} className={styles.priorityStar} />}
                    {c.id}
                  </span>
                  <span className={styles.caseSub}>
                    {c.patient} · {c.caseType?.replace(/_/g, ' ')}
                  </span>
                </div>

                <div className={styles.cellClinic}>
                  <span className={styles.clinicName}>{c.clinic || '—'}</span>
                  <span className={styles.caseSub}>{c.doctor}</span>
                </div>

                <div className={styles.track} aria-label={`${STAGES[stage]} — stage ${stage + 1} of ${STAGES.length}`}>
                  {STAGES.map((label, i) => (
                    <span key={label} title={label}
                      className={`${styles.step} ${i < stage ? styles.stepDone : ''} ${i === stage ? styles.stepNow : ''}`}>
                      <span className={styles.stepBar} />
                    </span>
                  ))}
                  <span className={styles.stageName}>{STAGES[stage]}</span>
                </div>

                <div className={styles.cellHolder}>
                  <span className={`${styles.holder} ${styles[hold.tone]}`}>{hold.who}</span>
                  {late && <span className={styles.lateFlag}>overdue</span>}
                </div>

                <div className={`${styles.cellAge} ${styles.colRight}`}>{ageLabel(h)}</div>
              </Link>
            );
          })}
        </div>

        {/* Drill-down by exact status, folded under the queue instead of
            occupying a section of its own. */}
        <div className={styles.pipelineStrip}>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const count = statusCounts[key] || 0;
            if (count === 0) return null;
            return (
              <button key={key}
                className={`${styles.pipeChip} ${statusFilter === key ? styles.pipeChipOn : ''}`}
                style={{ '--tile-color': cfg.color }}
                onClick={() => setStatusFilter(statusFilter === key ? null : key)}>
                <span className={styles.pipeCount}>{count}</span> {cfg.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default ManagerDashboard;
