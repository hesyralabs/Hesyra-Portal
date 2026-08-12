import React, { useState } from 'react';
import { CreditCard, Download, FileText, CheckCircle2, Clock, AlertCircle, Wallet, ArrowRightLeft, Shield, Settings, Mail } from 'lucide-react';
import WalletCard from '../../components/UI/WalletCard';
import StrikeBadge from '../../components/UI/StrikeBadge';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import { usePayment } from '../../context/PaymentContext';
import styles from './Billing.module.css';

const Billing = () => {
  const { invoices } = useCases();
  const { user } = useAuth();
  const { wallet, trustStatus, paiseToINR, setPaymentMode, simulatePayment, refreshWallet } = usePayment();
  const [activeTab, setActiveTab] = useState('unpaid');
  const [emailing, setEmailing] = useState(null);
  const [notice, setNotice] = useState(null);

  const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  // GET /api/invoices is scoped to the caller server-side, so what
  // arrives here is already only this clinic's.
  //
  // This used to re-filter on `inv.clinic === user?.clinic`, matching a
  // free-text practice name. That was never what kept one clinic's
  // invoices off another's screen — the API returned everybody's — and
  // it silently emptied the page whenever the two strings disagreed or
  // `user` had not resolved yet. Ownership is enforced by userId at the
  // API; the client just renders what it is given.
  const userInvoices = invoices;
  const filteredInvoices = userInvoices.filter(inv => activeTab === 'all' || inv.status === activeTab);
  // What is actually owed, tax included — the same figure the payment
  // link asks for. Summing `amount` understated it by the GST.
  const totalDue = userInvoices
    .filter(inv => inv.status === 'unpaid')
    .reduce((sum, inv) => sum + (inv.grossPaise ?? Math.round(inv.amount * 100)), 0) / 100;

  // The invoice PDF is rendered by the server, not here.
  //
  // This used to build the document in the browser with html2pdf, and
  // it could not have been right: it split the invoice total evenly
  // across its cases to invent line amounts, fell back to a 12% GST
  // rate the catalogue has never charged, and always printed
  // CGST + SGST — so an inter-state clinic received a document showing
  // a tax it did not pay. One renderer, server-side, built from the
  // figures the clinic was actually charged.
  const handleDownloadPDF = async (inv) => {
    setNotice(null);
    try {
      const token = sessionStorage.getItem('hesyra_token');
      const res = await fetch(`${API}/api/invoices/${inv.id}/pdf?download=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('fetch failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Hesyra-Invoice-${inv.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setNotice({ kind: 'error', text: 'Could not download that invoice. Please try again.' });
    }
  };

  // Email a copy to the address on the account. Reports what actually
  // happened — an unconfigured mail server says so rather than letting
  // the button claim a send that never left.
  const handleEmail = async (inv) => {
    setEmailing(inv.id);
    setNotice(null);
    try {
      const token = sessionStorage.getItem('hesyra_token');
      const res = await fetch(`${API}/api/invoices/${inv.id}/email`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) setNotice({ kind: 'ok', text: `Invoice ${inv.id} sent to ${body.sentTo}.` });
      else setNotice({ kind: 'error', text: body.error || 'Could not send that invoice.' });
    } catch {
      setNotice({ kind: 'error', text: 'Could not send that invoice.' });
    } finally {
      setEmailing(null);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}><CreditCard size={28} className={styles.titleIcon} /> Billing & Payments</h1>
          <p className={styles.subtitle}>Manage your wallet, invoices, and payment preferences.</p>
        </div>
      </header>

      {/* Strike Banner */}
      {trustStatus && trustStatus.trustLevel !== 'clean' && (
        <StrikeBadge />
      )}

      <div className={styles.dashboardGrid}>
        {/* Wallet Section */}
        <WalletCard />

        {/* Payment Mode + Summary Card */}
        <div className={styles.summaryCard}>
          <div className={styles.summaryHeader}>
            <h3>Payment Settings</h3>
            <Settings size={18} className={styles.settingsIcon} />
          </div>
          
          {/* Payment Mode Toggle */}
          <div className={styles.paymentModeSection}>
            <span className={styles.modeLabel}>Default Payment Mode</span>
            <div className={styles.modeToggle}>
              <button
                className={`${styles.modeBtn} ${user?.preferredPaymentMode !== 'wallet' ? styles.modeBtnActive : ''}`}
                onClick={() => setPaymentMode('pay_on_go')}
                id="mode-pay-on-go"
              >
                <CreditCard size={14} /> Pay-on-Go
              </button>
              <button
                className={`${styles.modeBtn} ${user?.preferredPaymentMode === 'wallet' ? styles.modeBtnActive : ''}`}
                onClick={() => setPaymentMode('wallet')}
                id="mode-wallet"
              >
                <Wallet size={14} /> Wallet Auto-Pay
              </button>
            </div>
          </div>

          <div className={styles.modeSummary}>
            {user?.preferredPaymentMode === 'wallet' ? (
              <>
                <CheckCircle2 size={14} style={{ color: '#a7f3d0' }} />
                <span>Orders will auto-deduct from your wallet. No payment links needed.</span>
              </>
            ) : (
              <>
                <ArrowRightLeft size={14} style={{ color: '#60a5fa' }} />
                <span>You'll receive a payment link when your order is ready.</span>
              </>
            )}
          </div>

          {totalDue > 0 && (
            <div className={styles.outstandingBox}>
              <div className={styles.outstandingLabel}>Outstanding Balance</div>
              <div className={styles.outstandingAmount}>₹{totalDue.toFixed(2)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Invoices List */}
      <div className={styles.invoicesSection}>
        <div className={styles.tabs}>
          <button 
            className={`${styles.tab} ${activeTab === 'unpaid' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('unpaid')}
          >
            Unpaid
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'paid' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('paid')}
          >
            Paid History
          </button>
          <button 
            className={`${styles.tab} ${activeTab === 'all' ? styles.activeTab : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Invoices
          </button>
        </div>

        {/* Outcome of a download or send. Shown here rather than as a
            toast because "your mail server is not configured" is a
            sentence somebody needs to be able to read twice. */}
        {notice && (
          <div className={notice.kind === 'ok' ? styles.noticeOk : styles.noticeError}>
            {notice.text}
            <button className={styles.noticeClose} onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
          </div>
        )}

        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date Issued</th>
                <th>Cases Included</th>
                <th>Amount (Incl. GST)</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.length === 0 ? (
                <tr>
                  <td colSpan="6" className={styles.emptyState}>
                    <FileText size={32} />
                    <p>No invoices found in this category.</p>
                  </td>
                </tr>
              ) : (
                filteredInvoices.map(inv => (
                  <tr key={inv.id} className={styles.tableRow}>
                    <td className={styles.idCell}>
                      <strong>{inv.id}</strong>
                    </td>
                    <td>{inv.date}</td>
                    <td className={styles.casesCell}>
                      {(inv.cases || []).map(c => <span key={c} className={styles.caseTag}>{c}</span>)}
                    </td>
                    {/* The column says "incl. GST", so show the gross.
                        `inv.amount` is the TAXABLE value on a per-case
                        invoice, so this cell was understating every one
                        of them by the tax — ₹1,800 where ₹1,890 was
                        charged. grossPaise is computed server-side and
                        is correct for both invoice types. */}
                    <td className={styles.amountCell}>
                      ₹{((inv.grossPaise ?? Math.round(inv.amount * 100)) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[inv.status]}`}>
                        {inv.status === 'paid' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                        {inv.status.toUpperCase()}
                      </span>
                    </td>
                    <td className={styles.actionCell}>
                      <button className={styles.downloadBtn} title="Download tax invoice (PDF)" onClick={() => handleDownloadPDF(inv)}>
                        <Download size={16} />
                      </button>
                      <button
                        className={styles.downloadBtn}
                        title={inv.emailedAt ? 'Email me another copy' : 'Email me this invoice'}
                        onClick={() => handleEmail(inv)}
                        disabled={emailing === inv.id}
                      >
                        <Mail size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Billing;
