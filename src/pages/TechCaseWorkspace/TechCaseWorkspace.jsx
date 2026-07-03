import React, { useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ChevronLeft, Send, CheckCircle, Clock, Printer, Package, RotateCcw,
  Play, AlertTriangle, Pause, Hexagon, Upload, Trash2, File, Download,
  ShieldCheck, Truck, Eye, X
} from 'lucide-react';
import STLViewer from '../../components/UI/STLViewer';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import styles from './TechCaseWorkspace.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// ─── Status display map (technician scope only) ───────────────
const STATUS_META = {
  design_approved:    { label: 'Design Approved — Ready to Batch',    color: '#34d399' },
  batched:            { label: 'Batched — Awaiting Print Start',      color: '#60a5fa' },
  printing:           { label: 'Printing (Batch in Progress)',         color: '#a78bfa' },
  printed:            { label: 'Printed — Assign to Ceramist',         color: '#fbbf24' },
  finishing:          { label: 'Ceramist Finishing',                    color: '#c084fc' },
  post_processing:    { label: 'Printing / Milling / Post-Process',    color: '#a78bfa' },
  qa:                 { label: 'Quality Check',                        color: '#fbbf24' },
  ready_for_dispatch: { label: 'Boxed — Awaiting Dispatch',            color: '#60a5fa' },
  payment_pending:    { label: '⚠️ On Hold — Payment Pending',         color: '#f87171' },
  overdue:            { label: '🔴 On Hold — Payment Overdue',         color: '#ef4444' },
  packaged:           { label: 'Packaged',                             color: '#94a3b8' },
  dispatched:         { label: 'Dispatched ✓',                         color: '#10b981' },
  completed:          { label: 'Completed ✓',                          color: '#10b981' },
};

const TechCaseWorkspace = () => {
  const { id } = useParams();
  const { cases, addMessage, assignCase, shipCase, qcRemake,
          uploadDesignFile, deleteDesignFile, transitionCaseStatus } = useCases();
  const { user } = useAuth();

  // ── UI State ──────────────────────────────────────────────────
  const [msgText, setMsgText]           = useState('');
  const [showShipping, setShowShipping] = useState(false);
  const [trackingData, setTrackingData] = useState({ courier: 'DTDC', number: '' });
  const [processing, setProcessing]     = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [dragOver, setDragOver]         = useState(false);

  // QC Gate: all 3 checks must pass before dispatch
  const [qcCheck1, setQcCheck1] = useState(false);
  const [qcCheck2, setQcCheck2] = useState(false);
  const [qcCheck3, setQcCheck3] = useState(false);
  const isQcPassed = qcCheck1 && qcCheck2 && qcCheck3;

  // Pre-Print Production Readiness Checklist (gates "Start Post-Processing")
  const [ppMaterial, setPpMaterial]   = useState(false);
  const [ppShade, setPpShade]         = useState(false);
  const [ppDesign, setPpDesign]       = useState(false);
  const [ppEquipment, setPpEquipment] = useState(false);
  const isPrintReady = ppMaterial && ppShade && ppDesign && ppEquipment;

  const fileInputRef = useRef(null);

  // Always read fresh from context
  const caseData = cases.find(c => c.id === id);

  // ── Action wrapper (prevents double-click races) ──────────────
  const doAction = useCallback(async (fn) => {
    if (processing) return;
    setProcessing(true);
    try { await fn(); } finally {
      setTimeout(() => setProcessing(false), 400);
    }
  }, [processing]);

  // ── File upload ───────────────────────────────────────────────
  const handleFileUpload = useCallback(async (fileList) => {
    if (!caseData || uploading) return;
    setUploading(true);
    try {
      await uploadDesignFile(caseData.id, Array.from(fileList), 'design');
    } finally {
      setUploading(false);
    }
  }, [caseData, uploading, uploadDesignFile]);

  const formatFileSize = bytes => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // ── Workflow actions ──────────────────────────────────────────
  const handleClaimCase = () => doAction(async () => {
    await assignCase(caseData.id, user?.name || 'Technician');
    await addMessage(caseData.id, 'lab', `Case claimed by ${user?.name || 'Technician'}.`);
  });

  const handleStartPostProcessing = () => doAction(async () => {
    const ok = await transitionCaseStatus(caseData.id, 'post_processing', {
      timelineLabel: `🖨️ Post-processing started by ${user?.name}`,
    });
    if (ok) addMessage(caseData.id, 'lab', `Printing / milling started by ${user?.name}.`);
  });

  const handleSendToQA = () => doAction(async () => {
    const ok = await transitionCaseStatus(caseData.id, 'qa', {
      timelineLabel: '🔬 Sent to Quality Check',
    });
    if (ok) addMessage(caseData.id, 'lab', 'Restoration complete — running quality checks.');
  });

  const handlePassQC = () => doAction(async () => {
    if (!isQcPassed) return;
    const ok = await transitionCaseStatus(caseData.id, 'ready_for_dispatch', {
      timelineLabel: '✅ QC Passed — Boxed and ready for dispatch',
    });
    if (ok) addMessage(caseData.id, 'lab', 'Quality check passed. Item boxed and ready for courier.');
  });

  const handleQCFail = () => doAction(async () => {
    const ok = await qcRemake(caseData.id);
    if (ok) addMessage(caseData.id, 'lab', '⚠️ QC failed — returned to post-processing for rework.');
  });

  const handleConfirmDispatch = () => doAction(async () => {
    if (!trackingData.number.trim()) return;
    const ok = await shipCase(caseData.id, trackingData);
    if (ok) {
      addMessage(caseData.id, 'lab', `📦 Dispatched via ${trackingData.courier}. Tracking: ${trackingData.number}`);
      setShowShipping(false);
    }
  });

  const handleSendMessage = () => {
    if (!msgText.trim() || !caseData) return;
    addMessage(caseData.id, 'lab', msgText.trim());
    setMsgText('');
  };

  // ── Early return ──────────────────────────────────────────────
  if (!caseData) {
    return (
      <div className={styles.container}>
        <Link to="/tech" className={styles.backLink}><ChevronLeft size={20} /> Back to Queue</Link>
        <h1 className={styles.title}>Case Not Found</h1>
        <p className={styles.subtitle}>No case with ID "{id}" in your scope.</p>
      </div>
    );
  }

  // ── Derived state ─────────────────────────────────────────────
  const isMyCase    = caseData.assignedTechId === user?.id;
  const isUnassigned = !caseData.assignedTechId;
  const isOtherTech = !isMyCase && !isUnassigned;
  const isDone      = ['dispatched', 'completed', 'archived', 'cancelled'].includes(caseData.status);
  const isHold      = ['payment_pending', 'overdue'].includes(caseData.status);
  const canAct      = (isMyCase || isUnassigned) && !isDone && !processing;

  const meta = STATUS_META[caseData.status] || { label: caseData.status, color: '#94a3b8' };

  // Separate scan files (from dentist) vs design files (from designer)
  const allFiles    = caseData.files || [];
  const scanFiles   = allFiles.filter(f => f.category === 'scan');
  const designFiles = allFiles.filter(f => f.category === 'design');

  // The STL viewer picks the first design file (the approved print file)
  const primaryDesign = designFiles[0] || null;

  // ── Next-action guidance text ──────────────────────────────────
  const nextActionGuide = {
    design_approved:    'Add this case to a print batch from the Production Floor dashboard.',
    batched:            'Case is in a batch. Go to the batch board to start printing.',
    printing:           'Batch is printing. Wait for print to complete.',
    printed:            'Print complete. Assign a ceramist from the batch board.',
    finishing:          'Ceramist is working on staining/glazing. Case will move to QC when done.',
    post_processing:    'Printing / milling in progress. When the physical item is complete, send it to QC.',
    qa:                 'Inspect the restoration. Check margins, contacts, shade, and anatomy. Pass or fail QC.',
    ready_for_dispatch: isHold ? 'DISPATCH LOCKED — awaiting payment clearance from the clinic.' : 'Item is boxed. Enter courier details to dispatch.',
    payment_pending:    'HOLD: Do not dispatch. Waiting for clinic payment confirmation.',
    overdue:            'HOLD: Payment is overdue. Escalate to manager if needed.',
    dispatched:         'Case dispatched. Waiting for delivery confirmation.',
    completed:          'Case complete.',
  };

  return (
    <div className={styles.container}>
      {/* ─── Page Header ─────────────────────────────────── */}
      <header className={styles.pageHeader}>
        <Link to="/tech" className={styles.backButton}>
          <ChevronLeft size={18} /> <span>Production Floor</span>
        </Link>
        <div className={styles.headerMain}>
          <div className={styles.titleGroup}>
            <h1 className={styles.caseId}>{caseData.id}</h1>
            <div className={styles.titleDivider} />
            <h2 className={styles.patientName}>{caseData.type || caseData.caseType?.replace(/_/g, ' ')}</h2>
          </div>
          <div className={styles.statusBadge} style={{ '--status-color': meta.color }}>
            <span className={styles.statusDot} />
            {meta.label}
          </div>
        </div>
      </header>

      {/* ─── Command Bar ─────────────────────────────────── */}
      <section className={styles.commandBar}>
        <div className={styles.commandContent}>
          <div className={styles.commandLeft}>
            <Clock size={18} className={styles.commandIcon} />
            <div className={styles.commandMeta}>
              <span className={styles.commandStatus}>
                {isHold ? '🔴 DISPATCH HOLD ACTIVE' : 'Next Action'}
              </span>
              <span className={styles.commandDetail}>
                {nextActionGuide[caseData.status] || 'No actions required.'}
              </span>
            </div>
          </div>

          <div className={styles.commandRight}>
            {canAct && (
              <div className={styles.actionGroup}>
                {/* Unassigned — claim first */}
                {isUnassigned && (
                  <button className={styles.btnPrimary} onClick={handleClaimCase} disabled={processing}>
                    <Play size={15} /> Claim Case
                  </button>
                )}

                {/* design_approved → Start printing (gated by production checklist) */}
                {isMyCase && caseData.status === 'design_approved' && (
                  <button
                    className={styles.btnAction}
                    onClick={handleStartPostProcessing}
                    disabled={processing || !isPrintReady}
                    title={!isPrintReady ? 'Complete the Production Readiness Checklist first' : undefined}
                  >
                    <Printer size={15} /> Start Post-Processing
                  </button>
                )}

                {/* post_processing → Send to QC */}
                {isMyCase && caseData.status === 'post_processing' && (
                  <button className={styles.btnAction} onClick={handleSendToQA} disabled={processing}>
                    <ShieldCheck size={15} /> Send to QC
                  </button>
                )}

                {/* qa → Pass or Fail */}
                {isMyCase && caseData.status === 'qa' && (
                  <>
                    <button
                      className={styles.btnAction}
                      onClick={handlePassQC}
                      disabled={processing || !isQcPassed}
                      title={!isQcPassed ? 'Complete all QC checks below first' : undefined}
                    >
                      <CheckCircle size={15} /> Pass QC &amp; Box
                    </button>
                    <button className={styles.btnWarning} onClick={handleQCFail} disabled={processing}>
                      <RotateCcw size={15} /> QC Failed — Rework
                    </button>
                  </>
                )}

                {/* ready_for_dispatch → Dispatch (blocked if payment hold) */}
                {isMyCase && caseData.status === 'ready_for_dispatch' && (
                  <>
                    {isHold ? (
                      <span className={styles.holdLabel}><Pause size={14} /> Payment Lock</span>
                    ) : (
                      <button className={styles.btnAction} onClick={() => setShowShipping(true)} disabled={processing}>
                        <Truck size={15} /> Dispatch
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ─── Other-tech banner ────────────────────────────── */}
      {isOtherTech && (
        <div className={styles.alertBanner}>
          <AlertTriangle size={16} />
          <span>Assigned to <strong>{caseData.tech}</strong> — view only.</span>
        </div>
      )}

      {/* ─── Main Grid ───────────────────────────────────── */}
      <div className={styles.dashboardGrid}>

        {/* Left column: files + Rx */}
        <div className={styles.productionCol}>

          {/* Approved Design Files — what the tech actually prints */}
          <div className={`${styles.glassCard} ${styles.designFilesCard}`}>
            <div className={styles.cardHeader}>
              <div className={styles.headerLabel}><Hexagon size={15} /> Approved Design Files</div>
              <span className={styles.fileCount}>{designFiles.length} file{designFiles.length !== 1 ? 's' : ''}</span>
            </div>

            {designFiles.length === 0 ? (
              <div className={styles.emptyFiles}>
                No design files yet — designer hasn't submitted.
              </div>
            ) : (
              <>
                {/* 3D Viewer for first STL/OBJ */}
                {primaryDesign && (
                  <div className={styles.stlContainer}>
                    <STLViewer url={`${API}${primaryDesign.url}?t=${Date.now()}`} filename={primaryDesign.name} />
                  </div>
                )}
                <div className={styles.fileList}>
                  {designFiles.map(f => (
                    <a
                      key={f.id}
                      href={`${API}${f.url}`}
                      download={f.name}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.fileItem}
                      onClick={e => e.stopPropagation()}
                    >
                      <div className={styles.fileInfo}>
                        <File size={15} className={styles.fileIcon} />
                        <div className={styles.fileMeta}>
                          <span className={styles.fileName}>{f.name}</span>
                          <span className={styles.fileSize}>{f.size ? formatFileSize(f.size) : '—'}</span>
                        </div>
                      </div>
                      <Download size={14} className={styles.downloadIcon} />
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Reference Scans (from dentist — read-only for tech) */}
          {scanFiles.length > 0 && (
            <div className={styles.glassCard}>
              <div className={styles.cardHeader}>
                <div className={styles.headerLabel}><Eye size={15} /> Dentist Scans (Reference)</div>
                <span className={styles.fileCount}>{scanFiles.length}</span>
              </div>
              <div className={styles.fileList}>
                {scanFiles.map(f => (
                  <a
                    key={f.id}
                    href={`${API}${f.url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`${styles.fileItem} ${styles.fileReadOnly}`}
                  >
                    <div className={styles.fileInfo}>
                      <File size={15} className={styles.fileIcon} />
                      <div className={styles.fileMeta}>
                        <span className={styles.fileName}>{f.name}</span>
                        <span className={styles.fileSize}>Reference only</span>
                      </div>
                    </div>
                    <Eye size={14} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Prescription Details */}
          <div className={styles.glassCard}>
            <div className={styles.cardHeader}>
              <div className={styles.headerLabel}><AlertTriangle size={15} /> Prescription</div>
            </div>
            <div className={styles.rxGrid}>
              <div className={styles.rxItem}><span className={styles.rxLabel}>Type</span><span className={styles.rxValue}>{caseData.type || '—'}</span></div>
              <div className={styles.rxItem}><span className={styles.rxLabel}>Material</span><span className={styles.rxValue}>{caseData.material || '—'}</span></div>
              <div className={styles.rxItem}><span className={styles.rxLabel}>Shade</span><span className={styles.rxValue}>{caseData.shade || '—'}</span></div>
              <div className={styles.rxItem}><span className={styles.rxLabel}>Arch</span><span className={styles.rxValue}>{caseData.archTarget || 'Single'}</span></div>
              <div className={styles.rxItem}><span className={styles.rxLabel}>Implant System</span><span className={styles.rxValue}>{caseData.implantSystem || 'N/A'}</span></div>
              <div className={styles.rxItem}><span className={styles.rxLabel}>Due</span><span className={styles.rxValue}>{caseData.due || 'TBD'}</span></div>
            </div>
            {caseData.instructions && (
              <div className={styles.instructionArea}>
                <span className={styles.rxLabel}>Doctor's Notes</span>
                <p className={styles.instructionText}>{caseData.instructions}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right column: QC gate, comms, timeline */}
        <div className={styles.oversightCol}>

          {/* Production Readiness Checklist (gates Start Post-Processing when design_approved) */}
          {caseData.status === 'design_approved' && (
            <div className={styles.glassCard} style={{ borderColor: isPrintReady ? 'rgba(52,211,153,0.3)' : 'rgba(96,165,250,0.3)' }}>
              <div className={styles.cardHeader}>
                <div className={styles.headerLabel}><Printer size={15} /> Production Readiness</div>
                <span style={{ fontSize: 12, color: isPrintReady ? '#34d399' : '#60a5fa' }}>
                  {isPrintReady ? '✓ Ready to print' : 'Verify all before starting'}
                </span>
              </div>
              <div className={styles.qcGate}>
                {[
                  { state: ppMaterial,  setState: setPpMaterial,  title: 'Material Confirmed',       sub: `Rx specifies: ${caseData.material || 'Not specified'} — confirm stock available` },
                  { state: ppShade,     setState: setPpShade,     title: 'Shade / Color Verified',   sub: `Rx shade: ${caseData.shade || 'Not specified'} — ingots/discs selected and matched` },
                  { state: ppDesign,    setState: setPpDesign,    title: 'Design File Reviewed',     sub: 'STL loaded in slicer, orientation and supports verified' },
                  { state: ppEquipment, setState: setPpEquipment, title: 'Equipment Ready',          sub: 'Printer/mill calibrated, build plate clean, resin/block loaded' },
                ].map(({ state, setState, title, sub }, i) => (
                  <label key={i} className={`${styles.qcItem} ${state ? styles.qcChecked : ''}`}>
                    <input type="checkbox" checked={state} onChange={e => setState(e.target.checked)} />
                    <div className={styles.qcCheckmark}><CheckCircle size={13} /></div>
                    <div className={styles.qcInfo}>
                      <span className={styles.qcTitle}>{title}</span>
                      <span className={styles.qcSubtitle}>{sub}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* QC Gate (only during qa status) */}
          {caseData.status === 'qa' && (
            <div className={styles.glassCard} style={{ borderColor: isQcPassed ? 'rgba(52,211,153,0.3)' : 'rgba(251,191,36,0.3)' }}>
              <div className={styles.cardHeader}>
                <div className={styles.headerLabel}><ShieldCheck size={15} /> QC Verification Gate</div>
                <span style={{ fontSize: 12, color: isQcPassed ? '#34d399' : '#fbbf24' }}>
                  {isQcPassed ? '✓ All checks passed' : 'Complete all before passing'}
                </span>
              </div>
              <div className={styles.qcGate}>
                {[
                  { state: qcCheck1, setState: setQcCheck1, title: 'Physical Margin Fit', sub: 'Verified on printed cast or die — no gaps, no rocking' },
                  { state: qcCheck2, setState: setQcCheck2, title: 'Contacts & Anatomy',  sub: 'Checked occlusion, proximal contacts, and cusp anatomy' },
                  { state: qcCheck3, setState: setQcCheck3, title: 'Shade & Surface',      sub: 'Stains and glaze match Rx shade — surface smooth' },
                ].map(({ state, setState, title, sub }, i) => (
                  <label key={i} className={`${styles.qcItem} ${state ? styles.qcChecked : ''}`}>
                    <input type="checkbox" checked={state} onChange={e => setState(e.target.checked)} />
                    <div className={styles.qcCheckmark}><CheckCircle size={13} /></div>
                    <div className={styles.qcInfo}>
                      <span className={styles.qcTitle}>{title}</span>
                      <span className={styles.qcSubtitle}>{sub}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Doctor Comms */}
          <div className={`${styles.glassCard} ${styles.chatCard}`}>
            <div className={styles.cardHeader}>
              <div className={styles.headerLabel}><Send size={15} /> Case Communications</div>
            </div>
            <div className={styles.messageStack}>
              {(caseData.messages || []).map((msg, idx) => (
                <div key={idx} className={msg.from === 'lab' ? styles.labMsg : styles.docMsg}>
                  <div className={styles.msgBubble}>
                    <span className={styles.msgAuthor}>{msg.from === 'lab' ? 'Lab Technician' : 'Ordering Doctor'}</span>
                    <p className={styles.msgText}>{msg.text}</p>
                    <span className={styles.msgTime}>{msg.time}</span>
                  </div>
                </div>
              ))}
              {(!caseData.messages || caseData.messages.length === 0) && (
                <div className={styles.emptyComms}>No messages yet.</div>
              )}
            </div>
            <div className={styles.messageInput}>
              <input
                type="text"
                placeholder="Log a message or update..."
                value={msgText}
                onChange={e => setMsgText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(); }}
              />
              <button onClick={handleSendMessage} disabled={!msgText.trim()}><Send size={15} /></button>
            </div>
          </div>

          {/* Production Timeline */}
          <div className={styles.glassCard}>
            <div className={styles.cardHeader}>
              <div className={styles.headerLabel}><Clock size={15} /> Production History</div>
            </div>
            <div className={styles.timelineStack}>
              {(caseData.timeline || []).map((event, i) => (
                <div key={i} className={styles.timelineItem}>
                  <div className={styles.timelineStem} />
                  <div className={styles.timelinePoint} />
                  <div className={styles.timelineEvent}>
                    <span className={styles.eventLabel}>{event.label}</span>
                    {event.info && <span className={styles.eventInfo}>{event.info}</span>}
                    <span className={styles.eventTime}>{event.time}</span>
                  </div>
                </div>
              ))}
              {(!caseData.timeline || caseData.timeline.length === 0) && (
                <div className={styles.emptyTimeline}>No timeline entries.</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Dispatch Modal ───────────────────────────────── */}
      {showShipping && (
        <div className={styles.modalOverlay} onClick={() => setShowShipping(false)}>
          <div className={styles.glassCard} style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setShowShipping(false)}><X size={18} /></button>
            <h3 className={styles.modalTitle}>Confirm Dispatch</h3>
            <p className={styles.modalText}>Enter courier details for Case <strong>{caseData.id}</strong>. This is irreversible.</p>
            <div className={styles.shippingForm}>
              <div className={styles.inputGroup}>
                <label>Courier</label>
                <select value={trackingData.courier} onChange={e => setTrackingData({ ...trackingData, courier: e.target.value })}>
                  <option value="DTDC">DTDC</option>
                  <option value="BlueDart">BlueDart</option>
                  <option value="Delhivery">Delhivery</option>
                  <option value="FedEx">FedEx</option>
                  <option value="DHL">DHL</option>
                  <option value="Hand Delivery">Hand Delivery</option>
                </select>
              </div>
              <div className={styles.inputGroup}>
                <label>Tracking Number / AWB</label>
                <input
                  type="text"
                  value={trackingData.number}
                  onChange={e => setTrackingData({ ...trackingData, number: e.target.value })}
                  placeholder="e.g. 1234567890"
                  autoFocus
                />
              </div>
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnOutline} onClick={() => setShowShipping(false)}>Cancel</button>
              <button
                className={styles.btnSuccess}
                onClick={handleConfirmDispatch}
                disabled={!trackingData.number.trim() || processing}
              >
                <Truck size={15} /> {processing ? 'Dispatching…' : 'Confirm Dispatch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TechCaseWorkspace;
