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
  design_ready: 'Design Under Review',
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

const STATUS_COLOR = {
  draft: '#94a3b8',
  submitted: '#60a5fa',
  cad_assigned: '#fde68a',
  design_ready: '#c4b5fd',
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
  const [rejectReason, setRejectReason] = useState('');
  const [processing, setProcessing] = useState(false);

  // Read directly from cases array — guarantees re-render on ANY case state change
  const caseData = cases.find(c => c.id === id);

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

  // Security check: Dentist should only see their own clinic's cases
  if (user?.role === 'dentist' && caseData.clinic !== user.clinic) {
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
        <h1 className={styles.title}>{caseData.id} <span style={{fontWeight: 300, color: 'var(--text-secondary)'}}>• {caseData.patient}</span></h1>
        <p className={styles.subtitle}>Submitted on {caseData.received} • {caseData.type}</p>
      </header>

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
          {caseData.status === 'pending_approval' && (
            <div className={styles.actionWarning} style={{background: 'rgba(122, 156, 150, 0.1)', borderColor: 'var(--brand-bioceramic)'}}>
              <FileCheck size={24} style={{ color: 'var(--brand-bioceramic)', flexShrink: 0, marginTop: '2px' }} />
              <div style={{flex: 1}}>
                <h3 style={{margin: '0 0 4px', color: 'var(--brand-bioceramic)', fontSize: '16px'}}>Digital Wax-Up Ready for Approval</h3>
                <p style={{margin: '0 0 12px', fontSize: '13px', color: 'var(--text-secondary)', lineHeight: 1.5}}>
                  The lab has completed the 3D design. Please review the uploaded design files below and approve or request changes.
                </p>

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
                  {caseData.tracking 
                    ? `Shipped via ${caseData.tracking.courier}. Tracking: ${caseData.tracking.number}`
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

          {/* ══════ 3D SCAN ══════ */}
          <div className={styles.card}>
            <div className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>3D Scan Preview</h2>
              <button className={styles.iconBtn}><Download size={14} /> Download STL</button>
            </div>
            <div className={styles.viewerContainer} style={{height: '350px'}}>
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
          </div>

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
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>Assigned Tech</span>
                <span className={styles.detailValue}>{caseData.tech}</span>
              </div>
            </div>
            {caseData.instructions && (
              <div className={styles.notesSection}>
                <span className={styles.detailLabel}>Doctor's Instructions</span>
                <p className={styles.notesText}>{caseData.instructions}</p>
              </div>
            )}
          </div>
        </div>

        <div className={styles.sideColumn}>
          {/* ══════ TIMELINE — Fully dynamic from context ══════ */}
          <div className={styles.card}>
            <h2 className={styles.cardTitle}>Case Timeline</h2>
            <div className={styles.timeline}>
              {(caseData.timeline && caseData.timeline.length > 0) ? (
                caseData.timeline.map((item, idx) => (
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
                ))
              ) : (
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

            {/* Tracking info */}
            {caseData.tracking && (
              <div className={styles.trackingSection}>
                <span className={styles.detailLabel}>Tracking Information</span>
                <div className={styles.trackingInfo}>
                  <span>{caseData.tracking.courier}</span>
                  <span className={styles.trackingNumber}>{caseData.tracking.number}</span>
                </div>
              </div>
            )}
          </div>

          {/* ══════ CHAT ══════ */}
          <div className={`${styles.card} ${styles.chatCard}`}>
            <h2 className={styles.cardTitle}>Case Messaging</h2>
            <div className={styles.chatArea}>
              {caseData.messages.length === 0 && (
                <div className={styles.emptyChat}>No messages yet. Start a conversation about this case.</div>
              )}
              {caseData.messages.map((msg, idx) => (
                <div key={idx} className={msg.from === 'doctor' ? styles.messageDoctor : styles.messageLab}>
                  <strong>{msg.from === 'doctor' ? 'You' : 'Lab Tech'}:</strong> {msg.text}
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
