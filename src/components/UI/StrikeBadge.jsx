import React from 'react';
import { AlertTriangle, Shield, ShieldAlert } from 'lucide-react';
import { usePayment } from '../../context/PaymentContext';
import './StrikeBadge.css';

const StrikeBadge = ({ compact = false }) => {
  const { trustStatus, paiseToINR } = usePayment();

  if (!trustStatus || trustStatus.trustLevel === 'clean') return null;

  const { strikeCount, trustLevel, depositRequired } = trustStatus;

  if (compact) {
    return (
      <span className={`strike-badge-compact ${trustLevel}`} id="strike-badge-compact">
        {trustLevel === 'suspended' || trustLevel === 'banned'
          ? <ShieldAlert size={12} />
          : <AlertTriangle size={12} />
        }
        {strikeCount} Strike{strikeCount !== 1 ? 's' : ''}
      </span>
    );
  }

  return (
    <div className={`strike-banner ${trustLevel}`} id="strike-banner">
      <div className="strike-banner-icon">
        {trustLevel === 'suspended' || trustLevel === 'banned'
          ? <ShieldAlert size={20} />
          : <AlertTriangle size={20} />
        }
      </div>
      <div className="strike-banner-content">
        <h4 className="strike-banner-title">
          {trustLevel === 'suspended'
            ? 'Account Suspended'
            : `Strike ${strikeCount} — ${trustLevel === 'strike_1' ? 'Warning' : 'Restricted'}`
          }
        </h4>
        <p className="strike-banner-desc">
          {trustLevel === 'suspended'
            ? 'Your account is suspended due to repeated unpaid orders. Submit a resolution ticket to regain access.'
            : `Future orders require a ${paiseToINR(depositRequired)} non-refundable deposit at placement.`
          }
        </p>
      </div>
    </div>
  );
};

export default StrikeBadge;
