import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Upload, AlertOctagon, CheckCircle, ChevronLeft, Paperclip, MessageSquare, Send, X, Clock } from 'lucide-react';
import styles from './DesignerWorkspace.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const DesignerWorkspace = () => {
  const { id } = useParams(); // This is the customId based on routing
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [blockReason, setBlockReason] = useState('');
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState('');
  const [showUnclaimModal, setShowUnclaimModal] = useState(false);
  const [unclaimReason, setUnclaimReason] = useState('');
  const [channelMsg, setChannelMsg] = useState('');
  const [sendingMsg, setSendingMsg] = useState(false);
  const [sharingPlan, setSharingPlan] = useState(false);
  const fileInputRef = useRef(null);
  const planInputRef = useRef(null);

  const token = sessionStorage.getItem('hesyra_token');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const fetchCase = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/designer/cases/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Access denied or case not found');
      setCaseData(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchCase(); }, [fetchCase]);

  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));
    formData.append('category', 'design');

    try {
      const res = await fetch(`${API}/api/designer/cases/${id}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (res.ok) { showToast('Files uploaded successfully ✓'); await fetchCase(); }
      else showToast('Upload failed');
    } catch (err) {
      console.error('Upload failed:', err);
      showToast('Upload error');
    } finally {
      setUploading(false);
    }
  };

  // ─── Direct channel with the dentist (aligner cases) ──────────
  const sendToDentist = async () => {
    const text = channelMsg.trim();
    if (!text) return;
    setSendingMsg(true);
    try {
      const res = await fetch(`${API}/api/designer/cases/${id}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setChannelMsg('');
        await fetchCase();
      } else {
        // Surface the server's reason rather than a generic failure —
        // "aligner cases only" is actionable, "Send failed" is not.
        const body = await res.json().catch(() => ({}));
        showToast(body.error || 'Message not sent');
      }
    } catch {
      showToast('Message not sent');
    } finally {
      setSendingMsg(false);
    }
  };

  const shareTreatmentPlan = async (files) => {
    if (!files || files.length === 0) return;
    setSharingPlan(true);
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));

    try {
      const res = await fetch(`${API}/api/designer/cases/${id}/treatment-plan`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast('Shared with the clinic ✓');
        await fetchCase();
      } else {
        showToast(body.error || 'Could not share that file');
      }
    } catch {
      showToast('Could not share that file');
    } finally {
      setSharingPlan(false);
    }
  };

  const markDesignReady = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/designer/cases/${id}/design-ready`, {
        method: 'PUT',
        headers,
      });
      if (res.ok) { showToast('Design submitted ✓'); await fetchCase(); }
      else showToast('Failed to submit design');
    } finally {
      setSaving(false);
    }
  };

  const blockCase = async () => {
    if (!blockReason.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/designer/cases/${id}/block`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ reason: blockReason }),
      });
      setShowBlockModal(false);
      setBlockReason('');
      if (res.ok) { showToast('Case blocked ✓'); await fetchCase(); }
      else showToast('Failed to block case');
    } finally {
      setSaving(false);
    }
  };

  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/designer/cases/${id}/notes`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ note }),
      });
      setNote('');
      if (res.ok) { showToast('Note added ✓'); await fetchCase(); }
      else showToast('Failed to add note');
    } finally {
      setSaving(false);
    }
  };

  // Fix #11: Unclaim handler — only available within 15min for self-selected cases
  const handleUnclaim = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/pool/cases/${id}/unclaim`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ reason: unclaimReason }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowUnclaimModal(false);
        showToast('Case returned to pool. Redirecting...');
        setTimeout(() => navigate('/designer/pool'), 1500);
      } else {
        showToast(data.error || 'Could not unclaim case');
        setShowUnclaimModal(false);
      }
    } catch {
      showToast('Network error during unclaim');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className={styles.center}>Loading workspace…</div>;
  if (error)   return <div className={styles.center} style={{ color: '#ef4444' }}>{error}</div>;
  if (!caseData) return null;

  const c = caseData;
  const isReadOnly  = ['design_approved', 'post_processing', 'qa', 'dispatched', 'completed'].includes(c.status);
  const isBlocked   = c.status === 'blocked';
  const isRevision  = c.status === 'design_revision';
  const canSubmit   = ['cad_assigned', 'design_revision', 'designing'].includes(c.status);
  // Treatment plans are also uploaded by the designer, so they have to
  // be excluded explicitly — otherwise a shared video shows up in the
  // list of design files the submit button counts.
  const planFiles   = (c.files || []).filter(f => f.category === 'treatment_plan');
  const designFiles = (c.files || []).filter(f =>
    f.category !== 'treatment_plan' && (f.category === 'design' || f.uploadedBy === 'cad_designer'));
  const scanFiles   = (c.files || []).filter(f => f.category === 'scan');

  // Fix #11: Unclaim is only possible for self-selected cases within 15-minute window
  const canUnclaim = (
    c.assignmentMethod === 'self_select' &&
    c.status === 'cad_assigned' &&
    c.claimedAt &&
    (Date.now() - new Date(c.claimedAt).getTime()) < 15 * 60 * 1000
  );
  const minutesSinceClaim = c.claimedAt
    ? Math.floor((Date.now() - new Date(c.claimedAt).getTime()) / 60000)
    : null;

  return (
    <div className={styles.workspace}>
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* ─── Top bar ─── */}
      <header className={styles.topBar}>
        <button className={styles.backBtn} onClick={() => navigate('/designer')}>
          <ChevronLeft size={18} /> Queue
        </button>
        <div className={styles.caseId}>{c.customId}</div>
        <div className={styles.statusBadge} data-status={c.status}>
          {c.status?.replace(/_/g, ' ')}
        </div>
        {c.priorityFlag && <span className={styles.priorityChip}>⚡ Priority</span>}
      </header>

      <div className={styles.body}>
        {/* ─── Left: Case info ─── */}
        <aside className={styles.sidePanel}>
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>Case Type</div>
            <div className={styles.panelValue}>{c.caseType?.replace(/_/g, ' ') || '—'}</div>
          </div>
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>Shade</div>
            <div className={styles.panelValue}>{c.shade || '—'}</div>
          </div>
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>Arch</div>
            <div className={styles.panelValue}>{c.archTarget || '—'}</div>
          </div>
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>Teeth</div>
            <div className={styles.panelValue}>
              {Array.isArray(c.toothNumbers) ? c.toothNumbers.join(', ') : c.toothNumbers || '—'}
            </div>
          </div>
          {c.implantSystem && (
            <div className={styles.panelSection}>
              <div className={styles.panelLabel}>Implant System</div>
              <div className={styles.panelValue}>{c.implantSystem}</div>
            </div>
          )}
          <div className={styles.panelSection}>
            <div className={styles.panelLabel}>Instructions</div>
            <div className={`${styles.panelValue} ${styles.instructions}`}>{c.instructions || 'None'}</div>
          </div>

          {/* Scan files */}
          {scanFiles.length > 0 && (
            <div className={styles.panelSection}>
              <div className={styles.panelLabel}>Scan Files ({scanFiles.length})</div>
              <div className={styles.fileList}>
                {scanFiles.map(f => (
                  <a key={f.id} href={`${API}${f.url}`} target="_blank" rel="noopener noreferrer" className={styles.fileChip}>
                    <Paperclip size={12} /> {f.name}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Revision note */}
          {isRevision && c.rejectionReason && (
            <div className={styles.revisionAlert}>
              <AlertOctagon size={16} />
              <div>
                <strong>Revision requested</strong>
                <p>{c.rejectionReason}</p>
              </div>
            </div>
          )}
        </aside>

        {/* ─── Main: Upload zone + design files ─── */}
        <main className={styles.mainPanel}>
          {/* Upload zone */}
          {!isReadOnly && (
            <div
              className={`${styles.uploadZone} ${dragOver ? styles.uploadDragOver : ''} ${uploading ? styles.uploadBusy : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleUpload(e.dataTransfer.files); }}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".stl,.ply,.obj,.zip,.png,.jpg,.jpeg,.pdf"
                onChange={e => handleUpload(e.target.files)}
                style={{ display: 'none' }}
              />
              <Upload size={36} className={styles.uploadIcon} />
              <div className={styles.uploadText}>
                {uploading ? 'Uploading…' : 'Drop design files here or click to browse'}
              </div>
              <div className={styles.uploadHint}>STL, PLY, OBJ, ZIP, PNG, PDF — max 100MB each</div>
            </div>
          )}

          {/* Uploaded design files */}
          {designFiles.length > 0 && (
            <div className={styles.designFileSection}>
              <div className={styles.designFileHeader}>
                <Paperclip size={14} /> Uploaded Design Files ({designFiles.length})
              </div>
              <div className={styles.designFileGrid}>
                {designFiles.map(f => (
                  <a key={f.id} href={`${API}${f.url}`} target="_blank" rel="noopener noreferrer" className={styles.designFileCard}>
                    <div className={styles.designFileIcon}>3D</div>
                    <div className={styles.designFileName}>{f.name}</div>
                    <div className={styles.designFileSize}>{(f.size / 1024).toFixed(0)} KB</div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* ══════ DIRECT CHANNEL WITH THE DENTIST ══════
              Aligner cases only. The plan is negotiated over several
              rounds, so the designer talks to the dentist directly
              rather than relaying through the lab. */}
          {c.directChannel && (
            <div className={styles.channelSection}>
              <div className={styles.channelHeader}>
                <span className={styles.designFileHeader}>
                  <MessageSquare size={14} /> {c.doctorName ? `Direct line — ${c.doctorName}` : 'Direct line to the clinic'}
                </span>
                <span className={styles.channelNote}>The dentist sees these messages on their case.</span>
              </div>

              {/* Treatment plan — what the dentist is being asked to approve */}
              <div className={styles.planBlock}>
                <div className={styles.planHeader}>
                  <span>Treatment plan{planFiles.length ? ` · ${planFiles.length}` : ''}</span>
                  <button
                    className={styles.planUploadBtn}
                    onClick={() => planInputRef.current?.click()}
                    disabled={sharingPlan}
                  >
                    <Upload size={13} /> {sharingPlan ? 'Sharing…' : 'Share video or photo'}
                  </button>
                  <input
                    ref={planInputRef}
                    type="file"
                    multiple
                    accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                    hidden
                    onChange={e => { shareTreatmentPlan(e.target.files); e.target.value = ''; }}
                  />
                </div>

                {planFiles.length === 0 ? (
                  <p className={styles.planEmpty}>
                    Nothing shared yet. A short video of the staged movement explains a plan
                    faster than any amount of typing.
                  </p>
                ) : (
                  <div className={styles.planGrid}>
                    {planFiles.map(f => (
                      <a
                        key={f.id}
                        href={`${API}${f.url}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.planCard}
                      >
                        <span className={styles.planKind}>
                          {f.mimetype?.startsWith('video/') ? 'VIDEO' : 'IMAGE'}
                        </span>
                        <span className={styles.planName}>{f.name}</span>
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {/* Conversation */}
              <div className={styles.channelThread}>
                {(c.messages || []).length === 0 ? (
                  <p className={styles.planEmpty}>No messages yet.</p>
                ) : (
                  c.messages.map(m => (
                    <div
                      key={m.id}
                      className={m.from === 'designer' ? styles.msgMine : styles.msgTheirs}
                    >
                      <div className={styles.msgMeta}>
                        {m.from === 'designer' ? 'You' : (m.authorName || 'Clinic')} · {m.time}
                      </div>
                      <div className={styles.msgText}>{m.text}</div>
                    </div>
                  ))
                )}
              </div>

              <div className={styles.noteInput}>
                <textarea
                  placeholder="Message the dentist about this plan…"
                  value={channelMsg}
                  onChange={e => setChannelMsg(e.target.value)}
                  rows={2}
                  disabled={sendingMsg}
                />
                <button
                  className={styles.noteSubmit}
                  onClick={sendToDentist}
                  disabled={!channelMsg.trim() || sendingMsg}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          )}

          {/* Note */}
          <div className={styles.noteSection}>
            <div className={styles.designFileHeader}><MessageSquare size={14} /> Add Internal Note</div>
            <div className={styles.noteInput}>
              <textarea
                placeholder="Log a note about this case (visible to managers and technicians)..."
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                disabled={saving}
              />
              <button className={styles.noteSubmit} onClick={addNote} disabled={!note.trim() || saving}>
                <Send size={14} />
              </button>
            </div>
          </div>

          {/* Timeline - Designer View */}
          <div className={styles.noteSection} style={{ marginTop: '1.5rem' }}>
            <div className={styles.designFileHeader}><Clock size={14} /> Timeline</div>
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
                <div className={styles.timelineEmpty}>No entries yet.</div>
              )}
            </div>
          </div>

          {/* Actions */}
          {!isReadOnly && !isBlocked && (
            <div className={styles.actions}>
              {/* Fix #11: Unclaim button — only visible within 15min for self-claimed cases */}
              {canUnclaim && (
                <button
                  className={styles.unclaimBtn}
                  onClick={() => setShowUnclaimModal(true)}
                  title={`You have ${15 - minutesSinceClaim}min left to return this case to the pool`}
                >
                  ↩ Return to Pool ({15 - minutesSinceClaim}m left)
                </button>
              )}
              <button
                className={styles.blockBtn}
                onClick={() => setShowBlockModal(true)}
              >
                <AlertOctagon size={16} /> Flag as Blocked
              </button>
              {canSubmit && designFiles.length > 0 && (
                <button
                  className={styles.submitBtn}
                  onClick={markDesignReady}
                  disabled={saving}
                >
                  <CheckCircle size={16} /> {saving ? 'Submitting…' : 'Submit Design for Review'}
                </button>
              )}
            </div>
          )}

          {isBlocked && (
            <div className={styles.blockedBanner}>
              <AlertOctagon size={18} />
              <span>This case is blocked. A manager has been notified and will reassign or resolve the scan issue.</span>
            </div>
          )}
        </main>
      </div>

      {/* ─── Block modal ─── */}
      {showBlockModal && (
        <div className={styles.modalOverlay} onClick={() => setShowBlockModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setShowBlockModal(false)}><X size={18} /></button>
            <h2 className={styles.modalTitle}>Block Case</h2>
            <p className={styles.modalSub}>Describe the issue so the manager can resolve it (scan quality, missing files, etc.).</p>
            <textarea
              className={styles.blockInput}
              placeholder="Describe the blocking issue..."
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
              rows={4}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setShowBlockModal(false)}>Cancel</button>
              <button className={styles.confirmBlockBtn} onClick={blockCase} disabled={!blockReason.trim() || saving}>
                {saving ? 'Flagging…' : 'Confirm Block'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Unclaim modal ─── */}
      {showUnclaimModal && (
        <div className={styles.modalOverlay} onClick={() => setShowUnclaimModal(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setShowUnclaimModal(false)}><X size={18} /></button>
            <h2 className={styles.modalTitle}>Return Case to Pool?</h2>
            <p className={styles.modalSub}>
              This will return the case to the open pool so another designer can claim it.
              You have {15 - minutesSinceClaim} minute(s) left in your unclaim window.
            </p>
            <textarea
              className={styles.blockInput}
              placeholder="Optional: reason for returning (helps the team)..."
              value={unclaimReason}
              onChange={e => setUnclaimReason(e.target.value)}
              rows={3}
              autoFocus
            />
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={() => setShowUnclaimModal(false)}>Keep Case</button>
              <button
                className={styles.unclaimConfirmBtn}
                onClick={handleUnclaim}
                disabled={saving}
              >
                {saving ? 'Returning…' : 'Yes, Return to Pool'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DesignerWorkspace;
