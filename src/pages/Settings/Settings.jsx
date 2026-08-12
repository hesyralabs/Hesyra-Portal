import React, { useState, useEffect } from 'react';
import { User, Building2, Bell, Shield, Save, Palette, AlertCircle, CheckCircle2,
  Truck, ClipboardCheck, Copy } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import styles from './Settings.module.css';

const Settings = () => {
  const { user, changePassword, updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState('profile');
  // Delivery and case preferences only mean anything for a clinic.
  const isClinic = user?.role === 'clinic';
  
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [passMessage, setPassMessage] = useState({ type: '', text: '' });

  // Form states initialized with user data
  const [profile, setProfile] = useState({
    name: user?.name || '',
    email: user?.email || '', // Email is typically read-only or requires verification
    phone: user?.phone || '',
    licenseNumber: user?.licenseNumber || ''
  });

  const [clinic, setClinic] = useState({
    clinic: user?.clinic || '',
    clinicAddress: user?.clinicAddress || '',
    clinicCity: user?.clinicCity || '',
    clinicState: user?.clinicState || '',
    clinicPinCode: user?.clinicPinCode || '',
    scannerModel: user?.scannerModel || 'none',
  });

  const [shipping, setShipping] = useState({
    shippingAddress: user?.shippingAddress || '',
    shippingCity: user?.shippingCity || '',
    shippingState: user?.shippingState || '',
    shippingPinCode: user?.shippingPinCode || '',
    preferredCourier: user?.preferredCourier || '',
    preferredContact: user?.preferredContact || 'phone',
  });

  const [workflow, setWorkflow] = useState({
    preferredPaymentMode: user?.preferredPaymentMode || 'pay_on_go',
    autoApproveDesigns: user?.autoApproveDesigns !== false,
  });

  const [notifications, setNotifications] = useState({
    actionRequired: true,
    designApproval: true,
    invoiceGenerated: true,
    caseShippedSms: false,
  });

  const [saveStatus, setSaveStatus] = useState({ loading: false, message: '', type: '' });

  // Re-seed every form whenever the signed-in user resolves or changes.
  // The initial useState values run once, before the session has been
  // restored on a hard refresh — without this the page shows empty
  // fields over perfectly good saved data, and saving blanks them.
  useEffect(() => {
    if (!user) return;

    setProfile({
      name: user.name || '',
      email: user.email || '',
      phone: user.phone || '',
      licenseNumber: user.licenseNumber || '',
    });

    setClinic({
      clinic: user.clinic || '',
      clinicAddress: user.clinicAddress || '',
      clinicCity: user.clinicCity || '',
      clinicState: user.clinicState || '',
      clinicPinCode: user.clinicPinCode || '',
      scannerModel: user.scannerModel || 'none',
    });

    setShipping({
      shippingAddress: user.shippingAddress || '',
      shippingCity: user.shippingCity || '',
      shippingState: user.shippingState || '',
      shippingPinCode: user.shippingPinCode || '',
      preferredCourier: user.preferredCourier || '',
      preferredContact: user.preferredContact || 'phone',
    });

    setWorkflow({
      preferredPaymentMode: user.preferredPaymentMode || 'pay_on_go',
      autoApproveDesigns: user.autoApproveDesigns !== false,
    });

    if (user.notificationPreferences) {
      try {
        setNotifications(prev => ({ ...prev, ...JSON.parse(user.notificationPreferences) }));
      } catch {
        // A malformed blob should not wipe the defaults.
      }
    }
  }, [user]);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (passwords.new.length < 8) {
      setPassMessage({ type: 'error', text: 'Password must be at least 8 characters.' });
      return;
    }
    
    const result = await changePassword(user.email, passwords.current, passwords.new);
    if (result.success) {
      setPassMessage({ type: 'success', text: 'Password updated securely.' });
      setPasswords({ current: '', new: '', confirm: '' });
    } else {
      setPassMessage({ type: 'error', text: result.message });
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaveStatus({ loading: true, message: '', type: '' });
    const result = await updateProfile(profile);
    if (result.success) {
      setSaveStatus({ loading: false, message: 'Profile updated successfully.', type: 'success' });
    } else {
      setSaveStatus({ loading: false, message: result.message, type: 'error' });
    }
    setTimeout(() => setSaveStatus({ loading: false, message: '', type: '' }), 3000);
  };

  const handleSaveClinic = async (e) => {
    e.preventDefault();
    setSaveStatus({ loading: true, message: '', type: '' });
    const result = await updateProfile(clinic);
    if (result.success) {
      setSaveStatus({ loading: false, message: 'Clinic details updated.', type: 'success' });
    } else {
      setSaveStatus({ loading: false, message: result.message, type: 'error' });
    }
    setTimeout(() => setSaveStatus({ loading: false, message: '', type: '' }), 3000);
  };

  // One save path for every section — keeps the status handling and the
  // "don't blank fields you didn't touch" behaviour identical.
  const saveSection = async (payload, successText) => {
    setSaveStatus({ loading: true, message: '', type: '' });
    const result = await updateProfile(payload);
    setSaveStatus({
      loading: false,
      message: result.success ? successText : result.message,
      type: result.success ? 'success' : 'error',
    });
    setTimeout(() => setSaveStatus({ loading: false, message: '', type: '' }), 3000);
    return result;
  };

  const handleSaveShipping = (e) => {
    e.preventDefault();
    return saveSection(shipping, 'Delivery details updated.');
  };

  const handleSaveWorkflow = (e) => {
    e.preventDefault();
    return saveSection(workflow, 'Case preferences updated.');
  };

  const copyClinicToShipping = () => {
    setShipping(s => ({
      ...s,
      shippingAddress: clinic.clinicAddress,
      shippingCity: clinic.clinicCity,
      shippingState: clinic.clinicState,
      shippingPinCode: clinic.clinicPinCode,
    }));
  };

  const handleSaveNotifications = async (e) => {
    e.preventDefault();
    setSaveStatus({ loading: true, message: '', type: '' });
    const result = await updateProfile({ notificationPreferences: JSON.stringify(notifications) });
    if (result.success) {
      setSaveStatus({ loading: false, message: 'Notification preferences saved.', type: 'success' });
    } else {
      setSaveStatus({ loading: false, message: result.message, type: 'error' });
    }
    setTimeout(() => setSaveStatus({ loading: false, message: '', type: '' }), 3000);
  };

  const renderSaveStatus = () => {
    if (!saveStatus.message) return null;
    return (
      <div style={{
        marginTop: '1rem', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px',
        backgroundColor: saveStatus.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
        color: saveStatus.type === 'error' ? '#ef4444' : '#10b981',
        border: `1px solid ${saveStatus.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`
      }}>
        {saveStatus.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
        {saveStatus.message}
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Manage your clinic profile and preferences.</p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav className={styles.nav}>
            <button className={`${styles.navItem} ${activeTab === 'profile' ? styles.active : ''}`} onClick={() => setActiveTab('profile')}>
              <User size={18} /> Doctor Profile
            </button>
            <button className={`${styles.navItem} ${activeTab === 'clinic' ? styles.active : ''}`} onClick={() => setActiveTab('clinic')}>
              <Building2 size={18} /> Clinic Details
            </button>
            {isClinic && (
              <button className={`${styles.navItem} ${activeTab === 'shipping' ? styles.active : ''}`} onClick={() => setActiveTab('shipping')}>
                <Truck size={18} /> Delivery
              </button>
            )}
            {isClinic && (
              <button className={`${styles.navItem} ${activeTab === 'workflow' ? styles.active : ''}`} onClick={() => setActiveTab('workflow')}>
                <ClipboardCheck size={18} /> Case Preferences
              </button>
            )}
            <button className={`${styles.navItem} ${activeTab === 'notifications' ? styles.active : ''}`} onClick={() => setActiveTab('notifications')}>
              <Bell size={18} /> Notifications
            </button>
            <button className={`${styles.navItem} ${activeTab === 'security' ? styles.active : ''}`} onClick={() => setActiveTab('security')}>
              <Shield size={18} /> Security
            </button>
          </nav>
        </aside>

        <main className={styles.content}>
          <div className={styles.card}>
            {activeTab === 'profile' && (
              <form className={styles.section} onSubmit={handleSaveProfile}>
                <h2 className={styles.sectionTitle}>Doctor Profile</h2>
                <div className={styles.formGrid}>
                  <div className={styles.inputGroupFull}>
                    <label>Full Name</label>
                    <input type="text" value={profile.name} onChange={e => setProfile({...profile, name: e.target.value})} required />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Email Address</label>
                    <input type="email" value={profile.email} disabled title="Email cannot be changed directly" />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Phone Number</label>
                    <input type="tel" value={profile.phone} onChange={e => setProfile({...profile, phone: e.target.value})} required />
                  </div>
                  <div className={styles.inputGroupFull}>
                    <label>License Number</label>
                    <input type="text" value={profile.licenseNumber} onChange={e => setProfile({...profile, licenseNumber: e.target.value})} required />
                  </div>
                </div>
                {renderSaveStatus()}
                <div className={styles.formActions}>
                  <button type="submit" className={styles.btnPrimary} disabled={saveStatus.loading}>
                    <Save size={16} /> {saveStatus.loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'clinic' && (
              <form className={styles.section} onSubmit={handleSaveClinic}>
                <h2 className={styles.sectionTitle}>Clinic Details</h2>
                <div className={styles.formGrid}>
                  <div className={styles.inputGroupFull}>
                    <label>Clinic Name</label>
                    <input type="text" value={clinic.clinic} onChange={e => setClinic({...clinic, clinic: e.target.value})} required />
                  </div>
                  <div className={styles.inputGroupFull}>
                    <label>Street Address</label>
                    <input type="text" value={clinic.clinicAddress} onChange={e => setClinic({...clinic, clinicAddress: e.target.value})} required />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>City</label>
                    <input type="text" value={clinic.clinicCity} onChange={e => setClinic({...clinic, clinicCity: e.target.value})} required />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>State & PIN</label>
                    <div style={{display: 'flex', gap: '8px'}}>
                      <input type="text" value={clinic.clinicState} onChange={e => setClinic({...clinic, clinicState: e.target.value})} style={{width: '70px'}} required />
                      <input type="text" value={clinic.clinicPinCode} onChange={e => setClinic({...clinic, clinicPinCode: e.target.value})} required />
                    </div>
                  </div>
                  <div className={styles.inputGroupFull}>
                    <label>Scanner Model (Optional)</label>
                    <select value={clinic.scannerModel} onChange={e => setClinic({...clinic, scannerModel: e.target.value})}>
                      <option value="none">No intraoral scanner</option>
                      <option value="itero">iTero Element</option>
                      <option value="medit">Medit i500/i700</option>
                      <option value="3shape">3Shape TRIOS</option>
                    </select>
                  </div>
                </div>
                {renderSaveStatus()}
                <div className={styles.formActions}>
                  <button type="submit" className={styles.btnPrimary} disabled={saveStatus.loading}>
                    <Save size={16} /> {saveStatus.loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'shipping' && isClinic && (
              <form className={styles.section} onSubmit={handleSaveShipping}>
                <h2 className={styles.sectionTitle}>Delivery Details</h2>
                <p className={styles.sectionDesc}>
                  Where finished cases are couriered. If this is blank the lab falls
                  back to your clinic address.
                </p>

                <button type="button" className={styles.btnGhost} onClick={copyClinicToShipping}>
                  <Copy size={14} /> Same as clinic address
                </button>

                <div className={styles.formGrid} style={{ marginTop: '1rem' }}>
                  <div className={styles.inputGroupFull}>
                    <label>Delivery Address</label>
                    <input type="text" value={shipping.shippingAddress}
                      placeholder="Street, building, landmark"
                      onChange={e => setShipping({ ...shipping, shippingAddress: e.target.value })} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>City</label>
                    <input type="text" value={shipping.shippingCity}
                      onChange={e => setShipping({ ...shipping, shippingCity: e.target.value })} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>State &amp; PIN</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="text" value={shipping.shippingState} style={{ width: '70px' }}
                        onChange={e => setShipping({ ...shipping, shippingState: e.target.value })} />
                      <input type="text" value={shipping.shippingPinCode}
                        onChange={e => setShipping({ ...shipping, shippingPinCode: e.target.value })} />
                    </div>
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Preferred Courier</label>
                    <select value={shipping.preferredCourier}
                      onChange={e => setShipping({ ...shipping, preferredCourier: e.target.value })}>
                      <option value="">No preference — lab decides</option>
                      <option value="BlueDart">BlueDart</option>
                      <option value="DTDC">DTDC</option>
                      <option value="Delhivery">Delhivery</option>
                      <option value="Professional">Professional Couriers</option>
                      <option value="Hesyra Rider">Hesyra rider (Nagpur only)</option>
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Dispatch Updates Via</label>
                    <select value={shipping.preferredContact}
                      onChange={e => setShipping({ ...shipping, preferredContact: e.target.value })}>
                      <option value="phone">Phone call</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="email">Email</option>
                    </select>
                  </div>
                </div>
                {renderSaveStatus()}
                <div className={styles.formActions}>
                  <button type="submit" className={styles.btnPrimary} disabled={saveStatus.loading}>
                    <Save size={16} /> {saveStatus.loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'workflow' && isClinic && (
              <form className={styles.section} onSubmit={handleSaveWorkflow}>
                <h2 className={styles.sectionTitle}>Case Preferences</h2>
                <p className={styles.sectionDesc}>
                  How your cases are paid for, and what happens if a design is left
                  waiting for your approval.
                </p>

                <div className={styles.settingBlock}>
                  <div className={styles.settingLabel}>Payment method</div>
                  <div className={styles.choiceList}>
                    {[
                      { id: 'pay_on_go', title: 'Pay per case',
                        desc: 'A payment link is sent when the case passes QC. Nothing leaves the lab until it is paid.' },
                      { id: 'wallet', title: 'Hesyra wallet',
                        desc: 'Top up in advance and each case is deducted automatically — no link to chase, faster dispatch.' },
                    ].map(opt => (
                      <button key={opt.id} type="button"
                        aria-pressed={workflow.preferredPaymentMode === opt.id}
                        className={`${styles.choice} ${workflow.preferredPaymentMode === opt.id ? styles.choiceSelected : ''}`}
                        onClick={() => setWorkflow({ ...workflow, preferredPaymentMode: opt.id })}>
                        <span className={styles.choiceTitle}>{opt.title}</span>
                        <span className={styles.choiceDesc}>{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.settingBlock}>
                  <div className={styles.settingLabel}>If a design is left unapproved</div>
                  <div className={styles.choiceList}>
                    {[
                      { id: true, title: 'Proceed automatically',
                        desc: 'After the approval window closes we start production on the design as sent, so the case is not delayed. You are reminded twice before this happens.' },
                      { id: false, title: 'Hold and escalate',
                        desc: 'Nothing is ever approved on your behalf. The case waits and the lab manager chases you. Safer, but it will push your delivery date.' },
                    ].map(opt => (
                      <button key={String(opt.id)} type="button"
                        aria-pressed={workflow.autoApproveDesigns === opt.id}
                        className={`${styles.choice} ${workflow.autoApproveDesigns === opt.id ? styles.choiceSelected : ''}`}
                        onClick={() => setWorkflow({ ...workflow, autoApproveDesigns: opt.id })}>
                        <span className={styles.choiceTitle}>{opt.title}</span>
                        <span className={styles.choiceDesc}>{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {renderSaveStatus()}
                <div className={styles.formActions}>
                  <button type="submit" className={styles.btnPrimary} disabled={saveStatus.loading}>
                    <Save size={16} /> {saveStatus.loading ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'notifications' && (
              <form className={styles.section} onSubmit={handleSaveNotifications}>
                <h2 className={styles.sectionTitle}>Alerts</h2>
                <p className={styles.sectionDesc}>
                  Which case events raise an alert in the portal. Turning one off
                  stops that alert immediately.
                </p>
                <div className={styles.toggleList}>
                  {[
                    { key: 'actionRequired',   label: 'Case needs my attention',     desc: 'A case is marked Action Required and cannot move without you.' },
                    { key: 'designApproval',   label: 'Design ready for approval',   desc: 'A CAD design is waiting on your clinical sign-off.' },
                    { key: 'invoiceGenerated', label: 'Invoice issued',              desc: 'A GST invoice has been raised against one of your cases.' },
                    { key: 'caseShipped',      label: 'Case dispatched',             desc: 'A finished case has left the lab, with courier and tracking.' },
                  ].map(row => (
                    <label key={row.key} className={styles.toggleRow}>
                      <input type="checkbox"
                        checked={notifications[row.key] !== false}
                        onChange={e => setNotifications({ ...notifications, [row.key]: e.target.checked })} />
                      <span className={styles.toggleBody}>
                        <span className={styles.toggleLabel}>{row.label}</span>
                        <span className={styles.toggleDesc}>{row.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className={styles.sectionNote}>
                  Email and SMS delivery is not switched on for this portal yet — these
                  control in-portal alerts. Once a mail/SMS provider is configured the
                  same preferences will drive it.
                </p>
                {renderSaveStatus()}
                <div className={styles.formActions} style={{marginTop: '24px'}}>
                  <button type="submit" className={styles.btnPrimary} disabled={saveStatus.loading}>
                    <Save size={16} /> {saveStatus.loading ? 'Saving...' : 'Save Preferences'}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'security' && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Security Settings</h2>
                <p className={styles.sectionDesc}>Update your password and secure your clinic account.</p>
                
                {passMessage.text && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '4px', fontSize: '0.85rem', backgroundColor: passMessage.type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)', color: passMessage.type === 'error' ? '#ef4444' : '#10b981', border: `1px solid ${passMessage.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}` }}>
                    {passMessage.type === 'error' ? <AlertCircle size={14} style={{display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom'}}/> : <CheckCircle2 size={14} style={{display: 'inline', marginRight: '6px', verticalAlign: 'text-bottom'}}/>}
                    {passMessage.text}
                  </div>
                )}

                <form onSubmit={handlePasswordChange}>
                  <div className={styles.formGrid} style={{marginTop: '16px'}}>
                    <div className={styles.inputGroupFull}>
                      <label>Current Password</label>
                      <input type="password" required value={passwords.current} onChange={e => setPasswords({...passwords, current: e.target.value})} placeholder="••••••••" />
                    </div>
                    <div className={styles.inputGroup}>
                      <label>New Password</label>
                      <input type="password" required value={passwords.new} onChange={e => setPasswords({...passwords, new: e.target.value})} placeholder="" />
                    </div>
                    <div className={styles.inputGroup}>
                      <label>Confirm Password</label>
                      <input type="password" required value={passwords.confirm} onChange={e => setPasswords({...passwords, confirm: e.target.value})} placeholder="" />
                    </div>
                  </div>
                  <div className={styles.formActions} style={{marginTop: '1.5rem'}}>
                    <button type="submit" className={styles.btnPrimary}><Shield size={16} /> Update Password</button>
                  </div>
                </form>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default Settings;
