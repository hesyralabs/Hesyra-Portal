import React, { useState } from 'react';
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { Search, Bell, Hexagon, Settings as SettingsIcon, MonitorPlay, LogOut, Archive as ArchiveIcon, CreditCard as BillingIcon, HelpCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import NotificationDropdown from '../UI/NotificationDropdown';
import ThemeToggle from '../UI/ThemeToggle/ThemeToggle';
import { useAuth } from '../../context/AuthContext';
import { useCases } from '../../context/CaseContext';
import { useOnboarding } from '../../context/OnboardingContext';
import styles from './DashboardLayout.module.css';

const DashboardLayout = () => {
  const { user, logout } = useAuth();
  const { cases } = useCases();
  const { openDrawer } = useOnboarding();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showSearch, setShowSearch] = useState(false);

  const handleSearch = (term) => {
    setSearchTerm(term);
    if (term.trim().length < 2) {
      setSearchResults([]);
      setShowSearch(false);
      return;
    }
    const q = term.toLowerCase();
    const results = cases.filter(c =>
      c.id.toLowerCase().includes(q) ||
      c.patient.toLowerCase().includes(q) ||
      c.type.toLowerCase().includes(q) ||
      c.status.toLowerCase().includes(q)
    ).slice(0, 5);
    setSearchResults(results);
    setShowSearch(true);
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <Link to="/" className={styles.logo}>
          <img src="/logo.png" alt="Hesyra Logo" style={{ height: '28px', marginRight: '4px' }} />
          Hesyra Dental Lab
        </Link>

        <div className={styles.searchWrapper}>
          <div className={styles.searchBar}>
            <Search className={styles.icon} size={16} />
            <input
              type="text"
              placeholder="Search cases, patients..."
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
              onFocus={() => searchTerm.length >= 2 && setShowSearch(true)}
              onBlur={() => setTimeout(() => setShowSearch(false), 200)}
            />
          </div>
          {showSearch && searchResults.length > 0 && (
            <div className={styles.searchDropdown}>
              {searchResults.map(c => (
                <Link key={c.id} to={`/case/${c.id}`} className={styles.searchItem}
                  onClick={() => { setShowSearch(false); setSearchTerm(''); }}>
                  <span className={styles.searchId}>{c.id}</span>
                  <span className={styles.searchPatient}>{c.patient}</span>
                  <span className={styles.searchStatus}>{c.status}</span>
                </Link>
              ))}
            </div>
          )}
          {showSearch && searchResults.length === 0 && searchTerm.length >= 2 && (
            <div className={styles.searchDropdown}>
              <div className={styles.searchEmpty}>No cases found for "{searchTerm}"</div>
            </div>
          )}
        </div>

        <div className={styles.userNav}>
          <Link to="/admin" className={styles.btnCircular} title="Lab Admin View">
            <MonitorPlay size={16} />
          </Link>
          <Link to="/archive" className={styles.btnCircular} title="Case Archive">
            <ArchiveIcon size={16} />
          </Link>
          <Link to="/billing" className={styles.btnCircular} title="Billing & Invoices">
            <BillingIcon size={16} />
          </Link>
          <Link to="/settings" className={styles.btnCircular} title="Settings">
            <SettingsIcon size={16} />
          </Link>
          <button className={styles.btnCircular} onClick={() => openDrawer('nav')} title="Help & Tour">
            <HelpCircle size={16} />
          </button>
          <ThemeToggle className={styles.btnCircular} />
          <NotificationDropdown />
          <button className={styles.btnCircular} onClick={handleLogout} title="Sign Out">
            <LogOut size={16} />
          </button>
          <div className={styles.avatar}>
            {user?.initials || 'U'}
          </div>
        </div>
      </header>

      <main className={styles.mainContent}>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
};

export default DashboardLayout;
