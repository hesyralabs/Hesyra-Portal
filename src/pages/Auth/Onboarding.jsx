import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  ArrowRight, ArrowLeft, CheckCircle2, User, Building2, Truck, Lock,
  Phone, FileText, MapPin, ScanLine, Package, Mail, MessageSquare, Eye, EyeOff,
} from 'lucide-react';
import styles from './Onboarding.module.css';

const STEPS = [
  { id: 1, label: 'Identity', icon: User },
  { id: 2, label: 'Clinic', icon: Building2 },
  { id: 3, label: 'Shipping', icon: Truck },
  { id: 4, label: 'Security', icon: Lock },
];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram',
  'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Delhi', 'Jammu & Kashmir', 'Ladakh',
];

const SCANNERS = [
  { id: 'none', label: 'No Intraoral Scanner' },
  { id: 'itero', label: 'iTero Element' },
  { id: 'medit', label: 'Medit i500/i700' },
  { id: '3shape', label: '3Shape TRIOS' },
  { id: 'carestream', label: 'Carestream CS 3600/3800' },
  { id: 'other', label: 'Other' },
];

const COURIERS = [
  { id: 'delhivery', label: 'Delhivery' },
  { id: 'bluedart', label: 'BlueDart' },
  { id: 'dtdc', label: 'DTDC' },
  { id: 'indiapost', label: 'India Post (Speed Post)' },
  { id: 'professional', label: 'Professional Courier' },
];

const CONTACT_METHODS = [
  { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'sms', label: 'SMS', icon: Phone },
];

const Onboarding = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, completeOnboarding } = useAuth();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [sameAsClinic, setSameAsClinic] = useState(true);

  const [form, setForm] = useState({
    name: user?.name || '',
    phone: '',
    licenseNumber: '',
    clinic: user?.clinic || '',
    clinicAddress: '',
    clinicCity: '',
    clinicState: 'Maharashtra',
    clinicPinCode: '',
    scannerModel: 'none',
    shippingAddress: '',
    shippingCity: '',
    shippingState: 'Maharashtra',
    shippingPinCode: '',
    preferredCourier: 'delhivery',
    preferredContact: 'whatsapp',
    newPassword: '',
    confirmPassword: '',
  });

  // Guard: if not authenticated, go to login
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Guard: if already onboarded, go to dashboard
  if (user?.onboardingComplete) {
    if (user.role === 'admin') return <Navigate to="/admin" replace />;
    if (user.role === 'tech') return <Navigate to="/tech" replace />;
    return <Navigate to="/" replace />;
  }

  const updateField = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
  };

  // ─── Validation per step ──────────────────────────────────────
  const validateStep = (s) => {
    const e = {};
    if (s === 1) {
      if (!form.name.trim()) e.name = 'Required';
      if (!form.phone.trim()) e.phone = 'Required';
      else if (!/^[6-9]\d{9}$/.test(form.phone.replace(/\s/g, ''))) e.phone = 'Enter a valid 10-digit Indian mobile number';
      if (!form.licenseNumber.trim()) e.licenseNumber = 'Required';
    }
    if (s === 2) {
      if (!form.clinic.trim()) e.clinic = 'Required';
      if (!form.clinicAddress.trim()) e.clinicAddress = 'Required';
      if (!form.clinicCity.trim()) e.clinicCity = 'Required';
      if (!form.clinicPinCode.trim()) e.clinicPinCode = 'Required';
      else if (!/^\d{6}$/.test(form.clinicPinCode.trim())) e.clinicPinCode = 'Must be 6 digits';
    }
    if (s === 3) {
      if (!sameAsClinic) {
        if (!form.shippingAddress.trim()) e.shippingAddress = 'Required';
        if (!form.shippingCity.trim()) e.shippingCity = 'Required';
        if (!form.shippingPinCode.trim()) e.shippingPinCode = 'Required';
        else if (!/^\d{6}$/.test(form.shippingPinCode.trim())) e.shippingPinCode = 'Must be 6 digits';
      }
    }
    if (s === 4) {
      if (!form.newPassword) e.newPassword = 'Required';
      else if (form.newPassword.length < 8) e.newPassword = 'Minimum 8 characters';
      if (!form.confirmPassword) e.confirmPassword = 'Required';
      else if (form.newPassword !== form.confirmPassword) e.confirmPassword = 'Passwords do not match';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (!validateStep(step)) return;
    setStep(step + 1);
  };

  const handleBack = () => setStep(step - 1);

  const handleSubmit = async () => {
    if (!validateStep(4)) return;
    setSubmitting(true);

    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      licenseNumber: form.licenseNumber.trim(),
      clinic: form.clinic.trim(),
      clinicAddress: form.clinicAddress.trim(),
      clinicCity: form.clinicCity.trim(),
      clinicState: form.clinicState,
      clinicPinCode: form.clinicPinCode.trim(),
      scannerModel: form.scannerModel,
      shippingAddress: sameAsClinic ? form.clinicAddress.trim() : form.shippingAddress.trim(),
      shippingCity: sameAsClinic ? form.clinicCity.trim() : form.shippingCity.trim(),
      shippingState: sameAsClinic ? form.clinicState : form.shippingState,
      shippingPinCode: sameAsClinic ? form.clinicPinCode.trim() : form.shippingPinCode.trim(),
      preferredCourier: form.preferredCourier,
      preferredContact: form.preferredContact,
      newPassword: form.newPassword,
    };

    const result = await completeOnboarding(payload);
    setSubmitting(false);

    if (result.success) {
      setStep(5); // success screen
    }
  };

  // ─── Password Strength ────────────────────────────────────────
  const getPasswordStrength = (pw) => {
    if (!pw) return { pct: 0, label: '', color: 'transparent' };
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 1) return { pct: 20, label: 'Weak', color: '#ef4444' };
    if (score <= 2) return { pct: 40, label: 'Fair', color: '#f59e0b' };
    if (score <= 3) return { pct: 60, label: 'Good', color: '#eab308' };
    if (score <= 4) return { pct: 80, label: 'Strong', color: '#10b981' };
    return { pct: 100, label: 'Excellent', color: '#06d6a0' };
  };

  const pwStrength = getPasswordStrength(form.newPassword);

  // ─── Render ───────────────────────────────────────────────────
  return (
    <div className={styles.container}>
      <div className={styles.blob}></div>
      <div className={`${styles.blob} ${styles.blob2}`}></div>
      <div className={`${styles.blob} ${styles.blob3}`}></div>

      <div className={styles.card}>
        {/* Header */}
        <div className={styles.headerStrip}>
          <div className={styles.headerTop}>
            <div className={styles.logoWrapper}>
              <img src="/logo.png" alt="Hesyra" className={styles.logo} />
            </div>
            <div>
              <h1 className={styles.headerTitle}>Welcome to Hesyra</h1>
            </div>
          </div>
          <p className={styles.headerSubtitle}>
            Let's set up your profile so we can deliver the smoothest experience for your practice.
          </p>
        </div>

        {/* Step Indicator */}
        {step <= 4 && (
          <div className={styles.stepIndicator}>
            {STEPS.map((s, i) => (
              <React.Fragment key={s.id}>
                <div
                  className={`${styles.stepDot} ${step === s.id ? styles.active : ''} ${step > s.id ? styles.done : ''}`}
                >
                  {step > s.id ? <CheckCircle2 size={16} /> : s.id}
                </div>
                <span className={`${styles.stepLabel} ${step === s.id ? styles.active : ''}`}>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <div className={`${styles.stepLine} ${step > s.id ? styles.done : ''}`} />
                )}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ═════ STEP 1: Identity ═════ */}
        {step === 1 && (
          <>
            <div className={styles.body} key="step1">
              <h2 className={styles.sectionTitle}>Verify Your Identity</h2>
              <p className={styles.sectionDesc}>
                Confirm your professional details. This information will appear on all lab prescriptions.
              </p>
              <div className={styles.formGrid}>
                <div className={styles.inputGroupFull}>
                  <label>Full Name (as on dental license) {errors.name && <span className={styles.errorText}>— {errors.name}</span>}</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => updateField('name', e.target.value)}
                    placeholder="Dr. Pranjal Agarwal"
                    className={errors.name ? styles.inputError : ''}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label>Mobile Number {errors.phone && <span className={styles.errorText}>— {errors.phone}</span>}</label>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={e => updateField('phone', e.target.value)}
                    placeholder="9876543210"
                    maxLength={10}
                    className={errors.phone ? styles.inputError : ''}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label>Dental License / DCI No. {errors.licenseNumber && <span className={styles.errorText}>— {errors.licenseNumber}</span>}</label>
                  <input
                    type="text"
                    value={form.licenseNumber}
                    onChange={e => updateField('licenseNumber', e.target.value)}
                    placeholder="A-12345"
                    className={errors.licenseNumber ? styles.inputError : ''}
                  />
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <div />
              <button className={styles.btnNext} onClick={handleNext}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {/* ═════ STEP 2: Clinic Profile ═════ */}
        {step === 2 && (
          <>
            <div className={styles.body} key="step2">
              <h2 className={styles.sectionTitle}>Your Clinic</h2>
              <p className={styles.sectionDesc}>
                Tell us about your practice. This ensures accurate billing and delivery.
              </p>
              <div className={styles.formGrid}>
                <div className={styles.inputGroupFull}>
                  <label>Clinic Name {errors.clinic && <span className={styles.errorText}>— {errors.clinic}</span>}</label>
                  <input
                    type="text"
                    value={form.clinic}
                    onChange={e => updateField('clinic', e.target.value)}
                    placeholder="Smile Dental Clinic"
                    className={errors.clinic ? styles.inputError : ''}
                  />
                </div>
                <div className={styles.inputGroupFull}>
                  <label>Street Address {errors.clinicAddress && <span className={styles.errorText}>— {errors.clinicAddress}</span>}</label>
                  <input
                    type="text"
                    value={form.clinicAddress}
                    onChange={e => updateField('clinicAddress', e.target.value)}
                    placeholder="123 MG Road, Near City Hospital"
                    className={errors.clinicAddress ? styles.inputError : ''}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label>City {errors.clinicCity && <span className={styles.errorText}>— {errors.clinicCity}</span>}</label>
                  <input
                    type="text"
                    value={form.clinicCity}
                    onChange={e => updateField('clinicCity', e.target.value)}
                    placeholder="Amravati"
                    className={errors.clinicCity ? styles.inputError : ''}
                  />
                </div>
                <div className={styles.inputGroup}>
                  <label>PIN Code {errors.clinicPinCode && <span className={styles.errorText}>— {errors.clinicPinCode}</span>}</label>
                  <input
                    type="text"
                    value={form.clinicPinCode}
                    onChange={e => updateField('clinicPinCode', e.target.value)}
                    placeholder="444601"
                    maxLength={6}
                    className={errors.clinicPinCode ? styles.inputError : ''}
                  />
                </div>
                <div className={styles.inputGroupFull}>
                  <label>State</label>
                  <select value={form.clinicState} onChange={e => updateField('clinicState', e.target.value)}>
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className={styles.inputGroupFull}>
                  <label>Intraoral Scanner Model</label>
                  <select value={form.scannerModel} onChange={e => updateField('scannerModel', e.target.value)}>
                    {SCANNERS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <button className={styles.btnBack} onClick={handleBack}>
                <ArrowLeft size={16} /> Back
              </button>
              <button className={styles.btnNext} onClick={handleNext}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {/* ═════ STEP 3: Shipping & Preferences ═════ */}
        {step === 3 && (
          <>
            <div className={styles.body} key="step3">
              <h2 className={styles.sectionTitle}>Delivery & Communication</h2>
              <p className={styles.sectionDesc}>
                Where should we ship finished cases, and how would you like us to reach you?
              </p>
              <div className={styles.formGrid}>
                <label className={styles.toggleRow} onClick={() => setSameAsClinic(!sameAsClinic)}>
                  <input type="checkbox" checked={sameAsClinic} onChange={() => setSameAsClinic(!sameAsClinic)} />
                  <span>Ship to clinic address</span>
                </label>

                {!sameAsClinic && (
                  <>
                    <div className={styles.inputGroupFull}>
                      <label>Shipping Address {errors.shippingAddress && <span className={styles.errorText}>— {errors.shippingAddress}</span>}</label>
                      <input
                        type="text"
                        value={form.shippingAddress}
                        onChange={e => updateField('shippingAddress', e.target.value)}
                        placeholder="Alternate delivery address"
                        className={errors.shippingAddress ? styles.inputError : ''}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label>City {errors.shippingCity && <span className={styles.errorText}>— {errors.shippingCity}</span>}</label>
                      <input
                        type="text"
                        value={form.shippingCity}
                        onChange={e => updateField('shippingCity', e.target.value)}
                        className={errors.shippingCity ? styles.inputError : ''}
                      />
                    </div>
                    <div className={styles.inputGroup}>
                      <label>PIN Code {errors.shippingPinCode && <span className={styles.errorText}>— {errors.shippingPinCode}</span>}</label>
                      <input
                        type="text"
                        value={form.shippingPinCode}
                        onChange={e => updateField('shippingPinCode', e.target.value)}
                        maxLength={6}
                        className={errors.shippingPinCode ? styles.inputError : ''}
                      />
                    </div>
                    <div className={styles.inputGroupFull}>
                      <label>State</label>
                      <select value={form.shippingState} onChange={e => updateField('shippingState', e.target.value)}>
                        {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </>
                )}

                <div className={styles.inputGroupFull} style={{ marginTop: '0.5rem' }}>
                  <label>Preferred Courier</label>
                  <div className={styles.pillGroup}>
                    {COURIERS.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        className={`${styles.pill} ${form.preferredCourier === c.id ? styles.selected : ''}`}
                        onClick={() => updateField('preferredCourier', c.id)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.inputGroupFull}>
                  <label>Preferred Contact Method</label>
                  <div className={styles.pillGroup}>
                    {CONTACT_METHODS.map(m => {
                      const Icon = m.icon;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`${styles.pill} ${form.preferredContact === m.id ? styles.selected : ''}`}
                          onClick={() => updateField('preferredContact', m.id)}
                        >
                          <Icon size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <button className={styles.btnBack} onClick={handleBack}>
                <ArrowLeft size={16} /> Back
              </button>
              <button className={styles.btnNext} onClick={handleNext}>
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}

        {/* ═════ STEP 4: Security — Password ═════ */}
        {step === 4 && (
          <>
            <div className={styles.body} key="step4">
              <h2 className={styles.sectionTitle}>Secure Your Account</h2>
              <p className={styles.sectionDesc}>
                Your account was created with a temporary password. Set a personal, strong password now.
              </p>
              <div className={styles.formGrid}>
                <div className={styles.inputGroupFull}>
                  <label>New Password {errors.newPassword && <span className={styles.errorText}>— {errors.newPassword}</span>}</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.newPassword}
                      onChange={e => updateField('newPassword', e.target.value)}
                      placeholder="Minimum 8 characters"
                      className={errors.newPassword ? styles.inputError : ''}
                      style={{ paddingRight: '44px' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', color: 'var(--text-tertiary)',
                        cursor: 'pointer', padding: 4, display: 'flex',
                      }}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                {form.newPassword && (
                  <>
                    <div className={styles.strengthBar}>
                      <div
                        className={styles.strengthFill}
                        style={{ width: `${pwStrength.pct}%`, background: pwStrength.color }}
                      />
                    </div>
                    <div className={styles.strengthLabel} style={{ color: pwStrength.color }}>
                      {pwStrength.label}
                    </div>
                  </>
                )}
                <div className={styles.inputGroupFull}>
                  <label>Confirm Password {errors.confirmPassword && <span className={styles.errorText}>— {errors.confirmPassword}</span>}</label>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={e => updateField('confirmPassword', e.target.value)}
                    placeholder="Re-enter your new password"
                    className={errors.confirmPassword ? styles.inputError : ''}
                  />
                </div>
              </div>
            </div>
            <div className={styles.actions}>
              <button className={styles.btnBack} onClick={handleBack}>
                <ArrowLeft size={16} /> Back
              </button>
              <button
                className={styles.btnComplete}
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Setting up...' : 'Complete Setup'}
                {!submitting && <CheckCircle2 size={16} />}
              </button>
            </div>
          </>
        )}

        {/* ═════ STEP 5: Success ═════ */}
        {step === 5 && (
          <div className={styles.successScreen}>
            <CheckCircle2 size={80} className={styles.successIcon} />
            <h2>You're All Set!</h2>
            <p>
              Your profile is configured and your account is secured. 
              Welcome to the Hesyra ecosystem — let's get to work.
            </p>
            <button className={styles.successBtn} onClick={() => navigate('/')}>
              Enter Dashboard <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;
