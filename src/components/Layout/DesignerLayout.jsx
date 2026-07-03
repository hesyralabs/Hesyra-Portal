import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { LogOut, LayoutDashboard, Layers, Sun, Moon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import styles from './DesignerLayout.module.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const DesignerLayout = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [poolCount, setPoolCount] = useState(0);

  const handleLogout = () => { logout(); navigate('/login'); };

  // Poll pool count every 30 seconds so badge stays fresh
  useEffect(() => {
    const token = sessionStorage.getItem('hesyra_token');
    const fetchPoolCount = async () => {
      try {
        const res = await fetch(`${API}/api/pool/cases`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        setPoolCount(Array.isArray(data) ? data.length : 0);
      } catch { /* silent */ }
    };
    fetchPoolCount();
    const id = setInterval(fetchPoolCount, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link to="/designer" className={styles.logo}>
            <div className={styles.logoIcon}>
              <img src="/logo.png" alt="Hesyra" />
            </div>
            <div className={styles.brandText}>
              <span className={styles.brandMain}>Hesyra</span>
              <span className={styles.brandSub}>CAD Studio</span>
            </div>
          </Link>

          <nav className={styles.nav}>
            <NavLink to="/designer" end className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
              <LayoutDashboard size={18} />
              <span>Design Queue</span>
            </NavLink>

            <NavLink to="/designer/pool" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
              <Layers size={18} />
              <span>Open Pool</span>
              {poolCount > 0 && (
                <span style={{
                  marginLeft: 'auto',
                  background: 'rgba(167,139,250,0.2)',
                  color: '#a78bfa',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  padding: '0.1rem 0.45rem',
                  borderRadius: '10px',
                  border: '1px solid rgba(167,139,250,0.3)',
                }}>{poolCount}</span>
              )}
            </NavLink>

            <div className={styles.navSeparator}>Display</div>

            <button className={styles.navItem} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          </nav>
        </div>

        <div className={styles.sidebarBottom}>
          <div className={styles.profile}>
            <div className={styles.avatarWrapper}>
              <div className={styles.avatar}>{user?.name?.substring(0, 2).toUpperCase() || 'CD'}</div>
              <div className={styles.onlineIndicator}></div>
            </div>
            <div className={styles.profileMeta}>
              <div className={styles.profileName}>{user?.name || 'Designer'}</div>
              <div className={styles.profileRole}>CAD Designer</div>
            </div>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Sign Out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.contentWrapper}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              style={{ width: '100%', minHeight: '100%' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

export default DesignerLayout;
