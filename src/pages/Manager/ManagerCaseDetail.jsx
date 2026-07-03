import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ChevronLeft, Star, Clock, Paperclip, MessageSquare,
  CheckCircle, RotateCcw, Zap, User, Cpu, StickyNote,
  AlertTriangle, Send, X, FileText
} from 'lucide-react';
import styles from './ManagerCaseDetail.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const STATUS_CONFIG = {
  submitted:          { label: 'Submitted',           color: '#60a5fa' },
  action_required:    { label: 'Action Required',     color: '#fbbf24' },
  cad_assigned:       { label: 'CAD Assigned',        color: '#a78bfa' },
  blocked:            { label: 'Blocked',              color: '#ef4444' },
  design_ready:       { label: 'Design Ready',        color: '#34d399' },
  design_revision:    { label: 'Revision Requested',  color: '#fb923c' },
  design_approved:    { label: 'Design Approved',     color: '#34d399' },
  post_processing:    { label: 'Post-Processing',     color: '#fcd34d' },
  qa:                 { label: 'QA',                  color: '#fb923c' },
  ready_for_dispatch: { label: 'Ready for Dispatch',  color: '#f59e0b' },
  payment_pending:    { label: 'Awaiting Payment',    color: '#ef4444' },
  packaged:           { label: 'Packaged',            color: '#38bdf8' },
  dispatched:         { label: 'Dispatched',          color: '#10b981' },
  overdue:            { label: 'Overdue',             color: '#f87171' },
  completed:          { label: 'Delivered',           color: '#10b981' },
};

const ALL_STATUSES = Object.keys(STATUS_CONFIG);

const ManagerCaseDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [caseData, setCaseData]         = useState(null);
  const [technicians, setTechnicians]   = useState([]);
  const [designers, setDesigners]       = useState([]);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [note, setNote]                 = useState('');
  const [savingNote, setSavingNote]     = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [revisionModal, setRevisionModal] = useState(false);
  const [revisionReason, setRevisionReason] = useState('');
  const [forceModal, setForceModal]     = useState(false);
  const [forceData, setForceData]       = useState({ newStatus: '', reason: '' });
  const [toast, setToast]               = useState('');

  const token = sessionStorage.getItem('hesyra_token');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const fetchCase = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, wRes, dRes] = await Promise.all([
        fetch(`${API}/api/cases/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/manager/workload`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/api/manager/designers`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (!cRes.ok) throw new Error('Case not found');
      const [c, w, d] = await Promise.all([cRes.json(), wRes.json(), dRes.json()]);
      setCaseData(c);
      setTechnicians(Array.isArray(w) ? w : []);
      setDesigners(Array.isArray(d) ? d : []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchCase(); }, [fetchCase]);

  const assignTech = async (techId) => {
    const res = await fetch(`${API}/api/manager/cases/${id}/assign`, {
      method: 'PUT', headers,
      body: JSON.stringify({ techId: techId === '' ? null : techId }),
    });
    if (res.ok) { showToast(techId ? 'Technician assigned ✓' : 'Technician unassigned ✓'); fetchCase(); }
    else { const d = await res.json(); showToast(d.error || 'Assignment failed'); }
  };

  const assignDesigner = async (designerId) => {
    const res = await fetch(`${API}/api/manager/cases/${id}/assign`, {
      method: 'PUT', headers,
      body: JSON.stringify({ designerId: designerId === '' ? null : designerId }),
    });
    if (res.ok) { showToast(designerId ? 'Designer assigned ✓' : 'Designer unassigned ✓'); fetchCase(); }
    else { const d = await res.json(); showToast(d.error || 'Assignment failed'); }
  };

  const togglePriority = async () => {
    await fetch(`${API}/api/manager/cases/${id}/priority`, {
      method: 'PUT', headers,
      body: JSON.stringify({ priorityFlag: !caseData.priorityFlag }),
    });
    fetchCase();
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSavingNote(true);
    const res = await fetch(`${API}/api/manager/cases/${id}/notes`, {
      method: 'PUT', headers,
      body: JSON.stringify({ notes: note }),
    });
    setSavingNote(false);
    if (res.ok) { setNote(''); showToast('Note saved ✓'); fetchCase(); }
    else showToast('Failed to save note');
  };

  const advanceCase = async (newStatus, label) => {
    setSavingAction(true);
    const res = await fetch(`${API}/api/manager/cases/${id}/advance`, {
      method: 'PUT', headers,
      body: JSON.stringify({ newStatus, timelineLabel: label }),
    });
    setSavingAction(false);
    if (res.ok) { showToast(`Status → ${newStatus} ✓`); fetchCase(); }
    else { const d = await res.json(); showToast(d.error || 'Failed'); }
  };

  const designAction = async (action) => {
    if (action === 'revise' && !revisionReason.trim()) return;
    setSavingAction(true);
    const res = await fetch(`${API}/api/manager/cases/${id}/design-action`, {
      method: 'PUT', headers,
      body: JSON.stringify({ action, reason: revisionReason }),
    });
    setSavingAction(false);
    setRevisionModal(false);
    setRevisionReason('');
    if (res.ok) { showToast(action === 'approve' ? 'Design approved ✓' : 'Revision requested ✓'); fetchCase(); }
    else { const d = await res.json(); showToast(d.error || 'Failed'); }
  };

  const forceOverride = async () => {
    if (!forceData.newStatus || !forceData.reason.trim()) return;
    setSavingAction(true);
    const res = await fetch(`${API}/api/manager/cases/${id}/state`, {
      method: 'PUT', headers,
      body: JSON.stringify({ newStatus: forceData.newStatus, reason: forceData.reason }),
    });
    setSavingAction(false);
    setForceModal(false);
    setForceData({ newStatus: '', reason: '' });
    if (res.ok) { showToast('State overridden ✓'); fetchCase(); }
    else { const d = await res.json(); showToast(d.error || 'Failed'); }
  };

  if (loading) return <div className={styles.center}>Loading case…</div>;
  if (error)   return <div className={styles.centerError}>{error}</div>;
  if (!caseData) return null;

  const c = caseData;
  const cfg = STATUS_CONFIG[c.status] || { label: c.status, color: '#94a3b8' };
  const scanFiles   = (c.files || []).filter(f => f.category === 'scan');
  const designFiles = (c.files || []).filter(f => f.category === 'design');

  return (
    <div className={styles.container}>
      {/* ── Toast ── */}
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* ── Top bar ── */}
      <header className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate('/manager/cases')}>
          <ChevronLeft size={16} /> Cases
        </button>
        <div className={styles.topMeta}>
          <span className={styles.caseId}>{c.id}</span>
          <span className={styles.statusBadge} style={{ color: cfg.color, borderColor: `${cfg.color}30` }}>
            {cfg.label}
          </span>
          {c.priorityFlag && <span className={styles.priorityChip}>⚡ Priority</span>}
        </div>
        <div className={styles.topActions}>
          <button
            className={`${styles.priorityBtn} ${c.priorityFlag ? styles.priorityActive : ''}`}
            onClick={togglePriority}
            title={c.priorityFlag ? 'Remove priority' : 'Set priority'}
          >
            <Star size={15} />
          </button>
          <button className={styles.forceBtn} onClick={() => setForceModal(true)}>
            <Zap size={15} /> Force Override
          </button>
        </div>
      </header>

      <div className={styles.body}>
        {/* ── Left column ── */}
        <aside className={styles.leftCol}>
          {/* Clinical info */}
          <section className={styles.card}>
            <div className={styles.cardTitle}><FileText size={14} /> Clinical Info</div>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}><span>Type</span><strong>{c.caseType?.replace(/_/g,' ')}</strong></div>
              <div className={styles.infoItem}><span>Material</span><strong>{c.material || '—'}</strong></div>
              <div className={styles.infoItem}><span>Shade</span><strong>{c.shade || '—'}</strong></div>
              <div className={styles.infoItem}><span>Arch</span><strong>{c.archTarget || '—'}</strong></div>
              <div className={styles.infoItem}><span>Teeth</span><strong>{Array.isArray(c.toothNumbers) ? c.toothNumbers.join(', ') : c.toothNumbers || '—'}</strong></div>
              {c.implantSystem && <div className={styles.infoItem}><span>Implant</span><strong>{c.implantSystem}</strong></div>}
              <div className={styles.infoItem}><span>Clinic</span><strong>{c.clinic || '—'}</strong></div>
              <div className={styles.infoItem}><span>Doctor</span><strong>{c.doctor || '—'}</strong></div>
              <div className={styles.infoItem}><span>Due</span><strong>{c.due || 'TBD'}</strong></div>
            </div>
            {c.instructions && (
              <div className={styles.instructions}>
                <div className={styles.instrLabel}>Instructions</div>
                <div className={styles.instrText}>{c.instructions}</div>
              </div>
            )}
          </section>

          {/* Financial */}
          {c.totalAmountPaise != null && (
            <section className={styles.card}>
              <div className={styles.cardTitle}><FileText size={14} /> Financials</div>
              <div className={styles.infoGrid}>
                <div className={styles.infoItem}><span>Order Value</span><strong>₹{(c.totalAmountPaise / 100).toLocaleString('en-IN')}</strong></div>
                {c.paymentConfirmedAt && <div className={styles.infoItem}><span>Paid</span><strong style={{color:'#10b981'}}>✓ Confirmed</strong></div>}
                {c.disputeActive && <div className={styles.infoItem}><span>Dispute</span><strong style={{color:'#ef4444'}}>Active</strong></div>}
              </div>
            </section>
          )}

          {/* Internal notes */}
          <section className={styles.card}>
            <div className={styles.cardTitle}><StickyNote size={14} /> Internal Notes</div>
            {c.internalNotes ? (
              <pre className={styles.notesText}>{c.internalNotes}</pre>
            ) : (
              <p className={styles.notesEmpty}>No notes yet.</p>
            )}
            <div className={styles.noteInput}>
              <textarea
                placeholder="Add a note (visible to lab only)…"
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={2}
              />
              <button onClick={addNote} disabled={!note.trim() || savingNote} className={styles.noteSubmit}>
                <Send size={13} /> {savingNote ? 'Saving…' : 'Add'}
              </button>
            </div>
          </section>
        </aside>

        {/* ── Center column ── */}
        <main className={styles.centerCol}>
          {/* Action buttons — context-aware */}
          <section className={styles.card}>
            <div className={styles.cardTitle}><Zap size={14} /> Actions</div>
            <div className={styles.actionRow}>
              {/* submitted → assign CAD */}
              {c.status === 'submitted' && (
                <button className={styles.actionPrimary} onClick={() => advanceCase('cad_assigned', 'CAD work assigned by manager')} disabled={savingAction}>
                  <Cpu size={15} /> Assign to CAD
                </button>
              )}
              {/* design_ready → approve or revise */}
              {c.status === 'design_ready' && (<>
                {c.assignedTechId ? (
                  <button className={styles.actionSuccess} onClick={() => designAction('approve')} disabled={savingAction}>
                    <CheckCircle size={15} /> Approve Design
                  </button>
                ) : (
                  <button
                    className={styles.actionSuccess}
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                    onClick={() => showToast('Please assign a technician to the case first')}
                    title="A technician must be assigned before design approval"
                  >
                    <CheckCircle size={15} /> Approve Design (Tech Required)
                  </button>
                )}
                <button className={styles.actionWarn} onClick={() => setRevisionModal(true)} disabled={savingAction}>
                  <RotateCcw size={15} /> Request Revision
                </button>
              </>)}
              {/* design_approved → post processing */}
              {c.status === 'design_approved' && (
                c.assignedTechId ? (
                  <button className={styles.actionPrimary} onClick={() => advanceCase('post_processing', 'Post-processing started')} disabled={savingAction}>
                    Post-Processing →
                  </button>
                ) : (
                  <button
                    className={styles.actionPrimary}
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                    onClick={() => showToast('Please assign a technician to the case first')}
                    title="A technician must be assigned first"
                  >
                    Post-Processing (Tech Required) →
                  </button>
                )
              )}
              {/* post_processing → qa */}
              {c.status === 'post_processing' && (
                <button className={styles.actionPrimary} onClick={() => advanceCase('qa', 'Sent to QA')} disabled={savingAction}>
                  Send to QA →
                </button>
              )}
              {/* qa → ready_for_dispatch */}
              {c.status === 'qa' && (
                <button className={styles.actionSuccess} onClick={() => advanceCase('ready_for_dispatch', 'QA Passed — Ready for Dispatch')} disabled={savingAction}>
                  <CheckCircle size={15} /> QA Passed — Ready
                </button>
              )}
              {/* blocked → cad_assigned */}
              {c.status === 'blocked' && (
                <button className={styles.actionPrimary} onClick={() => advanceCase('cad_assigned', 'Unblocked — returned to CAD')} disabled={savingAction}>
                  Unblock → Return to CAD
                </button>
              )}
              <span className={styles.actionHint}>Force Override available for any state transition</span>
            </div>
          </section>

          {/* Assignment */}
          <section className={styles.card}>
            <div className={styles.cardTitle}><User size={14} /> Assignment</div>
            <div className={styles.assignGrid}>
              <div className={styles.assignField}>
                <label>Technician</label>
                <select
                  value={c.assignedTechId || ''}
                  onChange={e => assignTech(e.target.value)}
                  className={styles.assignSelect}
                >
                  <option value="">Unassigned</option>
                  {technicians.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.activeCases} active)</option>
                  ))}
                </select>
              </div>
              <div className={styles.assignField}>
                <label>CAD Designer</label>
                <select
                  value={c.assignedDesignerId || ''}
                  onChange={e => assignDesigner(e.target.value)}
                  className={styles.assignSelect}
                >
                  <option value="">Unassigned</option>
                  {designers.map(d => (
                    <option key={d.id} value={d.id}>{d.name} ({d.activeCases} active)</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Files */}
          {(scanFiles.length > 0 || designFiles.length > 0) && (
            <section className={styles.card}>
              <div className={styles.cardTitle}><Paperclip size={14} /> Files</div>
              {scanFiles.length > 0 && (
                <div className={styles.fileGroup}>
                  <div className={styles.fileGroupLabel}>Scan Files</div>
                  <div className={styles.fileList}>
                    {scanFiles.map(f => (
                      <a key={f.id} href={`${API}${f.url}`} target="_blank" rel="noopener noreferrer" className={styles.fileChip}>
                        <Paperclip size={11} /> {f.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {designFiles.length > 0 && (
                <div className={styles.fileGroup}>
                  <div className={styles.fileGroupLabel}>Design Files</div>
                  <div className={styles.fileList}>
                    {designFiles.map(f => (
                      <a key={f.id} href={`${API}${f.url}`} target="_blank" rel="noopener noreferrer" className={`${styles.fileChip} ${styles.designChip}`}>
                        <Paperclip size={11} /> {f.name}
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </main>

        {/* ── Right column: Timeline ── */}
        <aside className={styles.rightCol}>
          <section className={styles.card}>
            <div className={styles.cardTitle}><Clock size={14} /> Timeline</div>
            <div className={styles.timeline}>
              {(c.timeline || []).map((t, i) => (
                <div key={i} className={styles.timelineItem}>
                  <div className={styles.timelineDot} />
                  <div className={styles.timelineContent}>
                    <div className={styles.timelineLabel}>{t.label}</div>
                    {t.info && <div className={styles.timelineInfo}>{t.info}</div>}
                    <div className={styles.timelineTime}>{t.time}</div>
                  </div>
                </div>
              ))}
              {(!c.timeline || c.timeline.length === 0) && (
                <div className={styles.timelineEmpty}>No timeline entries yet.</div>
              )}
            </div>
          </section>
        </aside>
      </div>

      {/* ── Revision Modal ── */}
      {revisionModal && (
        <div className={styles.overlay} onClick={() => setRevisionModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setRevisionModal(false)}><X size={16} /></button>
            <h2 className={styles.modalTitle}>Request Revision</h2>
            <p className={styles.modalSub}>Describe the issue clearly — the designer will see this note with their revision task.</p>
            <textarea
              className={styles.modalTextarea}
              placeholder="E.g. Palatal coverage is too thin, pontic contour doesn't match adjacent teeth…"
              value={revisionReason}
              onChange={e => setRevisionReason(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setRevisionModal(false)}>Cancel</button>
              <button
                className={styles.actionWarn}
                onClick={() => designAction('revise')}
                disabled={!revisionReason.trim() || savingAction}
              >
                <RotateCcw size={14} /> {savingAction ? 'Sending…' : 'Request Revision'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Force Override Modal ── */}
      {forceModal && (
        <div className={styles.overlay} onClick={() => setForceModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setForceModal(false)}><X size={16} /></button>
            <h2 className={styles.modalTitle}><AlertTriangle size={16} style={{color:'#f59e0b'}} /> Force State Override</h2>
            <p className={styles.modalSub}>Bypasses the state machine. Audit-logged with your name. Reason is mandatory.</p>
            <select
              className={styles.modalSelect}
              value={forceData.newStatus}
              onChange={e => setForceData(d => ({ ...d, newStatus: e.target.value }))}
            >
              <option value="">Select target state…</option>
              {ALL_STATUSES.map(s => (
                <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
              ))}
            </select>
            <textarea
              className={styles.modalTextarea}
              placeholder="Reason for override (mandatory)…"
              value={forceData.reason}
              onChange={e => setForceData(d => ({ ...d, reason: e.target.value }))}
              rows={3}
            />
            <div className={styles.modalFooter}>
              <button className={styles.cancelBtn} onClick={() => setForceModal(false)}>Cancel</button>
              <button
                className={styles.forceConfirmBtn}
                onClick={forceOverride}
                disabled={!forceData.newStatus || !forceData.reason.trim() || savingAction}
              >
                <Zap size={14} /> {savingAction ? 'Applying…' : 'Apply Override'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerCaseDetail;
