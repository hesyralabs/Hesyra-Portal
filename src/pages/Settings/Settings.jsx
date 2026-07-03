import React, { useState, useEffect } from 'react';
import { User, Building2, Bell, Shield, Save, Palette, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import styles from './Settings.module.css';

const Settings = () => {
  const { user, changePassword, updateProfile } = useAuth();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('profile');
  
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

  const [notifications, setNotifications] = useState({
    actionRequired: true,
    designApproval: true,
    invoiceGenerated: true,
    caseShippedSms: false,
  });

  const [saveStatus, setSaveStatus] = useState({ loading: false, message: '', type: '' });

  // Load preferences from JSON string if they exist
  useEffect(() => {
    if (user?.notificationPreferences) {
      try {
        const prefs = JSON.parse(user.notificationPreferences);
        setNotifications(prev => ({ ...prev, ...prefs }));
      } catch (e) {
        console.error("Failed to parse notification preferences", e);
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
            <button className={`${styles.navItem} ${activeTab === 'notifications' ? styles.active : ''}`} onClick={() => setActiveTab('notifications')}>
              <Bell size={18} /> Notifications
            </button>
            <button className={`${styles.navItem} ${activeTab === 'preferences' ? styles.active : ''}`} onClick={() => setActiveTab('preferences')}>
              <Palette size={18} /> Preferences
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

            {activeTab === 'notifications' && (
              <form className={styles.section} onSubmit={handleSaveNotifications}>
                <h2 className={styles.sectionTitle}>Notification Preferences</h2>
                <p className={styles.sectionDesc}>Choose how you want to be alerted about case updates.</p>
                <div style={{display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px'}}>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" checked={notifications.actionRequired} onChange={e => setNotifications({...notifications, actionRequired: e.target.checked})} /> 
                    Email me when a case is marked "Action Required"
                  </label>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" checked={notifications.designApproval} onChange={e => setNotifications({...notifications, designApproval: e.target.checked})} /> 
                    Email me when a digital design needs approval
                  </label>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" checked={notifications.invoiceGenerated} onChange={e => setNotifications({...notifications, invoiceGenerated: e.target.checked})} /> 
                    Email me when an invoice is generated
                  </label>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" checked={notifications.caseShippedSms} onChange={e => setNotifications({...notifications, caseShippedSms: e.target.checked})} /> 
                    SMS text when a case ships
                  </label>
                </div>
                {renderSaveStatus()}
                <div className={styles.formActions} style={{marginTop: '24px'}}>
                  <button type="submit" className={styles.btnPrimary} disabled={saveStatus.loading}>
                    <Save size={16} /> {saveStatus.loading ? 'Saving...' : 'Save Preferences'}
                  </button>
                </div>
              </form>
            )}

            {activeTab === 'preferences' && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>App Preferences</h2>
                <div className={styles.formGrid}>
                  <div className={styles.inputGroupFull}>
                    <label>UI Theme</label>
                    <select 
                      value={theme} 
                      onChange={(e) => setTheme(e.target.value)}
                      style={{ padding: '10px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
                    >
                      <option value="brand">Brand Mode (Hesyra Default)</option>
                      <option value="dark">Dark Mode (High Contrast)</option>
                      <option value="light">Light Mode (Daytime)</option>
                    </select>
                  </div>
                </div>
              </div>
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
