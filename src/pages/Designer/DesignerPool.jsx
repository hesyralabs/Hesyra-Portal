import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Layers, Zap, Clock, ChevronRight, CheckCircle2, RefreshCw,
  AlertTriangle, Box, Cpu, Loader2, X, Sparkles
} from 'lucide-react';
import styles from './DesignerPool.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const CASE_TYPE_LABELS = {
  crown_bridge:    'Crown & Bridge',
  surgical_guide:  'Surgical Guide',
  splint:          'Splint / Nightguard',
  retainer:        'Retainer',
  aligner:         'Aligner',
  denture:         'Denture',
  model:           'Diagnostic Model',
};

const CASE_TYPE_COLORS = {
  crown_bridge:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  surgical_guide:  { color: '#c084fc', bg: 'rgba(192,132,252,0.12)' },
  splint:          { color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  retainer:        { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  aligner:         { color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  denture:         { color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  model:           { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)' },
};

// Countdown timer component — shows MM:SS for urgent cases, minutes for normal
function PoolTimer({ minutesLeft, isUrgent }) {
  const totalSeconds = minutesLeft * 60;
  const [secs, setSecs] = useState(totalSeconds);

  useEffect(() => {
    setSecs(minutesLeft * 60);
    const timer = setInterval(() => setSecs(s => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, [minutesLeft]);

  const mins = Math.floor(secs / 60);
  const ss   = secs % 60;
  const pct  = Math.max(0, Math.min(100, (secs / 3600) * 100)); // out of 1 hour
  const color = mins <= 10 ? '#ef4444' : mins <= 20 ? '#f59e0b' : '#34d399';
  // Show MM:SS when urgent, just Xm otherwise
  const display = (mins <= 15) ? `${mins}:${String(ss).padStart(2, '0')}` : `${mins}m`;

  return (
    <div className={styles.timerWrap}>
      <div className={styles.timerRing} style={{ '--pct': pct, '--color': color }}>
        <div className={styles.timerInner}>
          <Clock size={11} />
          <span>{display}</span>
        </div>
      </div>
      {isUrgent && (
        <span className={styles.urgentBadge}>
          <AlertTriangle size={10} /> Urgent
        </span>
      )}
    </div>
  );
}

const DesignerPool = () => {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [claimingId, setClaimingId] = useState(null);
  const [claimedIds, setClaimedIds] = useState(new Set()); // Optimistic claimed
  const [toast, setToast] = useState(null);
  const socketRef = useRef(null);

  const token = sessionStorage.getItem('hesyra_token');

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const fetchPool = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/pool/cases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCases(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Pool fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchPool();
  }, [fetchPool]);

  // Real-time Socket.io — listen for pool events and update instantly
  useEffect(() => {
    // Fallback poll every 60s in case socket is unavailable
    const pollInterval = setInterval(fetchPool, 60000);

    let socket = null;
    try {
      // Use the socket.io-client package (already a dependency)
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { io } = require('socket.io-client');
      socket = io(import.meta.env.VITE_API_URL || 'http://localhost:3001', {
        transports: ['websocket', 'polling'],
        autoConnect: true,
      });

      // Remove claimed cases instantly — no re-fetch needed
      socket.on('pool:case_claimed', ({ customId }) => {
        setCases(prev => prev.filter(c => c.id !== customId));
      });
      // Remove auto-assigned cases instantly
      socket.on('pool:auto_assigned', ({ customId }) => {
        setCases(prev => prev.filter(c => c.id !== customId));
      });
      // Case returned to pool — add it by re-fetching
      socket.on('pool:case_returned', () => fetchPool());
      // New case submitted — add it
      socket.on('pool:new_case', () => fetchPool());
    } catch (_) {
      // socket.io-client not resolvable in this context, polling fallback is active
    }

    return () => {
      clearInterval(pollInterval);
      if (socket) socket.disconnect();
    };
  // fetchPool is stable (useCallback), so this effect runs once
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClaim = async (caseId) => {
    setClaimingId(caseId);
    // Optimistic UI — remove from list immediately
    setClaimedIds(prev => new Set([...prev, caseId]));

    try {
      const res = await fetch(`${API}/api/pool/cases/${caseId}/claim`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();

      if (!res.ok) {
        // Rollback optimistic update
        setClaimedIds(prev => { const s = new Set(prev); s.delete(caseId); return s; });
        showToast(data.error || 'Could not claim case', 'error');
      } else {
        showToast(`✅ Case ${caseId} claimed! Opening workspace…`, 'success');
        setTimeout(() => navigate(`/designer/case/${caseId}`), 1200);
      }
    } catch (err) {
      setClaimedIds(prev => { const s = new Set(prev); s.delete(caseId); return s; });
      showToast('Network error. Please try again.', 'error');
    } finally {
      setClaimingId(null);
    }
  };

  const visibleCases = cases.filter(c => !claimedIds.has(c.id));
  const filtered = visibleCases.filter(c =>
    filter === 'all' || c.caseType === filter
  );

  const urgentCount = visibleCases.filter(c => c.isUrgent).length;
  const priorityCount = visibleCases.filter(c => c.priorityFlag).length;
  const caseTypes = [...new Set(visibleCases.map(c => c.caseType))];

  return (
    <div className={styles.page}>
      {/* Toast */}
      {toast && (
        <div className={`${styles.toast} ${styles[`toast_${toast.type}`]}`}>
          {toast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)}><X size={14} /></button>
        </div>
      )}

      {/* Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.headerIcon}>
            <Sparkles size={20} />
          </div>
          <div>
            <h1 className={styles.title}>Open Case Pool</h1>
            <p className={styles.subtitle}>
              Browse and claim cases that match your expertise · unclaimed cases auto-assign after 1 hour
            </p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <Link to="/designer" className={styles.queueLink}>
            <Layers size={15} />
            My Queue
          </Link>
          <button className={styles.refreshBtn} onClick={fetchPool} title="Refresh">
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {/* Stats strip */}
      <div className={styles.statsStrip}>
        <div className={styles.stat}>
          <span className={styles.statVal}>{visibleCases.length}</span>
          <span className={styles.statKey}>Available</span>
        </div>
        <div className={styles.statDivider} />
        <div className={`${styles.stat} ${urgentCount > 0 ? styles.statWarn : ''}`}>
          <span className={styles.statVal}>{urgentCount}</span>
          <span className={styles.statKey}>Urgent (&lt;15m left)</span>
        </div>
        <div className={styles.statDivider} />
        <div className={`${styles.stat} ${priorityCount > 0 ? styles.statHot : ''}`}>
          <span className={styles.statVal}>{priorityCount}</span>
          <span className={styles.statKey}>Priority</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.stat}>
          <span className={styles.statVal}>{caseTypes.length}</span>
          <span className={styles.statKey}>Case Types</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className={styles.filters}>
        <button
          className={`${styles.filterTab} ${filter === 'all' ? styles.filterActive : ''}`}
          onClick={() => setFilter('all')}
        >
          All Types
        </button>
        {caseTypes.map(type => (
          <button
            key={type}
            className={`${styles.filterTab} ${filter === type ? styles.filterActive : ''}`}
            onClick={() => setFilter(type)}
          >
            {CASE_TYPE_LABELS[type] || type}
          </button>
        ))}
      </div>

      {/* Case grid */}
      <div className={styles.grid}>
        {loading ? (
          Array(6).fill(0).map((_, i) => (
            <div key={i} className={styles.skeleton} />
          ))
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <Box size={52} className={styles.emptyIcon} />
            <h3>Pool is clear</h3>
            <p>No unclaimed cases right now. New cases appear here as clinics submit them.</p>
            <button className={styles.refreshBig} onClick={fetchPool}>
              <RefreshCw size={15} /> Refresh Pool
            </button>
          </div>
        ) : (
          filtered.map(c => {
            const typeColor = CASE_TYPE_COLORS[c.caseType] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
            const isClaiming = claimingId === c.id;
            const minutesLeft = c.minutesLeft ?? 60;

            return (
              <div
                key={c.id}
                className={`${styles.card} ${c.priorityFlag ? styles.cardPriority : ''} ${c.isUrgent ? styles.cardUrgent : ''}`}
              >
                {/* Priority badge */}
                {c.priorityFlag && (
                  <div className={styles.priorityRibbon}>
                    <Zap size={10} /> Priority
                  </div>
                )}

                {/* Card head */}
                <div className={styles.cardHead}>
                  <div>
                    <span
                      className={styles.typeBadge}
                      style={{ color: typeColor.color, background: typeColor.bg }}
                    >
                      {CASE_TYPE_LABELS[c.caseType] || c.caseType}
                    </span>
                    <span className={styles.caseId}>{c.id}</span>
                  </div>
                  <PoolTimer minutesLeft={minutesLeft} isUrgent={c.isUrgent} />
                </div>

                {/* Case details */}
                <div className={styles.details}>
                  {c.toothNumbers?.length > 0 && (
                    <div className={styles.detail}>
                      <span className={styles.detailKey}>Teeth</span>
                      <span className={styles.detailVal}>
                        {c.toothNumbers.slice(0, 6).join(', ')}
                        {c.toothNumbers.length > 6 && ` +${c.toothNumbers.length - 6}`}
                      </span>
                    </div>
                  )}
                  {c.shade && c.shade !== 'N/A' && (
                    <div className={styles.detail}>
                      <span className={styles.detailKey}>Shade</span>
                      <span className={styles.detailVal}>{c.shade}</span>
                    </div>
                  )}
                  {c.archTarget && (
                    <div className={styles.detail}>
                      <span className={styles.detailKey}>Arch</span>
                      <span className={styles.detailVal}>{c.archTarget}</span>
                    </div>
                  )}
                  {c.implantSystem && (
                    <div className={styles.detail}>
                      <span className={styles.detailKey}>Implant</span>
                      <span className={styles.detailVal}>{c.implantSystem}</span>
                    </div>
                  )}
                  {c.due && c.due !== 'TBD' && (
                    <div className={styles.detail}>
                      <span className={styles.detailKey}>Due</span>
                      <span
                        className={styles.detailVal}
                        style={{ color: c.due === 'Express' ? '#f59e0b' : 'inherit' }}
                      >
                        {c.due}
                      </span>
                    </div>
                  )}
                </div>

                {/* Instructions preview */}
                {c.instructions && (
                  <p className={styles.instructions}>
                    {c.instructions.length > 120
                      ? c.instructions.slice(0, 120) + '…'
                      : c.instructions}
                  </p>
                )}

                {/* File info */}
                <div className={styles.fileInfo}>
                  <Cpu size={12} />
                  <span>
                    {c.scanFileCount} scan file{c.scanFileCount !== 1 ? 's' : ''} ready
                  </span>
                </div>

                {/* Claim button */}
                <button
                  className={styles.claimBtn}
                  onClick={() => handleClaim(c.id)}
                  disabled={isClaiming}
                >
                  {isClaiming ? (
                    <>
                      <Loader2 size={15} className={styles.spinner} /> Claiming…
                    </>
                  ) : (
                    <>
                      Claim This Case <ChevronRight size={15} />
                    </>
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DesignerPool;
