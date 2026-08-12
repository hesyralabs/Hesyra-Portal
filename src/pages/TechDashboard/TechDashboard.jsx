import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, Printer, Package, CheckCircle, Wrench, Clock,
  AlertCircle, Star, Download, Layers, Play, Users,
  ChevronDown, ChevronRight, Paintbrush,
} from 'lucide-react';
import Skeleton from '../../components/UI/Skeleton';
import { useAuth } from '../../context/AuthContext';
import styles from './TechDashboard.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Status config for batch board ──────────────────────────────
const BATCH_STATUS = {
  preparing: { label: 'Preparing',   color: '#60a5fa', icon: Layers },
  printing:  { label: 'Printing',    color: '#a78bfa', icon: Printer },
  printed:   { label: 'Printed',     color: '#fbbf24', icon: CheckCircle },
  completed: { label: 'Completed',   color: '#34d399', icon: CheckCircle },
};

const TechDashboard = () => {
  const { user } = useAuth();
  const [segments, setSegments]     = useState({});
  const [totalReady, setTotalReady] = useState(0);
  const [batches, setBatches]       = useState([]);
  const [ceramists, setCeramists]   = useState([]);
  // Where the last completed batch's cases were routed.
  const [routeNote, setRouteNote]   = useState('');
  const [loading, setLoading]       = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSeg, setExpandedSeg] = useState({});
  const [expandedBatch, setExpandedBatch] = useState(null);
  const [processing, setProcessing] = useState(false);

  // Batch creation form state
  const [machine, setMachine] = useState('');

  // Ceramist assignment state (per-batch)
  const [bulkCeramist, setBulkCeramist] = useState('');

  const token = sessionStorage.getItem('hesyra_token');
  const headers = { Authorization: `Bearer ${token}` };

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [segRes, batchRes, ceramistRes] = await Promise.all([
        fetch(`${API}/api/batch/segments`, { headers }),
        fetch(`${API}/api/batch`, { headers }),
        fetch(`${API}/api/batch/ceramists`, { headers }),
      ]);
      const segData = await segRes.json();
      const batchData = await batchRes.json();
      const ceramistData = await ceramistRes.json();

      setSegments(segData.segments || {});
      setTotalReady(segData.totalCases || 0);
      setBatches(Array.isArray(batchData) ? batchData : []);
      setCeramists(Array.isArray(ceramistData) ? ceramistData : []);
    } catch (err) {
      console.error('Failed to fetch tech dashboard:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // ── Segment actions ───────────────────────────────────────────
  const toggleSeg = (key) => {
    setExpandedSeg(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const createBatch = async (caseType, material, cases) => {
    if (processing) return;
    setProcessing(true);
    try {
      const res = await fetch(`${API}/api/batch`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseIds: cases.map(c => c.id),
          material,
          caseType,
          machine: machine || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMachine('');
        fetchAll();
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch {
      alert('Network error');
    } finally {
      setProcessing(false);
    }
  };

  // ── Batch actions ─────────────────────────────────────────────
  const startBatch = async (batchId) => {
    if (processing) return;
    setProcessing(true);
    try {
      const res = await fetch(`${API}/api/batch/${batchId}/start`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine: machine || null }),
      });
      if (res.ok) { setMachine(''); fetchAll(); }
    } catch {}
    finally { setProcessing(false); }
  };

  const completeBatch = async (batchId) => {
    if (processing) return;
    setProcessing(true);
    setRouteNote('');
    try {
      const res = await fetch(`${API}/api/batch/${batchId}/complete`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setRouteNote(d.error || 'Could not close the batch.'); return; }

      // Say where the work went. Closing a batch used to report nothing,
      // so there was no way to tell whether anything had reached the
      // ceramist short of logging in as one.
      const parts = [];
      if (d.toFinishing) parts.push(`${d.toFinishing} to finishing${d.assignedTo ? ` with ${d.assignedTo}` : ''}`);
      if (d.toQc) parts.push(`${d.toQc} straight to QC`);
      setRouteNote(
        d.awaitingCeramist
          ? `${d.toFinishing} case${d.toFinishing > 1 ? 's need' : ' needs'} ceramic finishing but no ceramist account is active — assign one below.`
          : parts.join(' · ') || 'Batch closed.'
      );
      fetchAll();
    } catch {
      setRouteNote('The server could not be reached — the batch was not closed.');
    }
    finally { setProcessing(false); }
  };

  const assignCeramists = async (batchId) => {
    if (processing || !bulkCeramist) return;
    setProcessing(true);
    try {
      const res = await fetch(`${API}/api/batch/${batchId}/assign-ceramists`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ceramistId: bulkCeramist }),
      });
      if (res.ok) { setBulkCeramist(''); fetchAll(); }
    } catch {}
    finally { setProcessing(false); }
  };

  // ── Stat counts ───────────────────────────────────────────────
  const printingBatches = batches.filter(b => b.status === 'printing').length;
  const awaitingCeramist = batches.filter(b => b.status === 'printed').reduce((sum, b) =>
    sum + b.cases.filter(c => c.status === 'printed').length, 0
  );

  // ── Download all STLs (open in new tabs) ──────────────────────
  const downloadAll = (cases) => {
    cases.forEach(c => {
      (c.designFiles || []).forEach(f => {
        window.open(`${API}${f.url}`, '_blank');
      });
    });
  };

  return (
    <div className={styles.container}>
      <header className={styles.pageHeader}>
        <div className={styles.headerInfo}>
          <h1 className={styles.pageTitle}>Production Floor</h1>
          <p className={styles.pageSubtitle}>
            Welcome, <strong>{user?.name}</strong> &nbsp;·&nbsp; Batch-based print workflow
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchContainer}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Search case ID or material..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      {/* ─── Stat Tiles ───────────────────────────────── */}
      <section className={styles.metricsGrid}>
        <div className={styles.metricTile} style={{ '--metric-color': '#34d399' }}>
          <div className={styles.metricHeader}>
            <div className={styles.metricIcon}><CheckCircle size={18} /></div>
            <span className={styles.metricCount}>{totalReady}</span>
          </div>
          <span className={styles.metricLabel}>Ready to Batch</span>
        </div>
        <div className={styles.metricTile} style={{ '--metric-color': '#a78bfa' }}>
          <div className={styles.metricHeader}>
            <div className={styles.metricIcon}><Printer size={18} /></div>
            <span className={styles.metricCount}>{printingBatches}</span>
          </div>
          <span className={styles.metricLabel}>Batches Printing</span>
        </div>
        <div className={styles.metricTile} style={{ '--metric-color': '#fbbf24' }}>
          <div className={styles.metricHeader}>
            <div className={styles.metricIcon}><Paintbrush size={18} /></div>
            <span className={styles.metricCount}>{awaitingCeramist}</span>
          </div>
          <span className={styles.metricLabel}>Awaiting Ceramist</span>
        </div>
        <div className={styles.metricTile} style={{ '--metric-color': '#60a5fa' }}>
          <div className={styles.metricHeader}>
            <div className={styles.metricIcon}><Layers size={18} /></div>
            <span className={styles.metricCount}>{batches.filter(b => ['preparing', 'printing'].includes(b.status)).length}</span>
          </div>
          <span className={styles.metricLabel}>Active Batches</span>
        </div>
      </section>

      {/* Where the last closed batch went. Sits at page level because a
          completed batch leaves the Active list immediately — reporting
          this inside the batch card meant it vanished with it. */}
      {routeNote && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
          margin: '0 0 1rem', padding: '0.6rem 0.9rem', borderRadius: 10,
          fontSize: '0.8rem',
          background: 'rgba(122,156,150,0.1)',
          border: '1px solid rgba(122,156,150,0.3)',
          color: 'var(--brand-bioceramic)',
        }}>
          <span>{routeNote}</span>
          <button onClick={() => setRouteNote('')}
            style={{ background: 'none', border: 0, color: 'inherit', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
            aria-label="Dismiss">×</button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          SECTION 1: AUTO-SEGMENTED QUEUE
          Groups design_approved cases by caseType → material
          ═══════════════════════════════════════════════════ */}
      <section className={styles.sectionBlock}>
        <h2 className={styles.sectionTitle}>
          <Package size={18} /> Ready to Batch
          <span className={styles.sectionCount}>{totalReady} cases</span>
        </h2>

        {loading ? (
          Array(2).fill(0).map((_, i) => <Skeleton key={i} height="100px" borderRadius="16px" style={{ marginBottom: '0.75rem' }} />)
        ) : Object.keys(segments).length === 0 ? (
          <div className={styles.emptyQueue}>
            <Wrench size={40} />
            <h3>No approved designs waiting</h3>
            <p>Designs will appear here once the manager approves them.</p>
          </div>
        ) : (
          Object.entries(segments).map(([caseType, materials]) => (
            <div key={caseType} className={styles.segmentGroup}>
              <h3 className={styles.segGroupTitle}>
                {caseType.replace(/_/g, ' ').toUpperCase()}
              </h3>
              {Object.entries(materials).map(([material, cases]) => {
                const segKey = `${caseType}__${material}`;
                const isOpen = expandedSeg[segKey];
                const totalFiles = cases.reduce((s, c) => s + (c.designFiles?.length || 0), 0);

                return (
                  <div key={segKey} className={styles.segmentCard}>
                    <div className={styles.segHeader} onClick={() => toggleSeg(segKey)}>
                      <div className={styles.segHeaderLeft}>
                        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        <span className={styles.segMaterial}>{material}</span>
                        <span className={styles.segCount}>{cases.length} case{cases.length > 1 ? 's' : ''}</span>
                        <span className={styles.segFiles}>{totalFiles} STL file{totalFiles > 1 ? 's' : ''}</span>
                      </div>
                      <div className={styles.segActions}>
                        <button
                          className={styles.btnSmall}
                          onClick={e => { e.stopPropagation(); downloadAll(cases); }}
                          title="Download all STL files in this segment"
                        >
                          <Download size={13} /> Download All
                        </button>
                        <button
                          className={styles.btnCreate}
                          onClick={e => { e.stopPropagation(); createBatch(caseType, material, cases); }}
                          disabled={processing}
                          title="Create a print batch from this segment"
                        >
                          <Layers size={13} /> {processing ? '…' : 'Create Batch'}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className={styles.segCases}>
                        {cases.map(c => (
                          <Link to={`/tech/case/${c.id}`} key={c.id} className={styles.segCaseRow}>
                            <span className={styles.segCaseId}>
                              {c.priorityFlag && <Star size={11} className={styles.priorityStar} />}
                              {c.id}
                            </span>
                            <span className={styles.segShade}>Shade: {c.shade || '—'}</span>
                            <span className={styles.segClinic}>{c.clinic || ''}</span>
                            <span className={styles.segDue}>{c.due || 'TBD'}</span>
                            <span className={styles.segFileCount}>{c.designFiles?.length || 0} files</span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </section>

      {/* ═══════════════════════════════════════════════════
          SECTION 2: ACTIVE BATCHES
          ═══════════════════════════════════════════════════ */}
      <section className={styles.sectionBlock}>
        <h2 className={styles.sectionTitle}>
          <Printer size={18} /> Active Batches
          <span className={styles.sectionCount}>{batches.filter(b => b.status !== 'completed').length} active</span>
        </h2>

        {batches.filter(b => b.status !== 'completed').length === 0 && !loading ? (
          <div className={styles.emptyQueue}>
            <Layers size={40} />
            <h3>No active batches</h3>
            <p>Create a batch from the segments above to start printing.</p>
          </div>
        ) : (
          batches.filter(b => b.status !== 'completed').map(batch => {
            const cfg = BATCH_STATUS[batch.status] || BATCH_STATUS.preparing;
            const Icon = cfg.icon;
            const isOpen = expandedBatch === batch.id;

            return (
              <div key={batch.id} className={styles.batchCard}>
                <div className={styles.batchHeader} onClick={() => setExpandedBatch(isOpen ? null : batch.id)}>
                  <div className={styles.batchLeft}>
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span className={styles.batchId}>{batch.id}</span>
                    <span className={styles.batchName}>{batch.name || ''}</span>
                    <span className={styles.batchBadge} style={{ color: cfg.color, background: `${cfg.color}18` }}>
                      <Icon size={12} /> {cfg.label}
                    </span>
                  </div>
                  <div className={styles.batchRight}>
                    <span className={styles.batchMeta}>{batch.caseCount} case{batch.caseCount > 1 ? 's' : ''}</span>
                    {batch.material && <span className={styles.batchMeta}>{batch.material}</span>}
                    {batch.machine && <span className={styles.batchMeta}>🖨️ {batch.machine}</span>}
                  </div>
                </div>

                {isOpen && (
                  <div className={styles.batchDetail}>
                    {/* Cases in this batch */}
                    <div className={styles.batchCaseList}>
                      {batch.cases.map(c => (
                        <div key={c.customId} className={styles.batchCaseRow}>
                          <span>{c.customId}</span>
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{c.patient}</span>
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{c.shade}</span>
                          <span className={styles.batchCaseStatus}>{c.status}</span>
                        </div>
                      ))}
                    </div>

                    {/* Actions */}
                    <div className={styles.batchActions}>
                      {batch.status === 'preparing' && (
                        <>
                          <input
                            placeholder="Machine name (optional)"
                            value={machine}
                            onChange={e => setMachine(e.target.value)}
                            className={styles.machineInput}
                          />
                          <button className={styles.btnAction} onClick={() => startBatch(batch.id)} disabled={processing}>
                            <Play size={14} /> Start Print
                          </button>
                        </>
                      )}
                      {batch.status === 'printing' && (
                        <button className={styles.btnAction} onClick={() => completeBatch(batch.id)} disabled={processing}>
                          <CheckCircle size={14} /> Print Complete
                        </button>
                      )}
                      {batch.status === 'printed' && (
                        <>
                          <select
                            value={bulkCeramist}
                            onChange={e => setBulkCeramist(e.target.value)}
                            className={styles.machineInput}
                          >
                            <option value="">Select Ceramist…</option>
                            {ceramists.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <button
                            className={styles.btnAction}
                            onClick={() => assignCeramists(batch.id)}
                            disabled={processing || !bulkCeramist}
                            style={{ background: 'rgba(192,132,252,0.15)', color: '#c084fc' }}
                          >
                            <Paintbrush size={14} /> Assign All to Ceramist
                          </button>
                        </>
                      )}
                      {batch.startedAt && (
                        <span className={styles.batchTime}>
                          <Clock size={12} /> Started {new Date(batch.startedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      {/* Completed batches (collapsed) */}
      {batches.filter(b => b.status === 'completed').length > 0 && (
        <section className={styles.sectionBlock}>
          <h2 className={styles.sectionTitle} style={{ opacity: 0.5 }}>
            <CheckCircle size={18} /> Completed Batches
            <span className={styles.sectionCount}>{batches.filter(b => b.status === 'completed').length}</span>
          </h2>
          <div style={{ fontSize: '0.78rem', color: '#475569', padding: '0.5rem 0' }}>
            {batches.filter(b => b.status === 'completed').map(b => (
              <span key={b.id} style={{ marginRight: '1rem' }}>{b.id} ({b.caseCount} cases)</span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

export default TechDashboard;
