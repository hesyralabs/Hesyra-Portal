import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Star, RefreshCw, Zap, ChevronRight, AlertCircle
} from 'lucide-react';
import styles from './ManagerCases.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const STATUS_CONFIG = {
  submitted:          { label: 'New',              color: '#60a5fa' },
  action_required:    { label: 'Action Req.',      color: '#fbbf24' },
  cad_assigned:       { label: 'CAD Assigned',     color: '#a78bfa' },
  blocked:            { label: 'Blocked',           color: '#ef4444' },
  design_ready:       { label: 'Design Ready',     color: '#34d399' },
  design_revision:    { label: 'Revision',         color: '#fb923c' },
  design_approved:    { label: 'Approved',         color: '#34d399' },
  post_processing:    { label: 'Post-Process',     color: '#fcd34d' },
  qa:                 { label: 'QA',               color: '#fb923c' },
  ready_for_dispatch: { label: 'Ready Dispatch',   color: '#f59e0b' },
  payment_pending:    { label: 'Awaiting Payment', color: '#ef4444' },
  packaged:           { label: 'Packaged',         color: '#38bdf8' },
  dispatched:         { label: 'Dispatched',       color: '#10b981' },
  overdue:            { label: 'Overdue',          color: '#f87171' },
  completed:          { label: 'Completed',        color: '#10b981' },
};

const ManagerCases = () => {
  const navigate = useNavigate();
  const [cases, setCases]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [technicians, setTechnicians] = useState([]);
  const [designers, setDesigners]     = useState([]);
  const [forceModal, setForceModal]   = useState(null);
  const [forceData, setForceData]     = useState({ newStatus: '', reason: '' });
  const [saving, setSaving]           = useState(false);
  const [toast, setToast]             = useState('');

  const token = sessionStorage.getItem('hesyra_token');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [casesRes, techRes, cadRes] = await Promise.all([
        fetch(`${API}/api/cases`, { headers }),
        fetch(`${API}/api/manager/workload`, { headers }),
        fetch(`${API}/api/manager/designers`, { headers }),
      ]);
      setCases(await casesRes.json());
      setTechnicians(await techRes.json());
      setDesigners(await cadRes.json());
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = cases.filter(c => {
    if (['archived', 'cancelled'].includes(c.status) && statusFilter === 'all') return false;
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const q = search.toLowerCase();
    const matchSearch = !q || c.id?.toLowerCase().includes(q) || c.caseType?.toLowerCase().includes(q) || c.clinic?.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const assignTech = async (e, caseCustomId, techId) => {
    e.stopPropagation();
    const res = await fetch(`${API}/api/manager/cases/${caseCustomId}/assign`, {
      method: 'PUT', headers, body: JSON.stringify({ techId: techId === '' ? null : techId }),
    });
    if (res.ok) { showToast(techId ? 'Technician assigned ✓' : 'Technician unassigned ✓'); fetchAll(); }
    else { const d = await res.json(); showToast(d.error || 'Assignment failed'); }
  };

  const assignDesigner = async (e, caseCustomId, designerId) => {
    e.stopPropagation();
    const res = await fetch(`${API}/api/manager/cases/${caseCustomId}/assign`, {
      method: 'PUT', headers, body: JSON.stringify({ designerId: designerId === '' ? null : designerId }),
    });
    if (res.ok) { showToast(designerId ? 'Designer assigned ✓' : 'Designer unassigned ✓'); fetchAll(); }
    else { const d = await res.json(); showToast(d.error || 'Assignment failed'); }
  };

  const togglePriority = async (e, caseCustomId, current) => {
    e.stopPropagation();
    await fetch(`${API}/api/manager/cases/${caseCustomId}/priority`, {
      method: 'PUT', headers, body: JSON.stringify({ priorityFlag: !current }),
    });
    fetchAll();
  };

  // FIXED: uses correct endpoint /api/manager/cases/:id/state
  const handleForceState = async () => {
    if (!forceData.newStatus || !forceData.reason.trim()) return;
    setSaving(true);
    const res = await fetch(`${API}/api/manager/cases/${forceModal.caseId}/state`, {
      method: 'PUT', headers,
      body: JSON.stringify({ newStatus: forceData.newStatus, reason: forceData.reason }),
    });
    setSaving(false);
    if (res.ok) {
      showToast('State overridden ✓');
      setForceModal(null);
      setForceData({ newStatus: '', reason: '' });
      fetchAll();
    } else {
      const d = await res.json();
      showToast(d.error || 'Override failed');
    }
  };

  return (
    <div className={styles.container}>
      {toast && <div className={styles.toast}>{toast}</div>}

      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Case Management</h1>
          <p className={styles.subtitle}>Assign, prioritize, and override case states · click any row to open detail view</p>
        </div>
        <div className={styles.headerControls}>
          <div className={styles.searchBox}>
            <Search size={15} />
            <input placeholder="Search cases…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className={styles.filterSelect} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">All Active</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
          <button className={styles.refreshBtn} onClick={fetchAll}><RefreshCw size={15} /></button>
        </div>
      </header>

      <div className={styles.tableWrapper}>
        <div className={styles.tableHead}>
          <div className={styles.colCase}>Case</div>
          <div className={styles.colStatus}>Status</div>
          <div className={styles.colClinic}>Clinic</div>
          <div className={styles.colTech}>Technician</div>
          <div className={styles.colDesigner}>Designer</div>
          <div className={styles.colAssignment}>Assignment</div>
          <div className={styles.colActions}>Actions</div>
        </div>

        <div className={styles.tableBody}>
          {loading ? (
            Array(6).fill(0).map((_, i) => (
              <div key={i} className={styles.skeletonRow}>
                <div className={styles.skeletonCell} style={{ width: '220px' }} />
                <div className={styles.skeletonCell} style={{ width: '120px' }} />
                <div className={styles.skeletonCell} style={{ width: '160px' }} />
                <div className={styles.skeletonCell} style={{ width: '140px' }} />
                <div className={styles.skeletonCell} style={{ width: '140px' }} />
              </div>
            ))
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>
              <AlertCircle size={36} />
              <p>No cases match the current filters.</p>
            </div>
          ) : (
            filtered.map(c => {
              const cfg = STATUS_CONFIG[c.status] || { label: c.status, color: '#94a3b8' };
              return (
                <div
                  key={c.id}
                  className={`${styles.tableRow} ${c.priorityFlag ? styles.priorityRow : ''}`}
                  onClick={() => navigate(`/manager/case/${c.id}`)}
                >
                  <div className={styles.colCase}>
                    <span className={styles.caseId}>{c.id}</span>
                    <span className={styles.caseType}>{c.caseType?.replace(/_/g, ' ')}</span>
                  </div>

                  <div className={styles.colStatus}>
                    <span className={styles.statusBadge} style={{ color: cfg.color, borderColor: `${cfg.color}33` }}>
                      {cfg.label}
                    </span>
                  </div>

                  <div className={styles.colClinic}>
                    <span className={styles.clinicName}>{c.clinic || '—'}</span>
                  </div>

                  <div className={styles.colTech} onClick={e => e.stopPropagation()}>
                    <select
                      className={styles.assignSelect}
                      value={c.assignedTechId || ''}
                      onChange={e => assignTech(e, c.id, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {technicians.map(t => (
                        <option key={t.id} value={t.id}>{t.name} ({t.activeCases})</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.colDesigner} onClick={e => e.stopPropagation()}>
                    <select
                      className={styles.assignSelect}
                      value={c.assignedDesignerId || ''}
                      onChange={e => assignDesigner(e, c.id, e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {designers.map(d => (
                        <option key={d.id} value={d.id}>{d.name} ({d.activeCases})</option>
                      ))}
                    </select>
                  </div>

                  <div className={styles.colAssignment} onClick={e => e.stopPropagation()}>
                    {c.assignmentMethod === 'self_select' && (
                      <span style={{ fontSize: '0.72rem', color: '#34d399', background: 'rgba(52,211,153,0.1)', padding: '0.2rem 0.5rem', borderRadius: '6px', border: '1px solid rgba(52,211,153,0.2)' }}>
                        🎯 Self-Selected
                      </span>
                    )}
                    {c.assignmentMethod === 'auto_assign' && (
                      <span style={{ fontSize: '0.72rem', color: '#f59e0b', background: 'rgba(245,158,11,0.1)', padding: '0.2rem 0.5rem', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.2)' }}>
                        ⏰ Auto-Assigned
                      </span>
                    )}
                    {c.assignmentMethod === 'manager_assign' && (
                      <span style={{ fontSize: '0.72rem', color: '#94a3b8', background: 'rgba(148,163,184,0.08)', padding: '0.2rem 0.5rem', borderRadius: '6px', border: '1px solid rgba(148,163,184,0.15)' }}>
                        👤 Manager
                      </span>
                    )}
                    {!c.assignmentMethod && c.assignedDesignerId && (
                      <span style={{ fontSize: '0.7rem', color: '#475569' }}>—</span>
                    )}
                  </div>

                  <div className={styles.colActions} onClick={e => e.stopPropagation()}>
                    <button
                      className={`${styles.actionBtn} ${c.priorityFlag ? styles.priorityActive : ''}`}
                      onClick={e => togglePriority(e, c.id, c.priorityFlag)}
                      title={c.priorityFlag ? 'Remove priority' : 'Mark as priority'}
                    >
                      <Star size={14} />
                    </button>
                    <button
                      className={styles.actionBtn}
                      onClick={e => { e.stopPropagation(); setForceModal({ caseId: c.id, currentStatus: c.status }); }}
                      title="Force state override"
                    >
                      <Zap size={14} />
                    </button>
                    <ChevronRight size={14} className={styles.rowArrow} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Force State Modal */}
      {forceModal && (
        <div className={styles.modalOverlay} onClick={() => setForceModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Force State Override</h2>
            <p className={styles.modalSub}>Bypasses the state machine. Audit-logged with your name and reason.</p>
            <div className={styles.modalField}>
              <label>New Status</label>
              <select value={forceData.newStatus} onChange={e => setForceData(d => ({ ...d, newStatus: e.target.value }))}>
                <option value="">Select target state…</option>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.modalField}>
              <label>Reason (mandatory)</label>
              <textarea
                placeholder="Describe why this override is necessary…"
                value={forceData.reason}
                onChange={e => setForceData(d => ({ ...d, reason: e.target.value }))}
                rows={3}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setForceModal(null)}>Cancel</button>
              <button
                className={styles.forceBtn}
                onClick={handleForceState}
                disabled={!forceData.newStatus || !forceData.reason.trim() || saving}
              >
                {saving ? 'Applying…' : 'Apply Override'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerCases;
