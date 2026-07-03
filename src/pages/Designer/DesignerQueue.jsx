import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Layers, Star, AlertOctagon, ChevronRight, Zap, Clock, User } from 'lucide-react';
import styles from './DesignerQueue.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const STATUS_CONFIG = {
  cad_assigned:    { label: 'Assigned — Awaiting Work',  color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  design_ready:    { label: 'Uploaded — In Review',      color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  design_revision: { label: 'Revision Requested',        color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  blocked:         { label: 'Blocked',                    color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  designing:       { label: 'In Progress',               color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
};

const DesignerQueue = () => {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [poolCount, setPoolCount] = useState(0);

  const token = sessionStorage.getItem('hesyra_token');

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/designer/cases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCases(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Poll pool count for the banner badge
  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch(`${API}/api/pool/cases`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setPoolCount(Array.isArray(data) ? data.length : 0);
      } catch { /* silent */ }
    };
    fetchCount();
    const id = setInterval(fetchCount, 30000);
    return () => clearInterval(id);
  }, [token]);

  const filtered = cases.filter(c => filter === 'all' || c.status === filter);

  const stats = {
    total:    cases.length,
    priority: cases.filter(c => c.priorityFlag).length,
    revision: cases.filter(c => c.status === 'design_revision').length,
    blocked:  cases.filter(c => c.status === 'blocked').length,
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Design Queue</h1>
          <p className={styles.subtitle}>Your assigned cases — all other cases are not visible to you</p>
        </div>
        {/* Fix #10: Pool link with live badge */}
        <Link to="/designer/pool" className={styles.poolBannerLink}>
          <Layers size={15} />
          Browse Open Pool
          {poolCount > 0 && (
            <span className={styles.poolBadge}>{poolCount} new</span>
          )}
        </Link>
      </header>

      {/* Stats strip */}
      <div className={styles.statsStrip}>
        <div className={styles.statItem}>
          <span className={styles.statVal}>{stats.total}</span>
          <span className={styles.statKey}>Assigned</span>
        </div>
        <div className={styles.statDivider} />
        <div className={`${styles.statItem} ${stats.priority > 0 ? styles.statWarn : ''}`}>
          <span className={styles.statVal}>{stats.priority}</span>
          <span className={styles.statKey}>Priority</span>
        </div>
        <div className={styles.statDivider} />
        <div className={`${styles.statItem} ${stats.revision > 0 ? styles.statAlert : ''}`}>
          <span className={styles.statVal}>{stats.revision}</span>
          <span className={styles.statKey}>Revisions</span>
        </div>
        <div className={styles.statDivider} />
        <div className={`${styles.statItem} ${stats.blocked > 0 ? styles.statDanger : ''}`}>
          <span className={styles.statVal}>{stats.blocked}</span>
          <span className={styles.statKey}>Blocked</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className={styles.filters}>
        {['all', 'cad_assigned', 'design_revision', 'design_ready', 'blocked'].map(f => (
          <button
            key={f}
            className={`${styles.filterTab} ${filter === f ? styles.filterActive : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : STATUS_CONFIG[f]?.label || f}
          </button>
        ))}
      </div>

      {/* Case cards — always use customId, never c.id */}
      <div className={styles.caseGrid}>
        {loading ? (
          Array(4).fill(0).map((_, i) => <div key={i} className={styles.skeleton} />)
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <Layers size={48} />
            <h3>Queue clear</h3>
            <p>No cases match this filter. Check back later.</p>
          </div>
        ) : (
          filtered.map(c => {
            const cfg = STATUS_CONFIG[c.status] || { label: c.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
            const isRevision = c.status === 'design_revision';
            const isBlocked  = c.status === 'blocked';

            return (
              <Link
                key={c.customId}
                to={`/designer/case/${c.customId}`}
                className={`${styles.caseCard} ${isRevision ? styles.cardRevision : ''} ${isBlocked ? styles.cardBlocked : ''}`}
              >
                {c.priorityFlag && (
                  <div className={styles.priorityBanner}>
                    <Star size={12} /> Priority
                  </div>
                )}

                <div className={styles.cardHead}>
                  <span className={styles.caseId}>{c.customId}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {/* Fix #10: Assignment method badge */}
                    {c.assignmentMethod === 'self_select' && (
                      <span title="You claimed this from the pool" style={{ fontSize: '0.65rem', color: '#34d399' }}>
                        <Zap size={10} style={{ display: 'inline', marginRight: 2 }} />Self
                      </span>
                    )}
                    {c.assignmentMethod === 'auto_assign' && (
                      <span title="Auto-assigned by algorithm" style={{ fontSize: '0.65rem', color: '#f59e0b' }}>
                        <Clock size={10} style={{ display: 'inline', marginRight: 2 }} />Auto
                      </span>
                    )}
                    {c.assignmentMethod === 'manager_assign' && (
                      <span title="Assigned by manager" style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                        <User size={10} style={{ display: 'inline', marginRight: 2 }} />Manager
                      </span>
                    )}
                    <span className={styles.statusPill} style={{ color: cfg.color, background: cfg.bg }}>
                      {cfg.label}
                    </span>
                  </div>
                </div>

                <div className={styles.cardType}>
                  {c.caseType?.replace(/_/g, ' ') || 'Unknown Type'}
                </div>

                <div className={styles.cardDetails}>
                  <div className={styles.detail}>
                    <span className={styles.detailLabel}>Shade</span>
                    <span className={styles.detailVal}>{c.shade || '—'}</span>
                  </div>
                  <div className={styles.detail}>
                    <span className={styles.detailLabel}>Teeth</span>
                    <span className={styles.detailVal}>
                      {Array.isArray(c.toothNumbers)
                        ? c.toothNumbers.join(', ')
                        : (c.toothNumbers ? JSON.parse(c.toothNumbers).join(', ') : '—')}
                    </span>
                  </div>
                  <div className={styles.detail}>
                    <span className={styles.detailLabel}>Due</span>
                    <span className={styles.detailVal}>{c.due || 'TBD'}</span>
                  </div>
                </div>

                {isRevision && (
                  <div className={styles.revisionNote}>
                    <AlertOctagon size={11} /> Revision requested — open case for details
                  </div>
                )}

                <div className={styles.cardFooter}>
                  <span className={styles.filesCount}>
                    {(() => {
                      const scans   = (c.files || []).filter(f => f.category === 'scan').length;
                      const designs = (c.files || []).filter(f => f.category === 'design').length;
                      return (
                        <>
                          <span title="Dentist's scan files you work from">
                            📥 {scans} scan{scans !== 1 ? 's' : ''}
                          </span>
                          {' · '}
                          <span title="Your uploaded design files" style={{ color: designs > 0 ? '#a78bfa' : 'inherit' }}>
                            📤 {designs} design{designs !== 1 ? 's' : ''}
                          </span>
                        </>
                      );
                    })()}
                  </span>
                  <ChevronRight size={16} className={styles.cardArrow} />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
};

export default DesignerQueue;
