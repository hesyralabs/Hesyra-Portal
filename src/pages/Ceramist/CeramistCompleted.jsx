import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle, Search, RefreshCw, Star, Truck } from 'lucide-react';
import Skeleton from '../../components/UI/Skeleton';
import styles from './CeramistDashboard.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const RANGES = [
  { days: 7,  label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

// Where the case got to after it left this bench.
const AFTER = {
  qa:                 { label: 'In QC',           tone: '#fbbf24' },
  ready_for_dispatch: { label: 'Ready to pack',   tone: '#60a5fa' },
  payment_pending:    { label: 'Awaiting payment',tone: '#60a5fa' },
  overdue:            { label: 'Payment overdue', tone: '#f87171' },
  packaged:           { label: 'Packed',          tone: '#60a5fa' },
  dispatched:         { label: 'Dispatched',      tone: '#34d399' },
  shipped:            { label: 'Dispatched',      tone: '#34d399' },
  completed:          { label: 'Delivered',       tone: '#34d399' },
  design_revision:    { label: 'Back for rework', tone: '#f87171' },
  action_required:    { label: 'Back for rework', tone: '#f87171' },
};

const CeramistCompleted = () => {
  const [cases, setCases]   = useState([]);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState('');
  const [days, setDays]     = useState(30);
  const [search, setSearch] = useState('');

  const token = sessionStorage.getItem('hesyra_token');

  const fetchDone = useCallback(async () => {
    setLoad(true);
    setError('');
    try {
      const res = await fetch(`${API}/api/batch/ceramist/completed?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Could not load your completed work.'); return; }
      setCases(Array.isArray(data) ? data : []);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoad(false);
    }
  }, [token, days]);

  useEffect(() => { fetchDone(); }, [fetchDone]);

  const q = search.trim().toLowerCase();
  const filtered = cases.filter(c => !q ||
    c.id?.toLowerCase().includes(q) ||
    c.patient?.toLowerCase().includes(q) ||
    c.shade?.toLowerCase().includes(q) ||
    c.material?.toLowerCase().includes(q));

  const signature = filtered.filter(c => c.finishingTier === 'premium').length;
  const reworked  = filtered.filter(c => ['design_revision', 'action_required'].includes(c.status)).length;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <CheckCircle size={22} style={{ color: '#34d399' }} />
            Completed
          </h1>
          <p className={styles.subtitle}>
            {filtered.length} case{filtered.length !== 1 ? 's' : ''} released from your bench
            {signature > 0 && <> · {signature} Signature Match</>}
            {reworked > 0 && <> · <span style={{ color: '#f87171' }}>{reworked} came back</span></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', gap: 3, padding: 3, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--glass-border)', borderRadius: 9 }}>
            {RANGES.map(r => (
              <button key={r.days} onClick={() => setDays(r.days)}
                style={{
                  padding: '0.3rem 0.65rem', fontSize: 12, fontWeight: 600, borderRadius: 7,
                  border: 0, cursor: 'pointer',
                  background: days === r.days ? 'var(--text-primary)' : 'transparent',
                  color: days === r.days ? 'var(--bg-base)' : 'var(--text-secondary)',
                }}>
                {r.label}
              </button>
            ))}
          </div>
          <div className={styles.searchBox}>
            <Search size={14} />
            <input placeholder="Case, patient, shade…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className={styles.btnOutline} onClick={fetchDone} title="Refresh" style={{ padding: '0.45rem 0.6rem' }}>
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      {error && (
        <div style={{ padding: '0.7rem 0.9rem', borderRadius: 10, marginBottom: '0.75rem', fontSize: '0.8rem',
                      background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.28)', color: '#fca5a5' }}>
          {error}
        </div>
      )}

      <div className={styles.queue}>
        {loading ? (
          Array(3).fill(0).map((_, i) => <Skeleton key={i} height="72px" borderRadius="14px" style={{ marginBottom: '0.6rem' }} />)
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <CheckCircle size={48} />
            <h3>Nothing here yet</h3>
            <p>Cases you finish will be listed here for {days} days.</p>
          </div>
        ) : (
          filtered.map(c => {
            const after = AFTER[c.status] || { label: c.status, tone: 'var(--text-tertiary)' };
            return (
              <div key={c.id} className={styles.card} style={{ paddingBottom: '0.9rem' }}>
                <div className={styles.cardHeader}>
                  <div className={styles.caseId}>
                    {c.priorityFlag && <Star size={12} className={styles.starIcon} />}
                    {c.id}
                  </div>
                  <span style={{
                    fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                    padding: '3px 9px', borderRadius: 999, color: after.tone,
                    background: 'rgba(255,255,255,0.04)', border: `1px solid ${after.tone}44`,
                  }}>
                    {c.status === 'dispatched' || c.status === 'completed' ? <Truck size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} /> : null}
                    {after.label}
                  </span>
                </div>

                <div className={styles.rxRow}>
                  <div className={styles.rxChip}>
                    <span className={styles.rxLabel}>Patient</span>
                    <span className={styles.rxValue}>{c.patient || '—'}</span>
                  </div>
                  <div className={styles.rxChip}>
                    <span className={styles.rxLabel}>Material</span>
                    <span className={styles.rxValue}>{c.material || '—'}</span>
                  </div>
                  <div className={styles.rxChip}>
                    <span className={styles.rxLabel}>Shade</span>
                    <span className={styles.rxValue}>{c.shade || '—'}</span>
                  </div>
                  <div className={styles.rxChip}>
                    <span className={styles.rxLabel}>Finished</span>
                    <span className={styles.rxValue}>
                      {c.finishedAt
                        ? new Date(c.finishedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CeramistCompleted;
