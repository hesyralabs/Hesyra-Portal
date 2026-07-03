import React from 'react';
import { AlertOctagon, Mail, LogOut, ArrowRight, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { usePayment } from '../../context/PaymentContext';
import styles from './SuspensionScreen.module.css';

const SuspensionScreen = () => {
  const { logout, user } = useAuth();
  const { trustStatus } = usePayment();

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.iconWrapper}>
          <AlertOctagon size={48} className={styles.icon} />
        </div>
        
        <h1 className={styles.title}>Account Suspended</h1>
        
        <div className={styles.messageBox}>
          <p>
            Dr. {user?.name}, your Hesyra Portal access has been temporarily suspended.
          </p>
          <p>
            This action was taken automatically by the system due to <strong>3 consecutive unpaid orders</strong> (Strike 3) violating our payment terms.
          </p>
        </div>

        <div className={styles.infoGrid}>
          <div className={styles.infoBlock}>
            <span className={styles.infoLabel}>Outstanding Balance</span>
            <span className={styles.infoValue}>₹{trustStatus ? (trustStatus.overdueAmountPaise / 100).toFixed(2) : '0.00'}</span>
          </div>
          <div className={styles.infoBlock}>
            <span className={styles.infoLabel}>Account Status</span>
            <span className={styles.infoValueDanger}>Suspended (Strike 3)</span>
          </div>
        </div>

        <div className={styles.nextSteps}>
          <h3>How to resolve this?</h3>
          <ol>
            <li>Clear all overdue payments via the payment links sent to your registered email/phone.</li>
            <li>Submit a resolution request outlining your case.</li>
            <li>Our billing team will review your account and reinstate access within 24-48 hours.</li>
          </ol>
        </div>

        <div className={styles.actions}>
          <button className={styles.btnPrimary} onClick={() => window.open('mailto:billing@hesyra.com', '_blank')}>
            <Mail size={16} /> Contact Billing Support
          </button>
          <button className={styles.btnSecondary} onClick={logout}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>

        <div className={styles.footer}>
          <p>Urgent case pending? Call support at <a href="tel:+918000000000"><Phone size={12}/> +91 8000 000 000</a></p>
        </div>
      </div>
    </div>
  );
};

export default SuspensionScreen;
