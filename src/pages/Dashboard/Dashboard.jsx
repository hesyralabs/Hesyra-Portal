import React, { useState, useEffect } from 'react';
import { Plus, MoreHorizontal, FileText, Package, CheckCircle2, Clock, AlertTriangle, CreditCard, ShieldAlert } from 'lucide-react';
import Skeleton from '../../components/UI/Skeleton';
import WalletCard from '../../components/UI/WalletCard';
import StrikeBadge from '../../components/UI/StrikeBadge';
import WelcomeModal from '../../components/Onboarding/WelcomeModal';
import DeepDiveDrawer from '../../components/Onboarding/DeepDiveDrawer';
import Confetti from '../../components/Onboarding/Confetti';
import { useNavigate, Link } from 'react-router-dom';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import { usePayment } from '../../context/PaymentContext';
import { useOnboarding } from '../../context/OnboardingContext';
import styles from './Dashboard.module.css';

const Dashboard = () => {
  const { cases, updateCaseStatus } = useCases();
  const { user } = useAuth();
  const { wallet, trustStatus, isSuspended, paiseToINR } = usePayment();
  const { showWelcome, showConfetti, clearConfetti } = useOnboarding();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(t);
  }, []);

  // Clinic-facing columns — groups multiple internal lab statuses into
  // meaningful buckets. The `statuses` array drives filtering below.
  const columns = [
    { key: 'action_required', title: 'Action Required', statuses: ['action_required'], cssClass: styles.colAction },
    { key: 'draft',           title: 'Draft Rx',        statuses: ['draft'],           cssClass: styles.colDraft },
    { key: 'submitted',       title: 'Submitted',       statuses: ['submitted'],       cssClass: styles.colSubmitted },
    { key: 'designing',       title: 'In Design',       statuses: ['cad_assigned', 'design_ready', 'design_revision', 'blocked', 'designing'], cssClass: styles.colDesigning },
    { key: 'production',      title: 'In Production',   statuses: ['design_approved', 'post_processing', 'qa', 'printing'], cssClass: styles.colPrinting },
    { key: 'payment',         title: 'Payment Due',      statuses: ['ready_for_dispatch', 'payment_pending', 'overdue', 'packaged'], cssClass: styles.colPayment },
    { key: 'dispatched',      title: 'Dispatched',       statuses: ['dispatched', 'shipped'], cssClass: styles.colShipped },
    { key: 'completed',       title: 'Delivered',        statuses: ['completed'],       cssClass: styles.colCompleted },
  ];

  const dashboardCases = cases.filter(c => c.clinic === user?.clinic && !['archived', 'cancelled'].includes(c.status));
  const activeCount = dashboardCases.filter(c => !['dispatched', 'shipped', 'completed'].includes(c.status)).length;
  const attentionCount = dashboardCases.filter(c => ['action_required', 'payment_pending', 'overdue'].includes(c.status)).length;

  return (
    <>
      {/* ─── Onboarding Overlays ─── */}
      {showWelcome && <WelcomeModal />}
      <DeepDiveDrawer />
      {showConfetti && <Confetti onComplete={clearConfetti} />}

      <div className={styles.workspaceHeader}>
        <div>
          <h1 className={styles.workspaceTitle}>Active Cases</h1>
          <p className={styles.workspaceSubtitle}>
            {dashboardCases.length} total cases • {activeCount} active
            {attentionCount > 0 && <span className={styles.attentionBadge}> • {attentionCount} need attention</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Link to="/billing" className={styles.btnMenu} style={{display: 'flex', alignItems: 'center', gap: '6px', background: 'var(--bg-glass)', border: '1px solid var(--border-light)', padding: '0.5rem 0.75rem', borderRadius: '8px', color: 'var(--text-primary)', fontWeight: 600, fontSize: '13px', textDecoration: 'none'}}>
            <CreditCard size={14} style={{color: 'var(--brand-mint)'}} /> 
            <span>₹{wallet ? (wallet.balancePaise / 100).toLocaleString(undefined, {minimumFractionDigits: 2}) : '0.00'}</span>
          </Link>
          {trustStatus && trustStatus.trustLevel !== 'clean' && (
            <StrikeBadge compact />
          )}
          <Link to="/new-case" className={styles.btnPrimary}>
            <Plus size={16} />
            New Rx Request
          </Link>
        </div>
      </div>



      <div className={styles.kanbanBoard}>
        {columns.map(col => {
          const colCases = dashboardCases.filter(c => col.statuses.includes(c.status));
          return (
            <div key={col.key} className={`${styles.kanbanColumn} ${col.cssClass || ''}`}>
              <div className={styles.columnHeader}>
                <div className={styles.columnProgressBar}>
                  <div className={styles.columnProgressFill}></div>
                </div>
                <div className={styles.columnTitleRow}>
                  <span className={styles.columnTitle}>{col.title}</span>
                  <span className={styles.columnCount}>{colCases.length}</span>
                </div>
              </div>

              <div className={styles.columnContent}>
                {isLoading ? (
                  <>
                    <Skeleton height="140px" borderRadius="14px" style={{marginBottom: '0.75rem'}} />
                    <Skeleton height="140px" borderRadius="14px" style={{marginBottom: '0.75rem'}} />
                  </>
                ) : colCases.length === 0 ? (
                  <div className={styles.emptyState}>
                    <Package size={24} className={styles.emptyIcon} />
                    <div className={styles.metaText}>No cases currently here</div>
                  </div>
                ) : (
                  colCases.map((c) => (
                    <div 
                      key={c.id} 
                      className={`${styles.caseCard} ${c.status === 'shipped' ? styles.shippedCard : ''} ${c.status === 'completed' ? styles.completedCard : ''} ${c.status === 'overdue' ? styles.overdueCard : ''} ${c.status === 'payment_pending' || c.status === 'ready_for_dispatch' ? styles.paymentCard : ''}`}
                      onClick={() => navigate(`/case/${c.id}`)}
                    >
                      <div className={styles.cardHeader}>
                        <span className={styles.caseId}>{c.id}</span>
                        <div className={styles.avatarMini}>{c.initials}</div>
                      </div>

                      <div>
                        <div className={styles.patientName}>{c.patient}</div>
                        <div className={styles.rxDetails}>
                          <div className={styles.rxItem}>
                            <FileText size={14} className={styles.rxIcon} /> {c.type}
                          </div>
                        </div>
                      </div>

                      {/* Status-specific indicators */}
                      {c.status === 'pending_approval' && (
                        <div className={styles.pendingTag}>
                          <Clock size={10} /> Awaiting Your Approval
                        </div>
                      )}

                      {c.status === 'action_required' && (
                        <div className={styles.actionTag}>
                          <AlertTriangle size={10} /> Needs Attention
                        </div>
                      )}

                      {(c.status === 'payment_pending' || c.status === 'ready_for_dispatch') && (
                        <div className={styles.paymentTag}>
                          <CreditCard size={10} /> Payment Required — {paiseToINR(c.totalAmountPaise)}
                        </div>
                      )}

                      {c.status === 'overdue' && (
                        <div className={styles.overdueTag}>
                          <ShieldAlert size={10} /> OVERDUE — {paiseToINR(c.totalAmountPaise)}
                        </div>
                      )}

                      {c.tech && c.tech !== 'Unassigned' && !['payment_pending', 'ready_for_dispatch', 'overdue'].includes(c.status) && (
                        <div className={styles.attachmentTag}>
                          <CheckCircle2 size={10} /> Assigned: {c.tech}
                        </div>
                      )}

                      <div className={styles.cardFooter}>
                        <div>
                          <div className={styles.metaText}>Received</div>
                          <div className={styles.dueDate}>{c.received}</div>
                        </div>
                        
                        <div className={styles.dropdownContainer}>
                          <button className={styles.btnCircular} title="Quick Actions" onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setOpenMenuId(openMenuId === c.id ? null : c.id);
                          }}>
                            <MoreHorizontal size={16} />
                          </button>

                          {openMenuId === c.id && (
                            <div className={styles.dropdownMenu} onMouseLeave={() => setOpenMenuId(null)}>
                              <button className={styles.dropdownItem} onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                navigate(`/case/${c.id}`);
                              }}>View Case Details</button>
                              
                              {c.status === 'shipped' && (
                                <button className={styles.dropdownItem} onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  updateCaseStatus(c.id, 'completed');
                                  setOpenMenuId(null);
                                }}>Confirm Delivery</button>
                              )}

                              {c.status === 'completed' && (
                                <button className={styles.dropdownItem} onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  updateCaseStatus(c.id, 'archived');
                                  setOpenMenuId(null);
                                }}>Archive Case</button>
                              )}

                              {['draft', 'submitted', 'action_required'].includes(c.status) && (
                                <button className={`${styles.dropdownItem} ${styles.danger}`} onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  updateCaseStatus(c.id, 'cancelled');
                                  setOpenMenuId(null);
                                }}>Cancel Request</button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>
    </>
  );
};

export default Dashboard;
