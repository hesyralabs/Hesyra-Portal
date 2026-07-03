import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Paintbrush, Star, Clock, CheckCircle, Package, Search } from 'lucide-react';
import Skeleton from '../../components/UI/Skeleton';
import { useAuth } from '../../context/AuthContext';
import styles from './CeramistDashboard.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const CeramistDashboard = () => {
  const { user } = useAuth();
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const token = sessionStorage.getItem('hesyra_token');

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/batch/ceramist/queue`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      setCases(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to fetch queue:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  const filtered = cases.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.id?.toLowerCase().includes(q) || c.shade?.toLowerCase().includes(q) || c.material?.toLowerCase().includes(q);
  });

  const handleComplete = async (caseCustomId) => {
    try {
      const res = await fetch(`${API}/api/batch/ceramist/complete/${caseCustomId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) fetchQueue();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>
            <Paintbrush size={22} style={{ color: '#c084fc' }} />
            Finishing Queue
          </h1>
          <p className={styles.subtitle}>
            Welcome, <strong>{user?.name}</strong> · {cases.length} case{cases.length !== 1 ? 's' : ''} awaiting finishing
          </p>
        </div>
        <div className={styles.searchBox}>
          <Search size={14} />
          <input placeholder="Search shade, material…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </header>

      <div className={styles.queue}>
        {loading ? (
          Array(3).fill(0).map((_, i) => <Skeleton key={i} height="120px" borderRadius="16px" style={{ marginBottom: '0.75rem' }} />)
        ) : filtered.length === 0 ? (
          <div className={styles.empty}>
            <CheckCircle size={48} />
            <h3>All caught up!</h3>
            <p>No cases need finishing right now.</p>
          </div>
        ) : (
          filtered.map(c => (
            <div key={c.id} className={`${styles.card} ${c.priorityFlag ? styles.priority : ''}`}>
              <div className={styles.cardHeader}>
                <div className={styles.caseId}>
                  {c.priorityFlag && <Star size={12} className={styles.starIcon} />}
                  {c.id}
                </div>
                <span className={styles.caseType}>{c.type || c.caseType?.replace(/_/g, ' ')}</span>
              </div>

              <div className={styles.rxRow}>
                <div className={styles.rxChip}>
                  <span className={styles.rxLabel}>Material</span>
                  <span className={styles.rxValue}>{c.material || '—'}</span>
                </div>
                <div className={styles.rxChip}>
                  <span className={styles.rxLabel}>Shade</span>
                  <span className={styles.rxValue}>{c.shade || '—'}</span>
                </div>
                <div className={styles.rxChip}>
                  <span className={styles.rxLabel}>Due</span>
                  <span className={styles.rxValue}>{c.due || 'TBD'}</span>
                </div>
                <div className={styles.rxChip}>
                  <span className={styles.rxLabel}>Files</span>
                  <span className={styles.rxValue}>{c.designFiles?.length || 0}</span>
                </div>
              </div>

              {c.instructions && (
                <div className={styles.instructions}>
                  <strong>Doctor's Notes:</strong> {c.instructions}
                </div>
              )}

              {/* Finishing tier badge */}
              <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
                <span style={{
                  fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.5px',
                  padding:'3px 10px', borderRadius:'999px',
                  background: c.finishingTier === 'premium' ? 'rgba(251,191,36,0.15)' : 'rgba(148,163,184,0.15)',
                  color: c.finishingTier === 'premium' ? '#fbbf24' : '#94a3b8',
                  border: `1px solid ${c.finishingTier === 'premium' ? 'rgba(251,191,36,0.3)' : 'rgba(148,163,184,0.2)'}`,
                }}>
                  {c.finishingTier === 'premium' ? '✨ Signature Match' : 'Studio Finish'}
                </span>
              </div>

              {/* Reference photo for Signature Match */}
              {c.finishingTier === 'premium' && c.referencePhotoUrl && (
                <div style={{marginBottom:'8px',background:'rgba(0,0,0,0.15)',borderRadius:'12px',padding:'12px',border:'1px solid var(--glass-border)'}}>
                  <span style={{fontSize:'0.7rem',textTransform:'uppercase',color:'#fbbf24',fontWeight:600,letterSpacing:'0.5px',display:'block',marginBottom:'8px'}}>
                    Adjacent Teeth Reference
                  </span>
                  <img
                    src={`${API}${c.referencePhotoUrl}`}
                    alt="Adjacent teeth reference"
                    style={{width:'100%',maxWidth:'300px',borderRadius:'8px',cursor:'pointer'}}
                    onClick={e => { e.target.style.maxWidth = e.target.style.maxWidth === '300px' ? '100%' : '300px'; }}
                  />
                </div>
              )}

              <div className={styles.cardActions}>
                {c.designFiles?.length > 0 && (
                  <a
                    href={`${API}${c.designFiles[0].url}`}
                    download
                    className={styles.btnOutline}
                    onClick={e => e.stopPropagation()}
                  >
                    <Package size={14} /> View Design
                  </a>
                )}
                <button className={styles.btnPrimary} onClick={() => handleComplete(c.id)}>
                  <CheckCircle size={14} /> Finishing Complete → QC
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default CeramistDashboard;
