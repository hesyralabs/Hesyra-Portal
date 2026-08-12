import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { walletAPI, strikesAPI, paymentAPI } from '../utils/api';
import { useToasts } from './ToastContext';
import { useAuth } from './AuthContext';

const PaymentContext = createContext(null);

export const PaymentProvider = ({ children }) => {
  const { addToast } = useToasts();
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [trustStatus, setTrustStatus] = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);

  // ─── Fetch wallet balance ───────────────────────────────
  const refreshWallet = useCallback(async () => {
    if (!user || user.role !== 'clinic') return;
    try {
      setWalletLoading(true);
      const data = await walletAPI.getBalance();
      setWallet(data);
    } catch (err) {
      console.error('Failed to fetch wallet:', err);
    } finally {
      setWalletLoading(false);
    }
  }, [user]);

  // ─── Fetch trust/strike status ──────────────────────────
  const refreshTrustStatus = useCallback(async () => {
    if (!user || user.role !== 'clinic') return;
    try {
      const data = await strikesAPI.getMyStatus();
      setTrustStatus(data);
    } catch (err) {
      console.error('Failed to fetch trust status:', err);
    }
  }, [user]);

  // Load on mount for dentists
  useEffect(() => {
    if (user?.role === 'clinic') {
      refreshWallet();
      refreshTrustStatus();
    }
  }, [user, refreshWallet, refreshTrustStatus]);

  // ─── Real-time wallet updates via Socket.io ─────────────────
  useEffect(() => {
    const socket = window.__hesyraSocket;
    if (!socket || user?.role !== 'clinic') return;

    const handleWalletUpdate = (data) => {
      // Only refresh if the event targets this user (or is a broadcast)
      if (!data?.userId || data.userId === user.id) {
        refreshWallet();
      }
    };

    const handleStrikeApplied = (data) => {
      if (data?.userId === user.id) {
        refreshTrustStatus();
        addToast('A strike has been applied to your account for a missed payment.', 'error');
      }
    };

    socket.on('wallet:updated', handleWalletUpdate);
    socket.on('strike:applied', handleStrikeApplied);

    return () => {
      socket.off('wallet:updated', handleWalletUpdate);
      socket.off('strike:applied', handleStrikeApplied);
    };
  }, [user, refreshWallet, refreshTrustStatus, addToast]);

  // ─── Native Razorpay Checkout Wrapper ──────────────────────
  const openRazorpayCheckout = useCallback((options) => {
    return new Promise((resolve) => {
      if (!window.Razorpay) {
        addToast('Payment gateway failed to load. Please check your connection.', 'error');
        resolve({ success: false, reason: 'script_missing' });
        return;
      }
      
      const rzpOptions = {
        ...options,
        handler: function (response) {
          resolve({ success: true, response });
        },
        modal: {
          ondismiss: function () {
            resolve({ success: false, reason: 'user_cancelled' });
          }
        }
      };
      
      const rzp = new window.Razorpay(rzpOptions);
      rzp.on('payment.failed', function (response) {
        addToast(`Payment failed: ${response.error.description}`, 'error');
        resolve({ success: false, response: response.error });
      });
      rzp.open();
    });
  }, [addToast]);

  // ─── Wallet Reload (Secure Native Checkout) ──────────────────
  const reloadWallet = useCallback(async (amountPaise) => {
    try {
      // 1. Create Order backend
      const { order, bonusEligible, bonusAmount } = await walletAPI.reload(amountPaise);
      if (!order) throw new Error('Order creation failed');

      // 2. Open Native UI
      const result = await openRazorpayCheckout({
        key: 'rzp_test_stub', // Replaced dynamically or from window.env ideally, but Razorpay checkout allows test keys safely client side. We'll use a placeholder or let the backend issue short-lived keys in V2.
        amount: order.amount,
        currency: order.currency,
        name: 'Hesyra Labs',
        description: 'Wallet Reload',
        order_id: order.id,
        prefill: {
          name: user?.name,
          email: user?.email,
        },
        theme: { color: '#001A33' }
      });

      if (result.success) {
        // Technically Webhooks handle DB update, but we optimistically refresh API
        addToast(`Payment successful! Processing wallet reload...`, 'success');
        
        // Wait 2s for webhook to clear DB
        setTimeout(() => refreshWallet(), 2000);
      }
      return result;
    } catch (err) {
      addToast(err.message || 'Wallet reload failed', 'error');
      return null;
    }
  }, [refreshWallet, addToast, user, openRazorpayCheckout]);

  // ─── Payment Mode ──────────────────────────────────────
  const setPaymentMode = useCallback(async (mode) => {
    try {
      await walletAPI.setPreferredMode(mode);
      addToast(`Payment mode set to ${mode === 'wallet' ? 'Hesyra Wallet' : 'Pay-on-Go'}`, 'success');
      refreshWallet();
    } catch (err) {
      addToast('Failed to update payment mode', 'error');
    }
  }, [refreshWallet, addToast]);

  // ─── Simulate Payment (dev mode) ──────────────────────
  const simulatePayment = useCallback(async (caseCustomId) => {
    try {
      const result = await paymentAPI.simulatePayment(caseCustomId);
      if (result.success) {
        addToast('Payment confirmed! Order dispatched.', 'success');
        refreshWallet();
      }
      return result;
    } catch (err) {
      addToast(err.message || 'Payment simulation failed', 'error');
      return null;
    }
  }, [refreshWallet, addToast]);

  // ─── Get Payment Status ───────────────────────────────
  const getPaymentStatus = useCallback(async (caseCustomId) => {
    try {
      return await paymentAPI.getStatus(caseCustomId);
    } catch (err) {
      console.error('Failed to get payment status:', err);
      return null;
    }
  }, []);

  // ─── Raise Dispute ─────────────────────────────────────
  const raiseDispute = useCallback(async (caseCustomId, reason) => {
    try {
      await paymentAPI.raiseDispute(caseCustomId, reason);
      addToast('Quality dispute raised. Payment timer paused.', 'info');
    } catch (err) {
      addToast(err.message || 'Failed to raise dispute', 'error');
    }
  }, [addToast]);

  // ─── Submit Resolution Ticket ──────────────────────────
  const submitResolutionTicket = useCallback(async (reason) => {
    try {
      const result = await strikesAPI.submitResolutionTicket(reason);
      if (result.success) {
        addToast('Resolution ticket submitted. We will review within 48 hours.', 'success');
      }
      return result;
    } catch (err) {
      addToast(err.message || 'Failed to submit ticket', 'error');
      return null;
    }
  }, [addToast]);

  // ─── Helpers ──────────────────────────────────────────
  const paiseToINR = (paise) => {
    if (!paise && paise !== 0) return '₹0.00';
    return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const isSuspended = trustStatus?.trustLevel === 'suspended' || trustStatus?.trustLevel === 'banned';
  const hasStrikes = trustStatus?.strikeCount > 0;

  return (
    <PaymentContext.Provider value={{
      wallet, walletLoading, trustStatus,
      refreshWallet, refreshTrustStatus,
      reloadWallet, setPaymentMode,
      simulatePayment, getPaymentStatus,
      openRazorpayCheckout,
      raiseDispute, submitResolutionTicket,
      paiseToINR,
      isSuspended, hasStrikes,
    }}>
      {children}
    </PaymentContext.Provider>
  );
};

export const usePayment = () => useContext(PaymentContext);
