import React, { useState } from 'react';
import { User, Printer, Bell, Shield, Save, Droplets, Palette } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import styles from './TechSettings.module.css';

const TechSettings = () => {
  const { user, changePassword } = useAuth();
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('profile');
  const [saved, setSaved] = useState(false);

  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });
  const [passMessage, setPassMessage] = useState({ type: '', text: '' });

  const handlePasswordChange = (e) => {
    e.preventDefault();
    if (passwords.new !== passwords.confirm) {
      setPassMessage({ type: 'error', text: 'New passwords do not match.' });
      return;
    }
    if (passwords.new.length < 4) {
      setPassMessage({ type: 'error', text: 'Password must be at least 4 characters.' });
      return;
    }
    
    const result = changePassword(user.email, passwords.current, passwords.new);
    if (result.success) {
      setPassMessage({ type: 'success', text: 'Password updated securely.' });
      setPasswords({ current: '', new: '', confirm: '' });
    } else {
      setPassMessage({ type: 'error', text: result.message });
    }
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Tech Settings</h1>
        <p className={styles.subtitle}>Configure your workspace, printers, and notification preferences.</p>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <nav className={styles.nav}>
            <button className={`${styles.navItem} ${activeTab === 'profile' ? styles.active : ''}`}
              onClick={() => setActiveTab('profile')}>
              <User size={18} /> My Profile
            </button>
            <button className={`${styles.navItem} ${activeTab === 'printers' ? styles.active : ''}`}
              onClick={() => setActiveTab('printers')}>
              <Printer size={18} /> Printer Setup
            </button>
            <button className={`${styles.navItem} ${activeTab === 'materials' ? styles.active : ''}`}
              onClick={() => setActiveTab('materials')}>
              <Droplets size={18} /> Resin Inventory
            </button>
            <button className={`${styles.navItem} ${activeTab === 'notifications' ? styles.active : ''}`}
              onClick={() => setActiveTab('notifications')}>
              <Bell size={18} /> Notifications
            </button>
            <button className={`${styles.navItem} ${activeTab === 'preferences' ? styles.active : ''}`}
              onClick={() => setActiveTab('preferences')}>
              <Palette size={18} /> Preferences
            </button>
            <button className={`${styles.navItem} ${activeTab === 'security' ? styles.active : ''}`}
              onClick={() => setActiveTab('security')}>
              <Shield size={18} /> Security
            </button>
          </nav>
        </aside>

        <main className={styles.content}>
          <div className={styles.card}>
            {/* PROFILE TAB */}
            {activeTab === 'profile' && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Technician Profile</h2>
                <div className={styles.formGrid}>
                  <div className={styles.inputGroup}>
                    <label>Full Name</label>
                    <input type="text" defaultValue={user?.name || 'Alex L.'} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Email</label>
                    <input type="email" defaultValue={user?.email || 'tech@hesyra.com'} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Tech ID</label>
                    <input type="text" defaultValue={user?.techId || 'T-001'} readOnly className={styles.readonly} />
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Specialization</label>
                    <select defaultValue="general">
                      <option value="general">General (All Case Types)</option>
                      <option value="crowns">Crowns & Bridges</option>
                      <option value="surgical">Surgical Guides</option>
                      <option value="ortho">Aligners & Retainers</option>
                      <option value="splints">Splints & Nightguards</option>
                    </select>
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button className={styles.btnPrimary} onClick={handleSave}>
                    <Save size={16} /> {saved ? 'Saved ✓' : 'Save Changes'}
                  </button>
                </div>
              </div>
            )}

            {/* PRINTER SETUP TAB */}
            {activeTab === 'printers' && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>3D Printer Configuration</h2>
                <p className={styles.sectionDesc}>Add and configure the printers connected to your workstation.</p>

                <div className={styles.printerList}>
                  <div className={styles.printerCard}>
                    <div className={styles.printerIcon}><Printer size={24} /></div>
                    <div className={styles.printerInfo}>
                      <h3>SprintRay Pro 95S</h3>
                      <span className={styles.printerStatus}>● Online</span>
                    </div>
                    <div className={styles.printerMeta}>
                      <span>Build Volume: 192 x 120 x 245mm</span>
                      <span>Layer: 50μm</span>
                    </div>
                  </div>
                  <div className={styles.printerCard}>
                    <div className={styles.printerIcon}><Printer size={24} /></div>
                    <div className={styles.printerInfo}>
                      <h3>Formlabs Form 3B+</h3>
                      <span className={styles.printerStatus}>● Online</span>
                    </div>
                    <div className={styles.printerMeta}>
                      <span>Build Volume: 145 x 145 x 185mm</span>
                      <span>Layer: 25μm</span>
                    </div>
                  </div>
                </div>

                <div className={styles.formGrid} style={{marginTop: '1.5rem'}}>
                  <div className={styles.inputGroupFull}>
                    <label>Default Printer</label>
                    <select defaultValue="sprintray">
                      <option value="sprintray">SprintRay Pro 95S</option>
                      <option value="formlabs">Formlabs Form 3B+</option>
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Default Layer Height</label>
                    <select defaultValue="50">
                      <option value="25">25μm (Ultra Detail)</option>
                      <option value="50">50μm (Standard)</option>
                      <option value="100">100μm (Fast Draft)</option>
                    </select>
                  </div>
                  <div className={styles.inputGroup}>
                    <label>Post-Cure Protocol</label>
                    <select defaultValue="standard">
                      <option value="standard">Standard (UV 60s + Heat 30min)</option>
                      <option value="extended">Extended (UV 120s + Heat 60min)</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button className={styles.btnPrimary} onClick={handleSave}><Save size={16} /> {saved ? 'Saved ✓' : 'Save Configuration'}</button>
                </div>
              </div>
            )}

            {/* RESIN INVENTORY TAB */}
            {activeTab === 'materials' && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Resin Inventory</h2>
                <p className={styles.sectionDesc}>Track your current resin stock levels.</p>

                <div className={styles.resinGrid}>
                  {[
                    { name: 'Permanent Crown Resin', brand: 'VarseoSmile Crown Plus', level: 72 },
                    { name: 'Temporary C&B Resin', brand: 'SprintRay Crown', level: 45 },
                    { name: 'Surgical Guide Resin', brand: 'Formlabs Surgical Guide', level: 88 },
                    { name: 'KeySplint Soft', brand: 'Keystone Industries', level: 31 },
                    { name: 'Model Resin', brand: 'SprintRay Die & Model 2', level: 60 },
                    { name: 'Castable Wax Resin', brand: 'Formlabs Castable Wax 40', level: 55 },
                  ].map((resin, i) => (
                    <div key={i} className={styles.resinCard}>
                      <div className={styles.resinHeader}>
                        <Droplets size={16} style={{ color: resin.level < 40 ? '#fca5a5' : 'var(--brand-bioceramic)' }} />
                        <h4>{resin.name}</h4>
                      </div>
                      <span className={styles.resinBrand}>{resin.brand}</span>
                      <div className={styles.resinBarBg}>
                        <div className={styles.resinBarFill}
                          style={{ width: `${resin.level}%`, background: resin.level < 40 ? '#f87171' : 'var(--brand-bioceramic)' }} />
                      </div>
                      <span className={styles.resinLevel}>{resin.level}% remaining</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'notifications' && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>Alerts & Notifications</h2>
                <p className={styles.sectionDesc}>Manage how you receive updates about your workstation assignments.</p>
                <div style={{display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px'}}>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" defaultChecked /> Push notification for new "Unassigned" cases
                  </label>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" defaultChecked /> Alert me when a Doctor replies in chat
                  </label>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" defaultChecked /> Alert me when Doctor approves a digital design
                  </label>
                  <label style={{display: 'flex', alignItems: 'center', gap: '12px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '13px'}}>
                    <input type="checkbox" defaultChecked /> Low Resin Inventory Warnings (below 20%)
                  </label>
                </div>
                <div className={styles.formActions} style={{marginTop: '24px'}}>
                  <button className={styles.btnPrimary} onClick={handleSave}><Save size={16} /> {saved ? 'Saved ✓' : 'Save Preferences'}</button>
                </div>
              </div>
            )}

            {activeTab === 'preferences' && (
              <div className={styles.section}>
                <h2 className={styles.sectionTitle}>App Preferences</h2>
                <div className={styles.formGrid}>
                  <div className={styles.inputGroupFull}>
                    <label>UI Theme</label>
                    <select 
                      value={theme} 
                      onChange={(e) => { setTheme(e.target.value); handleSave(); }}
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
                <h2 className={styles.sectionTitle}>Account Security</h2>
                
                {passMessage.text && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '4px', fontSize: '0.85rem', backgroundColor: passMessage.type === 'error' ? '#fef2f2' : '#f0fdf4', color: passMessage.type === 'error' ? '#ef4444' : '#10b981', border: `1px solid ${passMessage.type === 'error' ? '#fecaca' : '#bbf7d0'}` }}>
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

export default TechSettings;
