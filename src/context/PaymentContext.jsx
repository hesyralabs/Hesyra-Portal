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
      // 1. Create the order server-side. The key id comes back with it —
      //    it is the publishable half of the pair and the only one that
      //    may ever reach the browser.
      const { order, keyId } = await walletAPI.reload(amountPaise);
      if (!order?.orderId) throw new Error('Order creation failed');

      // 2. Open Native UI. Razorpay's own field names differ from ours:
      //    it wants `amount` and `order_id`, we return `amountPaise` and
      //    `orderId`. Reading order.id/order.amount here yielded
      //    undefined and the checkout never opened.
      const result = await openRazorpayCheckout({
        key: keyId,
        amount: order.amountPaise,
        currency: order.currency,
        name: 'Hesyra Labs',
        description: 'Wallet Reload',
        order_id: order.orderId,
        prefill: {
          name: user?.name,
          email: user?.email,
        },
        theme: { color: '#001A33' }
      });

      if (result.success) {
        // The order.paid webhook is what actually credits the wallet.
        // Verifying here as well means the balance updates as soon as
        // the dentist closes the checkout instead of after an arbitrary
        // wait — and because both paths credit through the same
        // idempotent function, whichever lands second does nothing.
        //
        // This used to be a bare 2-second setTimeout before a refresh,
        // which showed a stale balance whenever the webhook was slower
        // than that and never corrected itself.
        try {
          const verified = await walletAPI.verifyReload({
            razorpay_order_id: result.response?.razorpay_order_id || order.orderId,
            razorpay_payment_id: result.response?.razorpay_payment_id,
            razorpay_signature: result.response?.razorpay_signature,
            amountPaise,
          });
          addToast(
            `Wallet reloaded — ₹${((verified.newBalance ?? 0) / 100).toLocaleString('en-IN')} available`,
            'success'
          );
        } catch {
          // Verification failing does not mean the payment failed — the
          // webhook is still authoritative. Say so rather than implying
          // the money is lost.
          addToast('Payment received. Updating your balance…', 'success');
        }
        await refreshWallet();
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
