import React, { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import styles from './Login.module.css';

const HOME_BY_ROLE = {
  admin:        '/admin',
  manager:      '/manager',
  technician:   '/tech',
  cad_designer: '/designer',
  ceramist:     '/ceramist',
  dispatch:     '/dispatch',
  clinic:       '/',
};

const Login = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated, user } = useAuth();
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [showPw, setShowPw]       = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  if (isAuthenticated && user) {
    return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);

    if (result.success) {
      const role = result.user?.role;
      if (role === 'clinic' && result.user?.onboardingComplete === false) {
        navigate('/onboarding');
      } else {
        navigate(HOME_BY_ROLE[role] || '/');
      }
    } else {
      setError(result.message || 'Invalid credentials.');
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
              <div className={styles.brandTag}>Dental Lab Workflow Management</div>
            </div>
          </div>

          {/* ── Heading ── */}
          <div className={styles.heading}>
            <h1 className={styles.headingTitle}>Welcome back</h1>
            <p className={styles.headingSubtitle}>Sign in to your account to continue</p>
          </div>

          {/* ── Form ── */}
          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            {error && (
              <div className={styles.errorBanner} role="alert">
                <span className={styles.errorDot} />
                {error}
              </div>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor="login-email">Email or Username</label>
              <div className={styles.inputWrap}>
                <Mail size={15} className={styles.inputIcon} />
                <input
                  id="login-email"
                  className={styles.input}
                  type="text"
                  placeholder="you@clinic.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
            </div>

            <div className={styles.field}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label className={styles.label} htmlFor="login-password">Password</label>
                <Link to="/forgot-password" style={{ fontSize: '12px', color: '#6366f1', textDecoration: 'none' }}>
                  Forgot Password?
                </Link>
              </div>
              <div className={styles.inputWrap}>
                <Lock size={15} className={styles.inputIcon} />
                <input
                  id="login-password"
                  className={styles.input}
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className={styles.eyeBtn}
                  onClick={() => setShowPw(v => !v)}
                  tabIndex={-1}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              id="login-submit"
              type="submit"
              className={styles.submitBtn}
              disabled={loading || !email || !password}
            >
              {loading ? (
                <span className={styles.spinner} />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* ── Status ── */}
          <div className={styles.statusRow}>
            <span className={styles.statusDot} />
            <span className={styles.statusText}>All systems operational</span>
          </div>

          <p className={styles.footer}>
            Access controlled by your assigned role · Hesyra Labs
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
