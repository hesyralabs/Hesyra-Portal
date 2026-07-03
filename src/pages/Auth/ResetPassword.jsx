import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Lock, ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import styles from './Login.module.css';

const ResetPassword = () => {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [errorMessage, setErrorMessage] = useState('');
  
  const navigate = useNavigate();
  const location = useLocation();
  const token = new URLSearchParams(location.search).get('token');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Invalid or missing reset token.');
    }
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token || !password || !confirmPassword) return;

    if (password !== confirmPassword) {
      setStatus('error');
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setStatus('error');
      setErrorMessage('Password must be at least 8 characters.');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await response.json();

      if (data.success) {
        setStatus('success');
      } else {
        setStatus('error');
        setErrorMessage(data.message || 'Failed to reset password.');
      }
    } catch (err) {
      console.error('Reset password error:', err);
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
              <div className={styles.brandTag}>Security Suite</div>
            </div>
          </div>

          {/* ── Heading ── */}
          <div className={styles.heading}>
            <h1 className={styles.headingTitle}>{status === 'success' ? 'All Set!' : 'New Password'}</h1>
            <p className={styles.headingSubtitle}>
              {status === 'success' 
                ? 'Your password has been updated successfully.' 
                : (token ? 'Enter your new credentials below' : 'Security token is missing or invalid')}
            </p>
          </div>

          {status === 'success' ? (
            <div style={{ textAlign: 'center', padding: '1rem 0' }}>
              <div style={{ 
                width: '60px', height: '60px', borderRadius: '50%', 
                background: 'rgba(16, 185, 129, 0.1)', display: 'flex', 
                alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem',
                border: '1px solid rgba(16, 185, 129, 0.2)'
              }}>
                <CheckCircle2 size={30} color="#10b981" />
              </div>
              <button 
                onClick={() => navigate('/login')}
                className={styles.submitBtn}
                style={{ width: '100%' }}
              >
                Log In Now
              </button>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              {status === 'error' && (
                <div className={styles.errorBanner}>
                  <span className={styles.errorDot} />
                  {errorMessage}
                </div>
              )}

              {token && (
                <>
                  <div className={styles.field}>
                    <label className={styles.label}>New Password</label>
                    <div className={styles.inputWrap}>
                      <Lock className={styles.inputIcon} size={15} />
                      <input
                        className={styles.input}
                        type={showPw ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className={styles.eyeBtn}
                        onClick={() => setShowPw(v => !v)}
                        tabIndex={-1}
                      >
                        {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label}>Confirm Password</label>
                    <div className={styles.inputWrap}>
                      <Lock className={styles.inputIcon} size={15} />
                      <input
                        className={styles.input}
                        type={showPw ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <button 
                    type="submit" 
                    className={styles.submitBtn}
                    disabled={status === 'loading' || !password || !confirmPassword}
                  >
                    {status === 'loading' ? (
                      <span className={styles.spinner} />
                    ) : (
                      <span>Reset Password</span>
                    )}
                  </button>
                </>
              )}
              
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

export default ResetPassword;
