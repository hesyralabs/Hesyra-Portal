import React, { useState, useEffect } from 'react';
import { CreditCard, Clock, AlertTriangle, CheckCircle2, Shield, ExternalLink } from 'lucide-react';
import { usePayment } from '../../context/PaymentContext';
import './PaymentBanner.css';

const PaymentBanner = ({ caseData, onPaymentComplete }) => {
  const { simulatePayment, getPaymentStatus, paiseToINR, raiseDispute } = usePayment();
  const [paymentInfo, setPaymentInfo] = useState(null);
  const [paying, setPaying] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');

  const isPaymentState = ['ready_for_dispatch', 'payment_pending', 'overdue'].includes(caseData?.status);

  useEffect(() => {
    if (isPaymentState && caseData?.id) {
      getPaymentStatus(caseData.id).then(data => setPaymentInfo(data));
    }
  }, [caseData, isPaymentState, getPaymentStatus]);

  if (!isPaymentState || !caseData) return null;

  const daysRemaining = paymentInfo?.readyForDispatchAt
    ? Math.max(0, 7 - Math.floor((Date.now() - new Date(paymentInfo.readyForDispatchAt).getTime()) / (1000 * 60 * 60 * 24)))
    : 7;

  const isOverdue = caseData.status === 'overdue';
  const isUrgent = daysRemaining <= 2;
  const hasDispute = caseData.disputeActive || paymentInfo?.disputeActive;

  const handleSimulatePayment = async () => {
    setPaying(true);
    const result = await simulatePayment(caseData.id);
    setPaying(false);
    if (result?.success && onPaymentComplete) onPaymentComplete();
  };

  const handleRaiseDispute = async () => {
    if (!disputeReason.trim()) return;
    await raiseDispute(caseData.id, disputeReason);
    setShowDispute(false);
    setDisputeReason('');
  };

  const bannerClass = isOverdue ? 'payment-banner overdue' : isUrgent ? 'payment-banner urgent' : 'payment-banner';

  return (
    <div className={bannerClass} id="payment-banner">
      {/* Confirmed state */}
      {caseData.status === 'shipped' && paymentInfo?.paymentConfirmedAt && (
        <div className="payment-confirmed-badge">
          <CheckCircle2 size={16} /> Payment Confirmed
        </div>
      )}

      {/* Active dispute */}
      {hasDispute && (
        <div className="payment-dispute-active">
          <Shield size={16} />
          <span>Quality dispute raised — payment timer is paused</span>
        </div>
      )}

      {!hasDispute && (
        <>
          <div className="payment-banner-header">
            <div className="payment-banner-left">
              <CreditCard size={20} className="payment-icon" />
              <div>
                <h4 className="payment-title">
                  {isOverdue ? 'Payment Overdue' : 'Payment Required'}
                </h4>
                <p className="payment-subtitle">
                  {isOverdue
                    ? 'This order is overdue. A strike has been applied to your account.'
                    : 'Your product is ready. Pay to receive it within 48–72 hours.'
                  }
                </p>
              </div>
            </div>
            <div className="payment-amount" id="payment-amount-display">
              {paiseToINR(paymentInfo?.totalAmountPaise || caseData.totalAmountPaise)}
            </div>
          </div>

          {/* Timer */}
          {!isOverdue && (
            <div className="payment-timer" id="payment-timer">
              <Clock size={14} />
              <span>
                {daysRemaining > 0
                  ? `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining before strike`
                  : 'Strike will be applied today'}
              </span>
            </div>
          )}

          {/* Wallet deduction info */}
          {paymentInfo?.activePaymentLink?.walletDeductPaise > 0 && (
            <div className="payment-wallet-deduct">
              <CheckCircle2 size={12} />
              <span>{paiseToINR(paymentInfo.activePaymentLink.walletDeductPaise)} auto-deducted from wallet</span>
            </div>
          )}

          {/* Actions */}
          <div className="payment-actions">
            {paymentInfo?.activePaymentLink?.url && (
              <a
                href={paymentInfo.activePaymentLink.url}
                target="_blank"
                rel="noopener noreferrer"
                className="payment-link-btn"
                id="pay-now-link"
              >
                <ExternalLink size={14} /> Open Payment Link
              </a>
            )}

            <button
              className="payment-simulate-btn"
              onClick={handleSimulatePayment}
              disabled={paying}
              id="simulate-payment-btn"
            >
              {paying ? 'Processing...' : '⚡ Simulate Payment (Dev)'}
            </button>

            {!isOverdue && (
              <button
                className="payment-dispute-btn"
                onClick={() => setShowDispute(!showDispute)}
                id="raise-dispute-btn"
              >
                <AlertTriangle size={14} /> Raise Quality Dispute
              </button>
            )}
          </div>

          {/* Dispute Form */}
          {showDispute && (
            <div className="dispute-form" id="dispute-form">
              <textarea
                placeholder="Describe the quality issue..."
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                rows={3}
              />
              <div className="dispute-form-actions">
                <button onClick={() => setShowDispute(false)}>Cancel</button>
                <button className="dispute-submit" onClick={handleRaiseDispute}>Submit Dispute</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PaymentBanner;
