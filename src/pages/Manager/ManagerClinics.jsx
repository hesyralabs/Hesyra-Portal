import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle, Ban, ShieldAlert,
  CreditCard, X, TrendingUp,
} from 'lucide-react';
import styles from './ManagerClinics.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const TRUST_CONFIG = {
  clean:     { label: 'Clean',     color: '#10b981', bg: 'rgba(16,185,129,0.1)',  icon: CheckCircle },
  strike_1:  { label: 'Strike 1',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: AlertTriangle },
  strike_2:  { label: 'Strike 2',  color: '#fb923c', bg: 'rgba(251,146,60,0.1)', icon: ShieldAlert },
  suspended: { label: 'Suspended', color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: Ban },
  banned:    { label: 'Banned',    color: '#64748b', bg: 'rgba(100,116,139,0.1)', icon: Ban },
};

const ManagerClinics = () => {
  const [clinics, setClinics]           = useState([]);
  const [loading, setLoading]           = useState(true);
  const [search, setSearch]             = useState('');
  const [expanded, setExpanded]         = useState(null);
  const [wallet, setWallet]             = useState({});
  const [walletLoading, setWalletLoading] = useState({});

  // Billing modal state
  const [billingModal, setBillingModal] = useState(null); // clinic object | null
  const [billingMode, setBillingMode]   = useState('net_30');
  const [creditLimitINR, setCreditLimitINR] = useState('50000');
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingMsg, setBillingMsg]     = useState('');

  const token = sessionStorage.getItem('hesyra_token');
  const headers = { Authorization: `Bearer ${token}` };

  const fetchClinics = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/manager/clinics`, { headers });
      const data = await res.json();
      setClinics(Array.isArray(data) ? data : []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchClinics(); }, [fetchClinics]);

  const toggleExpand = async (clinicId) => {
    if (expanded === clinicId) { setExpanded(null); return; }
    setExpanded(clinicId);
    if (!wallet[clinicId]) {
      setWalletLoading(p => ({ ...p, [clinicId]: true }));
      try {
        const res = await fetch(`${API}/api/manager/clinics/${clinicId}/wallet`, { headers });
        const data = await res.json();
        setWallet(p => ({ ...p, [clinicId]: data }));
      } catch {}
      setWalletLoading(p => ({ ...p, [clinicId]: false }));
    }
  };

  const openBillingModal = (clinic, e) => {
    e.stopPropagation();
    setBillingModal(clinic);
    setBillingMode(clinic.billingMode === 'net_30' ? 'prepaid' : 'net_30');
    setCreditLimitINR('50000');
    setBillingMsg('');
  };

  const saveBilling = async () => {
    if (!billingModal) return;
    setBillingLoading(true);
    setBillingMsg('');
    try {
      const body = {
        billingMode,
        creditLimitPaise: billingMode === 'net_30' ? Math.round(parseFloat(creditLimitINR) * 100) : 0,
      };
      const res = await fetch(`${API}/api/manager/clinics/${billingModal.id}/billing`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setBillingMsg('✓ Billing terms updated.');
        // Update local state so table refreshes instantly
        setClinics(prev => prev.map(c =>
          c.id === billingModal.id
            ? { ...c, billingMode: body.billingMode, creditLimitPaise: body.creditLimitPaise }
            : c
        ));
        setTimeout(() => setBillingModal(null), 1200);
      } else {
        setBillingMsg(`Error: ${data.error}`);
      }
    } catch {
      setBillingMsg('Network error.');
    } finally {
      setBillingLoading(false);
    }
  };

  const filtered = clinics.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.name?.toLowerCase().includes(q) || c.clinic?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q);
  });

  // Helper: credit utilization percentage
  const utilPct = (c) => {
    if (!c.creditLimitPaise || c.creditLimitPaise === 0) return 0;
    return Math.min(100, Math.round((c.outstandingPaise / c.creditLimitPaise) * 100));
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Clinic Accounts</h1>
          <p className={styles.subtitle}>Trust tiers, billing modes, wallet balances, and active case counts</p>
        </div>
        <div className={styles.controls}>
          <div className={styles.searchBox}>
            <Search size={14} />
            <input placeholder="Search clinics…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <button className={styles.refreshBtn} onClick={fetchClinics}><RefreshCw size={14} /></button>
        </div>
      </header>

      {/* ── Summary tiles ── */}
      {!loading && (
        <div className={styles.summaryRow}>
          {Object.entries(TRUST_CONFIG).map(([key, cfg]) => {
            const count = clinics.filter(c => (c.trustLevel || 'clean') === key).length;
            if (count === 0) return null;
            const Icon = cfg.icon;
            return (
              <div key={key} className={styles.summaryTile} style={{ borderColor: `${cfg.color}30` }}>
                <Icon size={14} style={{ color: cfg.color }} />
                <span className={styles.summaryCount} style={{ color: cfg.color }}>{count}</span>
                <span className={styles.summaryLabel}>{cfg.label}</span>
              </div>
            );
          })}
          {/* Net-30 count tile */}
          {clinics.filter(c => c.billingMode === 'net_30').length > 0 && (
            <div className={styles.summaryTile} style={{ borderColor: 'rgba(167,139,250,0.3)' }}>
              <CreditCard size={14} style={{ color: '#a78bfa' }} />
              <span className={styles.summaryCount} style={{ color: '#a78bfa' }}>
                {clinics.filter(c => c.billingMode === 'net_30').length}
              </span>
              <span className={styles.summaryLabel}>Net-30</span>
            </div>
          )}
        </div>
      )}

      {/* ── Clinic table ── */}
      <div className={styles.tableWrapper}>
        <div className={styles.tableHead}>
          <div className={styles.colName}>Clinic / Doctor</div>
          <div className={styles.colTrust}>Trust</div>
          <div className={styles.colWallet}>Wallet / Credit</div>
          <div className={styles.colCases}>Active Cases</div>
          <div className={styles.colJoin}>Joined</div>
          <div className={styles.colExpand} />
        </div>

        <div className={styles.tableBody}>
          {loading ? (
            Array(3).fill(0).map((_, i) => <div key={i} className={styles.skeletonRow} />)
          ) : filtered.length === 0 ? (
            <div className={styles.empty}>No clinics match.</div>
          ) : (
            filtered.map(clinic => {
              const trust = TRUST_CONFIG[clinic.trustLevel || 'clean'] || TRUST_CONFIG.clean;
              const Icon = trust.icon;
              const isOpen = expanded === clinic.id;
              const w = wallet[clinic.id];
              const wLoading = walletLoading[clinic.id];
              const isNet30 = clinic.billingMode === 'net_30';
              const pct = utilPct(clinic);
              const creditColor = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#a78bfa';

              return (
                <div key={clinic.id} className={styles.clinicBlock}>
                  <div
                    className={`${styles.tableRow} ${isOpen ? styles.rowExpanded : ''}`}
                    onClick={() => toggleExpand(clinic.id)}
                  >
                    <div className={styles.colName}>
                      <div className={styles.clinicName}>{clinic.clinic || clinic.name}</div>
                      <div className={styles.clinicMeta}>{clinic.name} · {clinic.email}</div>
                    </div>
                    <div className={styles.colTrust}>
                      <span className={styles.trustBadge} style={{ color: trust.color, background: trust.bg }}>
                        <Icon size={11} /> {trust.label}
                        {clinic.strikeCount > 0 && ` (${clinic.strikeCount})`}
                      </span>
                    </div>
                    <div className={styles.colWallet}>
                      {isNet30 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 120 }}>
                          <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600 }}>
                            💳 Net-30 · ₹{((clinic.outstandingPaise || 0) / 100).toLocaleString('en-IN')} outstanding
                          </span>
                          <div style={{ background: 'rgba(167,139,250,0.12)', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: creditColor, borderRadius: 4, transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: '0.6rem', color: '#64748b' }}>
                            {pct}% of ₹{((clinic.creditLimitPaise || 0) / 100).toLocaleString('en-IN')} limit
                          </span>
                        </div>
                      ) : (
                        <span className={styles.walletBal}>
                          ₹{((clinic.wallet?.balancePaise || 0) / 100).toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                    <div className={styles.colCases}>
                      <span className={styles.casesCount}>{clinic.cases?.length || 0}</span>
                    </div>
                    <div className={styles.colJoin}>
                      {new Date(clinic.joinDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                    </div>
                    <div className={styles.colExpand} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <button
                        className={styles.billingBtn}
                        title={isNet30 ? 'Manage credit terms' : 'Grant credit terms'}
                        onClick={e => openBillingModal(clinic, e)}
                        style={{ color: isNet30 ? '#a78bfa' : '#64748b' }}
                      >
                        <CreditCard size={14} />
                      </button>
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </div>
                  </div>

                  {/* ── Expanded wallet / credit view ── */}
                  {isOpen && (
                    <div className={styles.walletPanel}>
                      {wLoading ? (
                        <div className={styles.walletLoading}>Loading wallet…</div>
                      ) : !w ? (
                        <div className={styles.walletEmpty}>No wallet found.</div>
                      ) : (
                        <>
                          <div className={styles.walletStats}>
                            <div className={styles.wStat}>
                              <span>Balance</span>
                              <strong>₹{(w.balancePaise / 100).toLocaleString('en-IN')}</strong>
                            </div>
                            <div className={styles.wStat}>
                              <span>Total Loaded</span>
                              <strong>₹{(w.totalLoadedPaise / 100).toLocaleString('en-IN')}</strong>
                            </div>
                            <div className={styles.wStat}>
                              <span>Total Spent</span>
                              <strong>₹{(w.totalSpentPaise / 100).toLocaleString('en-IN')}</strong>
                            </div>
                            {isNet30 && (
                              <>
                                <div className={styles.wStat}>
                                  <span>Outstanding (Credit)</span>
                                  <strong style={{ color: creditColor }}>
                                    ₹{((clinic.outstandingPaise || 0) / 100).toLocaleString('en-IN')}
                                  </strong>
                                </div>
                                <div className={styles.wStat}>
                                  <span>Credit Limit</span>
                                  <strong>₹{((clinic.creditLimitPaise || 0) / 100).toLocaleString('en-IN')}</strong>
                                </div>
                              </>
                            )}
                            <div className={styles.wReadOnly}>Read-only · Manager view</div>
                          </div>
                          {w.transactions?.length > 0 && (
                            <div className={styles.txList}>
                              {w.transactions.slice(0, 8).map(tx => (
                                <div key={tx.id} className={styles.txRow}>
                                  <span className={`${styles.txDir} ${tx.direction === 'CREDIT' ? styles.credit : styles.debit}`}>
                                    {tx.direction === 'CREDIT' ? '+' : '-'}₹{(tx.amountPaise / 100).toLocaleString('en-IN')}
                                  </span>
                                  <span className={styles.txDesc}>{tx.description}</span>
                                  <span className={styles.txDate}>
                                    {new Date(tx.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Billing modal ── */}
      {billingModal && (
        <div className={styles.modalOverlay} onClick={() => setBillingModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <button className={styles.modalClose} onClick={() => setBillingModal(null)}><X size={18} /></button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              <TrendingUp size={18} style={{ color: '#a78bfa' }} />
              <h2 className={styles.modalTitle}>Billing Terms</h2>
            </div>
            <p className={styles.modalSub}>
              <strong>{billingModal.clinic || billingModal.name}</strong> — currently{' '}
              <span style={{ color: billingModal.billingMode === 'net_30' ? '#a78bfa' : '#64748b', fontWeight: 600 }}>
                {billingModal.billingMode === 'net_30' ? 'Net-30 Credit' : 'Prepaid'}
              </span>
            </p>

            {['strike_1', 'strike_2', 'suspended', 'banned'].includes(billingModal.trustLevel) && billingMode === 'net_30' && (
              <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '0.6rem 0.8rem', marginBottom: '1rem', fontSize: '0.78rem', color: '#fca5a5' }}>
                ⚠️ This clinic has trust level <strong>{billingModal.trustLevel}</strong>. Credit cannot be granted to accounts with strikes or restrictions.
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              <button
                onClick={() => setBillingMode('prepaid')}
                style={{
                  flex: 1, padding: '0.6rem', borderRadius: 8, border: `2px solid ${billingMode === 'prepaid' ? '#60a5fa' : 'rgba(255,255,255,0.1)'}`,
                  background: billingMode === 'prepaid' ? 'rgba(96,165,250,0.1)' : 'transparent',
                  color: billingMode === 'prepaid' ? '#60a5fa' : '#94a3b8', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                }}
              >
                Prepaid<br /><span style={{ fontSize: '0.68rem', fontWeight: 400, color: '#64748b' }}>Pay before dispatch</span>
              </button>
              <button
                onClick={() => setBillingMode('net_30')}
                style={{
                  flex: 1, padding: '0.6rem', borderRadius: 8, border: `2px solid ${billingMode === 'net_30' ? '#a78bfa' : 'rgba(255,255,255,0.1)'}`,
                  background: billingMode === 'net_30' ? 'rgba(167,139,250,0.1)' : 'transparent',
                  color: billingMode === 'net_30' ? '#a78bfa' : '#94a3b8', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
                }}
              >
                Net-30 Credit<br /><span style={{ fontSize: '0.68rem', fontWeight: 400, color: '#64748b' }}>Monthly invoice</span>
              </button>
            </div>

            {billingMode === 'net_30' && (
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.35rem' }}>
                  Credit Limit (₹)
                </label>
                <input
                  type="number"
                  min="5000"
                  step="5000"
                  value={creditLimitINR}
                  onChange={e => setCreditLimitINR(e.target.value)}
                  placeholder="e.g. 50000"
                  style={{
                    width: '100%', padding: '0.55rem 0.75rem', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)', color: '#f8fafc', fontSize: '0.9rem', boxSizing: 'border-box',
                  }}
                />
                <p style={{ fontSize: '0.68rem', color: '#64748b', marginTop: '0.3rem' }}>
                  They can accumulate up to ₹{parseFloat(creditLimitINR || 0).toLocaleString('en-IN')} in unpaid dispatches before new cases are blocked.
                </p>
              </div>
            )}

            {billingMsg && (
              <div style={{ fontSize: '0.8rem', color: billingMsg.startsWith('✓') ? '#34d399' : '#f87171', marginBottom: '0.75rem' }}>
                {billingMsg}
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setBillingModal(null)} style={{ flex: 1, padding: '0.55rem', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#94a3b8', cursor: 'pointer', fontSize: '0.82rem' }}>
                Cancel
              </button>
              <button
                onClick={saveBilling}
                disabled={billingLoading}
                style={{
                  flex: 2, padding: '0.55rem', borderRadius: 8, border: 'none',
                  background: billingMode === 'net_30' ? '#7c3aed' : '#334155',
                  color: '#fff', cursor: billingLoading ? 'not-allowed' : 'pointer', fontSize: '0.82rem', fontWeight: 600, opacity: billingLoading ? 0.7 : 1,
                }}
              >
                {billingLoading ? 'Saving…' : billingMode === 'net_30' ? '✓ Grant Net-30 Credit' : '↩ Downgrade to Prepaid'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerClinics;
