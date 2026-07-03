import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import styles from './Toast.module.css';

const Toast = ({ id, message, type = 'info', duration = 3000, onClose }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onClose, 300); // Wait for transition
    }, duration - 300);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const icons = {
    success: <CheckCircle2 className={styles.iconSuccess} size={18} />,
    error: <AlertCircle className={styles.iconError} size={18} />,
    warning: <AlertTriangle className={styles.iconWarning} size={18} />,
    info: <Info className={styles.iconInfo} size={18} />,
  };

  return (
    <div className={`${styles.toast} ${styles[type]} ${isExiting ? styles.exit : ''}`}>
      <div className={styles.iconContainer}>
        {icons[type]}
      </div>
      <div className={styles.message}>{message}</div>
      <button className={styles.closeBtn} onClick={() => {
        setIsExiting(true);
        setTimeout(onClose, 300);
      }}>
        <X size={14} />
      </button>
    </div>
  );
};

export default Toast;
