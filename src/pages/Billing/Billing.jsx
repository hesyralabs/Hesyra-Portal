import React, { useState } from 'react';
import { CreditCard, Download, FileText, CheckCircle2, Clock, AlertCircle, Wallet, ArrowRightLeft, Shield, Settings } from 'lucide-react';
import html2pdf from 'html2pdf.js';
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

  const userInvoices = invoices.filter(inv => inv.clinic === user?.clinic);
  const filteredInvoices = userInvoices.filter(inv => activeTab === 'all' || inv.status === activeTab);
  const totalDue = userInvoices.filter(inv => inv.status === 'unpaid').reduce((sum, inv) => sum + inv.amount, 0);

  const handleDownloadPDF = async (inv) => {
    const caseItems = (inv.cases || []).map(caseId => {
      return { id: caseId, desc: 'Digital Manufacturing Services', amount: inv.amount / (inv.cases?.length || 1) };
    });

    const subtotal = inv.amount;
    const gstRate = inv.gstRate || 0.12;
    const taxableAmount = subtotal / (1 + gstRate);
    const taxAmount = subtotal - taxableAmount;
    const cgst = taxAmount / 2;
    const sgst = taxAmount / 2;

    const element = document.createElement('div');
    element.style.padding = '40px 50px';
    element.style.fontFamily = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
    element.style.color = '#1e293b';
    element.style.background = '#ffffff';
    element.style.width = '794px';
    element.style.boxSizing = 'border-box';
    
    element.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #001A33; padding-bottom: 24px; margin-bottom: 32px;">
        <div style="display: flex; align-items: center; gap: 16px;">
          <div style="width: 48px; height: 48px; background: #001A33; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #7A9C96; font-weight: bold; font-size: 24px; font-family: serif;">H</div>
          <div>
            <h1 style="margin: 0; color: #001A33; font-size: 28px; font-weight: 800; letter-spacing: -0.5px;">Hesyra Dental Lab</h1>
            <p style="margin: 4px 0 0; color: #64748b; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px;">Precision Digital Manufacturing</p>
            <p style="margin: 2px 0 0; color: #94a3b8; font-size: 11px;">GSTIN: ${inv.gstin || '27XXXXX0000X1Z5'}</p>
          </div>
        </div>
        <div style="text-align: right;">
          <h2 style="margin: 0; color: #0f172a; font-size: 32px; font-weight: 300; letter-spacing: 2px;">TAX INVOICE</h2>
          <p style="margin: 8px 0 0; font-weight: 600; font-family: monospace; color: #334155; font-size: 16px;">#${inv.id}</p>
          <p style="margin: 4px 0 0; color: #64748b; font-size: 13px;">Date: ${inv.date}</p>
        </div>
      </div>
      
      <div style="display: flex; justify-content: space-between; margin-bottom: 40px; font-size: 14px; line-height: 1.6;">
        <div>
          <h3 style="margin: 0 0 12px; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Billed To</h3>
          <p style="margin: 0; font-weight: 600; color: #0f172a; font-size: 16px;">${user?.clinic || 'Hesyra Client'}</p>
          <p style="margin: 4px 0 0; color: #475569;">${user?.name || 'Dr. Dentist'}</p>
        </div>
        <div style="text-align: right;">
          <h3 style="margin: 0 0 12px; color: #94a3b8; font-size: 11px; text-transform: uppercase; letter-spacing: 1px;">Payment Status</h3>
          <div style="display: inline-block; padding: 6px 12px; border-radius: 6px; font-weight: 600; font-size: 13px; 
            background: ${inv.status === 'paid' ? '#dcfce7' : '#fee2e2'}; 
            color: ${inv.status === 'paid' ? '#166534' : '#991b1b'};">
            ${inv.status.toUpperCase()}
          </div>
        </div>
      </div>

      <table style="width: 100%; border-collapse: separate; border-spacing: 0; margin-bottom: 32px; font-size: 13px;">
        <thead>
          <tr>
            <th style="padding: 14px 16px; background: #f8fafc; text-align: left; border-top-left-radius: 8px; border-bottom-left-radius: 8px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Item / HSN</th>
            <th style="padding: 14px 16px; background: #f8fafc; text-align: right; border-top-right-radius: 8px; border-bottom-right-radius: 8px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${caseItems.map(item => `
            <tr>
              <td style="padding: 16px; border-bottom: 1px solid #e2e8f0;">
                <div style="font-weight: 600; color: #0f172a; margin-bottom: 4px;">${item.id}</div>
                <div style="color: #64748b; font-size: 12px;">${item.desc} | HSN: ${inv.hsnCode || '9021'}</div>
              </td>
              <td style="padding: 16px; border-bottom: 1px solid #e2e8f0; text-align: right; font-weight: 500; color: #334155;">
                ₹${item.amount.toFixed(2)}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div style="display: flex; justify-content: flex-end; margin-bottom: 48px;">
        <div style="width: 320px; background: #f8fafc; padding: 24px; border-radius: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; color: #64748b; font-size: 14px;">
            <span>Taxable Amount</span>
            <span style="color: #334155; font-weight: 500;">₹${taxableAmount.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px; color: #64748b; font-size: 14px;">
            <span>CGST (${(gstRate * 50).toFixed(0)}%)</span>
            <span style="color: #334155; font-weight: 500;">₹${cgst.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 16px; color: #64748b; font-size: 14px;">
            <span>SGST (${(gstRate * 50).toFixed(0)}%)</span>
            <span style="color: #334155; font-weight: 500;">₹${sgst.toFixed(2)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding-top: 16px; border-top: 1px solid #cbd5e1; color: #0f172a; font-size: 18px; font-weight: 700;">
            <span>Total (Incl. GST)</span>
            <span>₹${subtotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      <div style="text-align: center; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; padding-top: 24px;">
        <p style="margin: 0 0 8px;">This is a computer-generated invoice. No signature required.</p>
        <p style="margin: 0;">Hesyra Labs | Amravati, Maharashtra | contact@hesyra.com</p>
      </div>
    `;

    const opt = {
      margin: 0,
      filename: `Hesyra_Invoice_${inv.id}.pdf`,
      image: { type: 'jpeg', quality: 1.0 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save();
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
                    <td className={styles.amountCell}>₹{inv.amount.toFixed(2)}</td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[inv.status]}`}>
                        {inv.status === 'paid' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                        {inv.status.toUpperCase()}
                      </span>
                    </td>
                    <td className={styles.actionCell}>
                      <button className={styles.downloadBtn} title="Download GST Invoice PDF" onClick={() => handleDownloadPDF(inv)}>
                        <Download size={16} />
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
