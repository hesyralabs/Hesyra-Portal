import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import styles from './Login.module.css';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(data.message || 'Failed to request password reset.');
      }
    } catch (err) {
      console.error('Forgot password error:', err);
      setStatus('error');
      setErrorMessage('Network error. Please try again.');
    }
  };

  return (
    <div className={styles.root}>
      {/* Ambient background effects */}
      <div className={styles.orb1} />
      <div className={styles.orb2} />
      <div className={styles.orb3} />
      <div className={styles.gridOverlay} />

      <div className={styles.card}>
        <div className={styles.cardInner}>
          {/* ── Brand ── */}
          <div className={styles.brand}>
            <div className={styles.logoRing}>
              <img src="/logo.png" alt="Hesyra" className={styles.logoImg} />
            </div>
            <div>
              <div className={styles.brandName}>Hesyra Portal</div>
              <div className={styles.brandTag}>Account Recovery</div>
            </div>
          </div>

          {/* ── Heading ── */}
          <div className={styles.heading}>
            <h1 className={styles.headingTitle}>Reset Password</h1>
            <p className={styles.headingSubtitle}>Enter your email to receive a recovery link</p>
          </div>

          {status === 'success' ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ 
                width: '60px', height: '60px', borderRadius: '50%', 
                background: 'rgba(16, 185, 129, 0.1)', display: 'flex', 
                alignItems: 'center', justifyCenter: 'center', margin: '0 auto 1.5rem',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <CheckCircle2 size={30} color="#10b981" />
              </div>
              <h3 style={{ color: '#fff', fontSize: '1.125rem', marginBottom: '0.75rem' }}>Check your email</h3>
              <p style={{ color: 'rgba(255, 255, 255, 0.4)', fontSize: '0.875rem', marginBottom: '2rem', lineHeight: '1.5' }}>
                If an account exists for <strong>{email}</strong>, you will receive a reset link shortly.
              </p>
              <Link to="/login" className={styles.submitBtn} style={{ textDecoration: 'none' }}>
                Return to Login
              </Link>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              {status === 'error' && (
                <div className={styles.errorBanner}>
                  <span className={styles.errorDot} />
                  {errorMessage}
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label}>Email Address</label>
                <div className={styles.inputWrap}>
                  <Mail className={styles.inputIcon} size={15} />
                  <input
                    className={styles.input}
                    type="email"
                    placeholder="you@clinic.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <button 
                type="submit" 
                className={styles.submitBtn}
                disabled={status === 'loading' || !email}
              >
                {status === 'loading' ? (
                  <span className={styles.spinner} />
                ) : (
                  <span>Send Reset Link</span>
                )}
              </button>
              
              <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                <Link to="/login" style={{ color: 'rgba(255, 255, 255, 0.3)', fontSize: '0.8125rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                  <ArrowLeft size={14} /> Back to login
                </Link>
              </div>
            </form>
          )}

          <p className={styles.footer}>
            Access controlled by Hesyra Labs · Secure Authentication
          </p>
        </div>
      </div>
    </div>
  );
};

export default ForgotPassword;
