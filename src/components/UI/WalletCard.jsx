import React, { useState } from 'react';
import { Wallet, Plus, ArrowUpRight, ArrowDownLeft, Gift, AlertTriangle, ChevronDown, Zap } from 'lucide-react';
import { usePayment } from '../../context/PaymentContext';
import './WalletCard.css';

const RELOAD_AMOUNTS = [
  { label: '₹1,000', paise: 100000 },
  { label: '₹2,500', paise: 250000 },
  { label: '₹5,000', paise: 500000 },
  { label: '₹10,000', paise: 1000000, bonus: true },
];

const WalletCard = () => {
  const { wallet, walletLoading, reloadWallet, paiseToINR, setPaymentMode } = usePayment();
  const [showReload, setShowReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (!wallet) return null;

  const handleReload = async (amountPaise) => {
    setReloading(true);
    await reloadWallet(amountPaise);
    setReloading(false);
    setShowReload(false);
  };

  const TX_ICONS = {
    LOAD: <ArrowDownLeft size={14} />,
    ORDER_DEDUCT: <ArrowUpRight size={14} />,
    DEPOSIT_DEDUCT: <ArrowUpRight size={14} />,
    REFUND: <ArrowDownLeft size={14} />,
    BONUS_CREDIT: <Gift size={14} />,
    MANUAL_ADJUSTMENT: <Zap size={14} />,
  };

  const TX_COLORS = {
    CREDIT: '#10b981',
    DEBIT: '#ef4444',
  };

  return (
    <div className="wallet-card" id="wallet-card">
      <div className="wallet-header">
        <div className="wallet-logo">
          <Wallet size={20} />
          <span>Hesyra Wallet</span>
        </div>
        <button className="wallet-reload-btn" onClick={() => setShowReload(!showReload)} id="wallet-reload-toggle">
          <Plus size={14} /> Reload
        </button>
      </div>

      <div className="wallet-balance">
        <span className="wallet-balance-label">Available Balance</span>
        <span className="wallet-balance-amount" id="wallet-balance-display">
          {paiseToINR(wallet.balancePaise)}
        </span>
      </div>

      {wallet.lowBalance && (
        <div className="wallet-low-warning" id="wallet-low-warning">
          <AlertTriangle size={14} />
          <span>Low balance — reload to keep orders seamless</span>
        </div>
      )}

      <div className="wallet-stats">
        <div className="wallet-stat">
          <span className="wallet-stat-label">Total Loaded</span>
          <span className="wallet-stat-value">{paiseToINR(wallet.totalLoadedPaise)}</span>
        </div>
        <div className="wallet-stat">
          <span className="wallet-stat-label">Total Spent</span>
          <span className="wallet-stat-value">{paiseToINR(wallet.totalSpentPaise)}</span>
        </div>
      </div>

      {/* Reload Panel */}
      {showReload && (
        <div className="wallet-reload-panel" id="wallet-reload-panel">
          <div className="reload-title">Quick Reload</div>
          <div className="reload-amounts">
            {RELOAD_AMOUNTS.map(amt => (
              <button
                key={amt.paise}
                className={`reload-amount-btn ${amt.bonus ? 'reload-bonus' : ''}`}
                onClick={() => handleReload(amt.paise)}
                disabled={reloading}
                id={`reload-btn-${amt.paise}`}
              >
                {amt.label}
                {amt.bonus && <span className="bonus-tag">+₹500 bonus</span>}
              </button>
            ))}
          </div>
          <p className="reload-note">Minimum reload: ₹1,000 • UPI / Card / Net Banking</p>
        </div>
      )}

      {/* Recent Transactions */}
      <button
        className="wallet-history-toggle"
        onClick={() => setShowHistory(!showHistory)}
        id="wallet-history-toggle"
      >
        Recent Transactions <ChevronDown size={14} style={{ transform: showHistory ? 'rotate(180deg)' : 'none' }} />
      </button>

      {showHistory && wallet.transactions && (
        <div className="wallet-history" id="wallet-history">
          {wallet.transactions.length === 0 ? (
            <div className="wallet-history-empty">No transactions yet</div>
          ) : (
            wallet.transactions.map(tx => (
              <div key={tx.id} className="wallet-tx-row">
                <div className="wallet-tx-icon" style={{ color: TX_COLORS[tx.direction] }}>
                  {TX_ICONS[tx.type] || <Zap size={14} />}
                </div>
                <div className="wallet-tx-info">
                  <span className="wallet-tx-desc">{tx.description}</span>
                  <span className="wallet-tx-time">{new Date(tx.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                </div>
                <span className="wallet-tx-amount" style={{ color: TX_COLORS[tx.direction] }}>
                  {tx.direction === 'CREDIT' ? '+' : '−'}{tx.amountINR}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default WalletCard;
