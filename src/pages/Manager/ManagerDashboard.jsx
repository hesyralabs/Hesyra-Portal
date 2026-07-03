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

const ManagerDashboard = () => {
  const { user } = useAuth();
  const [cases, setCases] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
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

  const filtered = activeCases.filter(c => {
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || c.id?.toLowerCase().includes(q) || c.caseType?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const designPending = activeCases.filter(c => c.status === 'design_ready').length;

  const statTiles = [
    { label: 'Active Cases',       value: activeCases.length,                     icon: ClipboardList, color: '#60a5fa' },
    { label: 'Urgent / Blocked',   value: urgentCases.length,                     icon: AlertCircle,   color: '#ef4444' },
    { label: 'Designs for Review', value: designPending,                          icon: Zap,           color: '#a78bfa' },
    { label: 'Ready for Dispatch', value: statusCounts['ready_for_dispatch'] || 0, icon: Package,      color: '#f59e0b' },
    {
      label: 'Unclaimed in Pool',
      value: poolStats.totalInPool,
      icon: Layers,
      color: poolStats.urgentCount > 0 ? '#ef4444' : poolStats.totalInPool > 0 ? '#f59e0b' : '#34d399',
      subtitle: poolStats.urgentCount > 0 ? `${poolStats.urgentCount} approaching timeout` : null,
    },
    ...(totalOutstandingPaise > 0 ? [{
      label: 'Outstanding Credit',
      value: `₹${(totalOutstandingPaise / 100).toLocaleString('en-IN')}`,
      icon: CreditCard,
      color: '#c084fc',
      subtitle: `${creditClinics.length} clinic${creditClinics.length !== 1 ? 's' : ''} on Net-30`,
    }] : []),
  ];

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

      {/* ─── Stat tiles ─── */}
      <section className={styles.statGrid}>
        {statTiles.map(tile => {
          const Icon = tile.icon;
          return (
            <div key={tile.label} className={styles.statTile} style={{ '--accent': tile.color }}>
              <div className={styles.statIcon}><Icon size={22} /></div>
              <div className={styles.statValue}>{loading ? '—' : tile.value}</div>
              <div className={styles.statLabel}>{tile.label}</div>
            </div>
          );
        })}
      </section>

      {/* ─── Urgent cases ─── */}
      {urgentCases.length > 0 && (
        <section className={styles.urgentSection}>
          <div className={styles.sectionHeader}>
            <TriangleAlert size={16} className={styles.urgentIcon} />
            <span>Requires Attention ({urgentCases.length})</span>
          </div>
          <div className={styles.urgentList}>
            {urgentCases.slice(0, 5).map(c => {
              const cfg = STATUS_CONFIG[c.status] || { label: c.status, color: '#94a3b8', bg: 'rgba(148,163,184,0.1)' };
              return (
                <Link key={c.id} to={`/manager/case/${c.id}`} className={styles.urgentRow}>
                  {c.priorityFlag && <Star size={12} className={styles.priorityStar} />}
                  <span className={styles.urgentId}>{c.id}</span>
                  <span className={styles.urgentType}>{c.caseType?.replace(/_/g,' ')}</span>
                  <span className={styles.urgentBadge} style={{ color: cfg.color, background: cfg.bg }}>
                    {cfg.label}
                  </span>
                  <ChevronRight size={14} className={styles.urgentArrow} />
                </Link>
              );
            })}
          </div>
        </section>
      )}

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

      {/* ─── Status pipeline overview ─── */}
      <section className={styles.pipelineSection}>
        <div className={styles.sectionHeader}>
          <TrendingUp size={16} />
          <span>Pipeline Breakdown</span>
        </div>
        <div className={styles.pipelineGrid}>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
            const count = statusCounts[key] || 0;
            if (count === 0) return null;
            return (
              <button
                key={key}
                className={`${styles.pipelineTile} ${statusFilter === key ? styles.pipelineTileActive : ''}`}
                onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
                style={{ '--tile-color': cfg.color }}
              >
                <span className={styles.pipelineCount}>{count}</span>
                <span className={styles.pipelineLabel}>{cfg.label}</span>
                <div className={styles.pipelineBar} style={{ background: cfg.bg, borderColor: cfg.color }} />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default ManagerDashboard;
