import React, { useState, useCallback } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { ChevronLeft, MessageSquare, Download, CheckCircle, Clock, Send, 
  AlertTriangle, FileCheck, Package, Truck, Archive } from 'lucide-react';
import STLViewer from '../../components/UI/STLViewer';
import PaymentBanner from '../../components/UI/PaymentBanner';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import styles from './CaseDetails.module.css';

const STATUS_LABEL = {
  draft: 'Draft', 
  submitted: 'Submitted — Awaiting Lab', 
  cad_assigned: 'In Design (CAD)',
  design_ready: 'Design Under Lab Review',
  awaiting_doctor_approval: 'Awaiting Your Approval',
  design_revision: 'Design Revision in Progress',
  design_approved: 'Design Approved — Production Starting',
  designing: 'Designing (CAD)',
  blocked: 'Case Blocked — Awaiting Info',
  post_processing: 'In Production — Printing / Milling', 
  qa: 'Quality Check',
  ready_for_dispatch: 'Ready for Dispatch',
  payment_pending: 'Payment Pending',
  overdue: 'Payment Overdue',
  packaged: 'Packaged — Awaiting Dispatch',
  dispatched: 'Dispatched — In Transit',
  shipped: 'Dispatched', 
  action_required: 'Action Required',
  pending_approval: 'Pending Your Approval',
  printing: 'Printing / Post-Process',
  completed: 'Delivered',
  archived: 'Archived',
  cancelled: 'Cancelled',
};

// Mirrors the dashboard's pipeline model so both views describe
// progress identically.
const STAGES = ['Submitted', 'Design', 'Approved', 'Production', 'Dispatched'];
const STAGE_OF = {
  draft: 0, submitted: 0, action_required: 0,
  cad_assigned: 1, designing: 1, design_ready: 1, design_revision: 1, blocked: 1,
  awaiting_doctor_approval: 1, pending_approval: 1,
  design_approved: 2,
  batched: 3, printing: 3, printed: 3, finishing: 3, post_processing: 3, qa: 3,
  ready_for_dispatch: 3, payment_pending: 3, overdue: 3, packaged: 3,
  dispatched: 4, shipped: 4, completed: 4,
};

const STATUS_COLOR = {
  draft: '#94a3b8',
  submitted: '#60a5fa',
  cad_assigned: '#fde68a',
  design_ready: '#c4b5fd',
  awaiting_doctor_approval: '#c4b5fd',
  design_revision: '#fbbf24',
  design_approved: '#34d399',
  designing: '#fde68a',
  blocked: '#f87171',
  post_processing: '#a78bfa',
  qa: '#fbbf24',
  ready_for_dispatch: '#3b82f6',
  payment_pending: '#3b82f6',
  overdue: '#ef4444',
  packaged: '#94a3b8',
  dispatched: '#34d399',
  shipped: '#34d399',
  action_required: '#fbbf24',
  pending_approval: '#c4b5fd',
  printing: '#a78bfa',
  completed: '#10b981',
  archived: '#64748b',
  cancelled: '#ef4444',
};

const CaseDetails = () => {
  const { id } = useParams();
  const { cases, addMessage, approveDesign, requestDesignChanges, 
    resubmitCase, markCompleted, updateCaseStatus } = useCases();
  const { user } = useAuth();
  const [msgText, setMsgText] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  // A long case runs to a dozen timeline rows; what a doctor wants on
  // arrival is what just happened, not the whole history.
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const [showAllRx, setShowAllRx] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);

  // Read directly from cases array — guarantees re-render on ANY case state change
  const caseData = cases.find(c => c.id === id);

  // Treatment plan media the designer shared for the dentist to watch.
  // Distinct from `design` files, which are lab working files.
  const treatmentPlan = (caseData?.files || []).filter(f => f.category === 'treatment_plan');
  const hasDesignerChannel = (caseData?.messages || []).some(m => m.from === 'designer')
    || treatmentPlan.length > 0;

  // Who a message is from, in the dentist's own terms. The designer is
  // named because on an aligner case they are the person whose judgement
  // is being discussed; the rest of the lab stays collective.
  const senderLabel = (msg) => {
    if (msg.from === 'doctor') return 'You';
    if (msg.from === 'designer') return msg.authorName ? `${msg.authorName} · Designer` : 'Your designer';
    if (msg.from === 'manager') return msg.authorName || 'Lab manager';
    return 'Hesyra Lab';
  };

  const doAction = useCallback((fn) => {
    if (processing) return;
    setProcessing(true);
    try { fn(); } finally {
      setTimeout(() => setProcessing(false), 300);
    }
  }, [processing]);

  if (!caseData) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <Link to="/" className={styles.backLink}><ChevronLeft size={20} /> Back to Dashboard</Link>
          <h1 className={styles.title}>Case Not Found</h1>
          <p className={styles.subtitle}>No case exists with ID "{id}". It may have been removed or the link is incorrect.</p>
        </header>
      </div>
    );
  }

  // Security check: a clinic should only see their own clinic's cases
  if (user?.role === 'clinic' && caseData.clinic !== user.clinic) {
    return <Navigate to="/" replace />;
  }

  if (caseData.status === 'draft') {
    return <Navigate to={`/new-case/${caseData.id}`} replace />;
  }

  const handleSendMessage = () => {
    if (!msgText.trim()) return;
    addMessage(caseData.id, 'doctor', msgText.trim());
    setMsgText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleApproveDesign = () => doAction(() => {
    const ok = approveDesign(caseData.id);
    if (ok) addMessage(caseData.id, 'doctor', '✅ Digital design approved for printing.');
  });

  const handleRequestChanges = () => doAction(() => {
    if (!rejectReason.trim()) return;
    const ok = requestDesignChanges(caseData.id, rejectReason.trim());
    if (ok) {
      addMessage(caseData.id, 'doctor', `Requested changes: ${rejectReason.trim()}`);
      setRejectReason('');
      setShowRejectInput(false);
    }
  });

  const handleResubmit = () => doAction(() => {
    const ok = resubmitCase(caseData.id);
    if (ok) addMessage(caseData.id, 'doctor', 'Updated scans/information uploaded. Case resubmitted for lab review.');
  });

  const handleMarkCompleted = () => doAction(() => {
    const ok = markCompleted(caseData.id);
    if (ok) addMessage(caseData.id, 'doctor', '✅ Case received and completed. Thank you!');
  });

  const handleArchive = () => doAction(() => {
    updateCaseStatus(caseData.id, 'archived');
  });

  const statusColor = STATUS_COLOR[caseData.status] || '#94a3b8';
  const stageIndex = STAGE_OF[caseData.status] ?? 0;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Link to="/" className={styles.backLink}>
            <ChevronLeft size={20} /> Back to Dashboard
          </Link>
          <span className={styles.statusBadge} style={{ color: statusColor, borderColor: statusColor }}>
            {STATUS_LABEL[caseData.status] || caseData.status}
          </span>
        </div>
        {/* Patient leads — it is what a clinician identifies a case by.
            The lab reference is secondary, not the headline. */}
        <h1 className={styles.title}>{caseData.patient}</h1>
        <p className={styles.subtitle}>
          <span className={styles.caseRef} title={caseData.id}>{caseData.id}</span>
          <span className={styles.sep} />
          {caseData.type}
          {caseData.received && <><span className={styles.sep} />Submitted {caseData.received}</>}
          {caseData.warrantyYears > 0 && (
            <><span className={styles.sep} />{caseData.warrantyYears}-year warranty</>
          )}
        </p>

        {/* Same five-milestone track as the dashboard, so the two views
            speak the same language about where a case has got to. */}
        <div className={styles.track} aria-label={`Stage ${stageIndex + 1} of ${STAGES.length}`}>
          {STAGES.map((label, i) => (
            <span key={label}
              className={`${styles.step} ${i < stageIndex ? styles.stepDone : ''} ${i === stageIndex ? styles.stepNow : ''}`}>
              <span className={styles.stepBar} />
              <span className={styles.stepLabel}>{label}</span>
            </span>
          ))}
        </div>
      </header>

      {/* The one thing this case needs from the doctor, at the top.
          These controls existed but sat far down the page — on a case
          awaiting approval you had to scroll past a 3D viewer to find
          the button the whole case is waiting on. */}
      {(() => {
        const hoursLeft = caseData.doctorApprovalDueAt
          ? Math.round((new Date(caseData.doctorApprovalDueAt) - Date.now()) / 3600000)
          : null;

        const bars = {
          awaiting_doctor_approval: {
            tone: 'action',
            title: 'Your approval is needed before this prints',
            note: hoursLeft === null ? null
              : hoursLeft > 0
                ? `${hoursLeft}h left. If we don't hear from you the lab proceeds with this design so your case isn't delayed.`
                : 'The approval window has closed — the lab will resolve this shortly.',
            actions: (
              <>
                <button className={styles.barPrimary} onClick={handleApproveDesign} disabled={processing}>
                  Approve design
                </button>
                <button className={styles.barGhost} onClick={() => setShowRejectInput(true)} disabled={processing}>
                  Request changes
                </button>
              </>
            ),
          },
          action_required: {
            tone: 'warn',
            title: 'The lab needs something from you',
            note: caseData.rejectionReason || 'Review this case and upload new files or instructions.',
            actions: null,
          },
          dispatched: {
            tone: 'info',
            title: 'On its way to your clinic',
            note: caseData.trackingNumber
              ? `${caseData.trackingCourier} · ${caseData.trackingNumber}`
              : null,
            actions: (
              <button className={styles.barPrimary} onClick={handleMarkCompleted} disabled={processing}>
                Confirm receipt
              </button>
            ),
          },
        };
        bars.pending_approval = bars.awaiting_doctor_approval;
        bars.shipped = bars.dispatched;

        const bar = bars[caseData.status];
        if (!bar) return null;

        return (
          <section className={`${styles.actionBar} ${styles[bar.tone]}`}>
            <div className={styles.actionBarText}>
              <span className={styles.actionBarTitle}>{bar.title}</span>
              {bar.note && <span className={styles.actionBarNote}>{bar.note}</span>}
            </div>
            {bar.actions && <div className={styles.actionBarButtons}>{bar.actions}</div>}
          </section>
        );
      })()}

      <div className={styles.layout}>
        <div className={styles.mainColumn}>

          {/* ══════ PAYMENT BANNER ══════ */}
          {['ready_for_dispatch', 'payment_pending', 'overdue'].includes(caseData.status) && (
            <PaymentBanner
              caseData={caseData}
              onPaymentComplete={() => {}}
            />
          )}

          {/* ══════ ACTION REQUIRED BANNER ══════ */}
          {caseData.status === 'action_required' && (
            <div className={styles.actionWarning}>
              <AlertTriangle size={24} style={{ color: '#fbbf24', flexShrink: 0, marginTop: '2px' }} />
              <div style={{flex: 1}}>
                <h3 style={{margin: '0 0 4px', color: '#fbbf24', fontSize: '16px'}}>Lab Requires Your Attention</h3>
                <p style={{margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5}}>
                  {caseData.rejectionReason || 'Please review this case and upload new files or instructions.'}
                </p>
                <div style={{display: 'flex', gap: '8px'}}>
                  <input 
                    type="file" 
                    id="mockScans" 
                    style={{display: 'none'}} 
                    onChange={(e) => {
                      if (e.target.files.length > 0) {
                        handleResubmit();
                      }
                    }}
                  />
                  <button 
                    className={styles.btnWarningOutline}
                    onClick={() => document.getElementById('mockScans').click()}
                    disabled={processing}
                  >
                    Upload New Scans & Resubmit
                  </button>
                  <button
                    className={styles.btnSecondaryOutline}
                    onClick={() => {
                      handleResubmit();
                    }}
                    disabled={processing}
                  >
                    Resubmit Without Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════ PENDING APPROVAL BANNER ══════ */}
          {(caseData.status === 'awaiting_doctor_approval' || caseData.status === 'pending_approval') && (
            <div className={styles.actionWarning} style={{background: 'rgba(122, 156, 150, 0.1)', borderColor: 'var(--brand-bioceramic)'}}>
              <FileCheck size={24} style={{ color: 'var(--brand-bioceramic)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{flex: 1}}>
                <h3 style={{margin: '0 0 4px', color: 'var(--brand-bioceramic)', fontSize: '16px'}}>Digital Wax-Up Ready for Approval</h3>
                <p style={{margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5}}>
                  The lab has completed the 3D design. Please review the uploaded design files below and approve or request changes.
                </p>

                {/* Deadline — the case does not wait indefinitely */}
                {caseData.doctorApprovalDueAt && (() => {
                  const dueAt = new Date(caseData.doctorApprovalDueAt);
                  const hoursLeft = Math.round((dueAt.getTime() - Date.now()) / 3600000);
                  const overdue = hoursLeft <= 0;
                  return (
                    <p style={{
                      margin: '0 0 12px', fontSize: '12.5px', lineHeight: 1.5,
                      padding: '8px 12px', borderRadius: '10px',
                      background: overdue ? 'rgba(239,68,68,0.10)' : 'rgba(251,191,36,0.10)',
                      border: `1px solid ${overdue ? 'rgba(239,68,68,0.35)' : 'rgba(245,158,11,0.35)'}`,
                      // Tint carries the urgency; the text has to stay
                      // readable in both the light and dark themes.
                      color: 'var(--text-primary)',
                    }}>
                      <Clock size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                      {overdue
                        ? 'This approval is past its deadline and will be resolved by the lab shortly.'
                        : <>Please respond within <strong>{hoursLeft}h</strong> (by {dueAt.toLocaleString('en-IN')}). If we don’t hear from you, the lab proceeds with this design so your case isn’t delayed.</>}
                    </p>
                  );
                })()}

                {/* Show uploaded design files from lab */}
                {(() => {
                  const designFiles = (caseData.files || []).filter(f => f.category === 'design');
                  if (designFiles.length === 0) return null;
                  return (
                    <div style={{margin: '0 0 12px', display: 'flex', flexDirection: 'column', gap: '6px'}}>
                      {designFiles.map(file => (
                        <div key={file.id} style={{display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 12px', background: 'rgba(0,0,0,0.15)', borderRadius: '10px', border: '1px solid var(--glass-border)'}}>
                          <Download size={14} style={{color: 'var(--brand-bioceramic)', flexShrink: 0}} />
                            <a
                              href={file.url}
                              target="_blank"
                            rel="noopener noreferrer"
                            style={{color: '#fff', fontSize: '13px', fontWeight: 600, textDecoration: 'none', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}
                          >
                            {file.name}
                          </a>
                          <span style={{fontSize: '11px', color: 'var(--text-tertiary)', flexShrink: 0}}>
                            {file.size < 1024 * 1024 ? (file.size / 1024).toFixed(1) + ' KB' : (file.size / (1024 * 1024)).toFixed(1) + ' MB'}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                
                {showRejectInput ? (
                  <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                    <textarea 
                      placeholder="Explain what changes are needed..." 
                      rows="2" 
                      style={{width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)', color: 'white', fontFamily: 'inherit'}}
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                    />
                    <div style={{display: 'flex', gap: '8px'}}>
                      <button className={styles.btnSecondaryOutline} onClick={() => setShowRejectInput(false)}>Cancel</button>
                      <button className={styles.btnWarningOutline} onClick={handleRequestChanges} disabled={!rejectReason.trim() || processing}>
                        Submit Change Request
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{display: 'flex', gap: '8px'}}>
                    <button className={styles.btnSuccessFill} onClick={handleApproveDesign} disabled={processing}>
                      <CheckCircle size={16} /> Approve for Printing
                    </button>
                    <button className={styles.btnSecondaryOutline} onClick={() => setShowRejectInput(true)} disabled={processing}>
                      Request Changes
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ══════ SHIPPED BANNER ══════ */}
          {caseData.status === 'shipped' && (
            <div className={styles.actionWarning} style={{background: 'rgba(52, 211, 153, 0.06)', borderColor: 'rgba(52, 211, 153, 0.3)'}}>
              <Truck size={24} style={{ color: '#34d399', flexShrink: 0, marginTop: '2px' }} />
              <div style={{flex: 1}}>
                <h3 style={{margin: '0 0 4px', color: '#34d399', fontSize: '16px'}}>Case Shipped — In Transit</h3>
                <p style={{margin: '0 0 4px', fontSize: '13px', color: 'var(--text-secondary)'}}>
                  {(caseData.trackingCourier || caseData.tracking?.courier)
                    ? `Shipped via ${caseData.trackingCourier || caseData.tracking.courier}. Tracking: ${caseData.trackingNumber || caseData.tracking?.number}`
                    : 'Shipment details not yet available.'
                  }
                </p>
                <p style={{margin: '0 0 12px', fontSize: '12px', color: 'var(--text-tertiary)'}}>
                  Once you receive the package, confirm delivery below.
                </p>
                <div style={{display: 'flex', gap: '8px'}}>
                  <button className={styles.btnSuccessFill} onClick={handleMarkCompleted} disabled={processing}>
                    <Package size={16} /> Confirm Delivery — Mark Complete
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ══════ COMPLETED BANNER ══════ */}
          {caseData.status === 'completed' && (
            <div className={styles.actionWarning} style={{background: 'rgba(16, 185, 129, 0.06)', borderColor: 'rgba(16, 185, 129, 0.3)'}}>
              <CheckCircle size={24} style={{ color: '#10b981', flexShrink: 0, marginTop: '2px' }} />
              <div style={{flex: 1}}>
                <h3 style={{margin: '0 0 4px', color: '#10b981', fontSize: '16px'}}>Case Completed ✓</h3>
                <p style={{margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)'}}>
                  This case has been delivered and marked as complete.
                </p>
                <button className={styles.btnSecondaryOutline} onClick={handleArchive} disabled={processing}>
                  <Archive size={14} /> Move to Archive
                </button>
              </div>
            </div>
          )}


          {/* ══════ PRESCRIPTION ══════ */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Prescription Details</h2>
            <div className={styles.detailsGrid}>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Case Type</span>
                <span className={styles.detailValue}>{caseData.caseType?.replace('_', ' & ') || 'N/A'}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Material</span>
                <span className={styles.detailValue}>{caseData.material}</span>
              </div>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Shade</span>
                <span className={styles.detailValue}>{caseData.shade}</span>
              </div>
              {caseData.toothNumbers && caseData.toothNumbers.length > 0 && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Tooth Number(s)</span>
                  <span className={styles.detailValue}>{caseData.toothNumbers.join(', ')}</span>
                </div>
              )}
              {/* The price was nowhere on this page — a doctor had to
                  open Billing to find out what a case costs. */}
              {caseData.totalAmountPaise > 0 && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>
                    {caseData.paymentConfirmedAt ? 'Paid' : 'Payable at dispatch'}
                  </span>
                  <span className={styles.detailValue}>
                    ₹{Math.round(caseData.totalAmountPaise / 100).toLocaleString('en-IN')}
                    <span className={styles.detailHint}> incl. GST</span>
                  </span>
                </div>
              )}
              {caseData.complimentary && (
                <div className={styles.detailItem}>
                  <span className={styles.detailLabel}>Payable at dispatch</span>
                  <span className={styles.detailValue}>
                    ₹0<span className={styles.detailHint}> Scan Day crown</span>
                  </span>
                </div>
              )}

              {/* Everything below is reference: correct to have, but not
                  what the doctor opened this page to find. */}
              {showAllRx && (
                <>
                  {caseData.archTarget && (
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Target Arch</span>
                      <span className={styles.detailValue}>{caseData.archTarget}</span>
                    </div>
                  )}
                  {caseData.implantSystem && (
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Implant System</span>
                      <span className={styles.detailValue}>{caseData.implantSystem}</span>
                    </div>
                  )}
                  {caseData.finishingTier === 'premium' && (
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Finish</span>
                      <span className={styles.detailValue}>Signature Match</span>
                    </div>
                  )}
                  {caseData.warrantyYears > 0 && (
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Warranty</span>
                      <span className={styles.detailValue}>{caseData.warrantyYears} years</span>
                    </div>
                  )}
                  {caseData.tech && caseData.tech !== 'Unassigned' && (
                    <div className={styles.detailItem}>
                      <span className={styles.detailLabel}>Assigned Tech</span>
                      <span className={styles.detailValue}>{caseData.tech}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Only offered when there is actually something behind it. */}
            {!showAllRx && (
              caseData.archTarget || caseData.implantSystem ||
              caseData.finishingTier === 'premium' || caseData.warrantyYears > 0 ||
              (caseData.tech && caseData.tech !== 'Unassigned')
            ) && (
              <button className={styles.moreDetails} onClick={() => setShowAllRx(true)}>
                More details
              </button>
            )}
            {caseData.instructions && (
              <div className={styles.notesSection}>
                <span className={styles.detailLabel}>Doctor's Instructions</span>
                <p className={styles.notesText}>{caseData.instructions}</p>
              </div>
            )}
          </div>

          {/* ══════ 3D SCAN ══════ */}
          {/* Collapsible, and below the prescription. The viewer is the
              biggest thing on the page but rarely the reason a doctor
              opens it — usually they want the shade, the price or the
              status. Reviewing geometry is a deliberate act, so it is
              one click away rather than occupying the fold. */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <button className={styles.disclosure}
                aria-expanded={showViewer}
                onClick={() => setShowViewer(v => !v)}>
                <ChevronLeft size={16}
                  className={`${styles.disclosureChevron} ${showViewer ? styles.disclosureOpen : ''}`} />
                <h2 className={styles.cardTitle}>3D Scan Preview</h2>
                <span className={styles.disclosureHint}>
                  {caseData.files?.length ? `${caseData.files.length} file${caseData.files.length > 1 ? 's' : ''}` : 'none attached'}
                </span>
              </button>
              {showViewer && (
                <button className={styles.iconBtn}><Download size={14} /> Download STL</button>
              )}
            </div>
            {showViewer && (
            <div className={styles.viewerContainer} style={{ height: '350px' }}>
              {caseData.files && caseData.files.length > 0 ? (
                <STLViewer 
                  url={caseData.files[0].url ? `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${caseData.files[0].url}?t=${Date.now()}` : null} 
                  filename={caseData.files[0].name} 
                />
              ) : (
                <div style={{display:'flex', width:'100%', height:'100%', alignItems:'center', justifyContent:'center', background:'var(--glass-bg)', border:'1px dashed var(--glass-border)', borderRadius:'12px', color:'var(--text-tertiary)'}}>
                  No 3D scans attached to this case.
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        <div className={styles.sideColumn}>
          {/* ══════ TIMELINE — Fully dynamic from context ══════ */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Case Timeline</h2>
            <div className={styles.timeline}>
              {(caseData.timeline && caseData.timeline.length > 0) ? (() => {
                // The newest three, unless the doctor asks for the rest.
                const all = caseData.timeline;
                const hidden = showAllTimeline ? 0 : Math.max(all.length - 3, 0);
                const shown = hidden ? all.slice(-3) : all;
                return (
                  <>
                    {hidden > 0 && (
                      <button className={styles.timelineMore}
                        onClick={() => setShowAllTimeline(true)}>
                        Show {hidden} earlier event{hidden > 1 ? 's' : ''}
                      </button>
                    )}
                    {shown.map((item, idx) => (
                      <div key={idx} className={`${styles.timelineItem} ${styles.completed}`}>
                        <div className={styles.timelineDot}>
                          <CheckCircle size={10} />
                        </div>
                        <div className={styles.timelineContent}>
                          <h4>{item.label}</h4>
                          <p>{item.time || 'Completed'}</p>
                          {item.info && <p className={styles.timelineInfo}>{item.info}</p>}
                        </div>
                      </div>
                    ))}
                  </>
                );
              })() : (
                <div className={styles.timelineEmpty}>No timeline events recorded yet.</div>
              )}

              {/* Show a "pending" dot for the current active phase if not yet done */}
              {!['completed', 'archived', 'cancelled'].includes(caseData.status) && (
                <div className={`${styles.timelineItem} ${styles.active}`}>
                  <div className={styles.timelineDot}>
                    <Clock size={10} />
                  </div>
                  <div className={styles.timelineContent}>
                    <h4>{STATUS_LABEL[caseData.status] || caseData.status}</h4>
                    <p>In Progress</p>
                  </div>
                </div>
              )}
            </div>

            {/* Tracking info — flat fields are what the API returns; the
                nested object only exists in optimistic local state. */}
            {(caseData.trackingCourier || caseData.tracking) && (
              <div className={styles.trackingSection}>
                <span className={styles.detailLabel}>Tracking Information</span>
                <div className={styles.trackingInfo}>
                  <span>{caseData.trackingCourier || caseData.tracking?.courier}</span>
                  <span className={styles.trackingNumber}>{caseData.trackingNumber || caseData.tracking?.number}</span>
                </div>
                {/* Named, not anonymous: a parcel query has a person to
                    ask. Only rendered once somebody actually has. */}
                {caseData.dispatchedBy && (
                  <span className={styles.dispatchedByLine}>
                    Handed over by {caseData.dispatchedBy.name}
                    {caseData.packedBy && caseData.packedBy.id !== caseData.dispatchedBy.id
                      ? ` · packed by ${caseData.packedBy.name}`
                      : ''}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ══════ TREATMENT PLAN ══════
              What the designer wants you to look at before they build
              it. Only rendered when something has been shared, so a
              case without one shows no empty shelf. */}
          {treatmentPlan.length > 0 && (
            <div className={styles.card}>
              <h2 className={styles.cardTitle}>Treatment Plan</h2>
              <p className={styles.planIntro}>
                Shared by your designer. Reply below with anything you want changed.
              </p>
              <div className={styles.planMedia}>
                {treatmentPlan.map((f) => (
                  <figure key={f.id} className={styles.planItem}>
                    {f.mimetype?.startsWith('video/') ? (
                      // Plays in place. A staged aligner sequence is a
                      // motion — making the dentist download a file to
                      // see it is most of the reason plans go unwatched.
                      <video
                        className={styles.planVideo}
                        src={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${f.url}`}
                        controls
                        preload="metadata"
                        playsInline
                      />
                    ) : (
                      <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${f.url}`} target="_blank" rel="noopener noreferrer">
                        <img className={styles.planImage} src={`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}${f.url}`} alt={f.name} loading="lazy" />
                      </a>
                    )}
                    <figcaption className={styles.planCaption}>{f.name}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          )}

          {/* ══════ CHAT ══════ */}
          <div className={`${styles.card} ${styles.chatCard}`}>
            <h2 className={styles.cardTitle}>
              {hasDesignerChannel ? 'Messages — you, the lab and your designer' : 'Case Messaging'}
            </h2>
            <div className={caseData.messages.length ? styles.chatArea : styles.chatEmpty}>
              {caseData.messages.length === 0 && (
                hasDesignerChannel
                  ? <>Your designer can answer plan questions here directly.</>
                  : <>Ask the lab anything about this case — they reply here.</>
              )}
              {caseData.messages.map((msg, idx) => (
                <div
                  key={msg.id || idx}
                  className={msg.from === 'doctor' ? styles.messageDoctor : styles.messageLab}
                >
                  {/* Who is talking matters once a third party is in the
                      thread: "Lab Tech" on a message from the designer
                      handling your aligner plan is simply wrong. */}
                  <strong>{senderLabel(msg)}:</strong> {msg.text}
                  <span className={styles.msgTime}>{msg.time}</span>
                </div>
              ))}
            </div>
            <div className={styles.chatInput}>
              <input
                type="text"
                placeholder="Type a message to the lab..."
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button className={styles.sendBtn} title="Send Message" onClick={handleSendMessage}>
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CaseDetails;
