import React from 'react';
import { Outlet, NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { Hexagon, LogOut, LayoutDashboard, Settings as SettingsIcon, Archive as ArchiveIcon, Sun, Moon } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import NotificationDropdown from '../UI/NotificationDropdown';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import styles from './TechLayout.module.css';

const TechLayout = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={styles.layout}>
      {/* ─── Sidebar ─────────────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link to="/tech" className={styles.logo}>
            <div className={styles.logoIcon}>
              <img src="/logo.png" alt="Hesyra" />
            </div>
            <div className={styles.brandText}>
              <span className={styles.brandMain}>Hesyra</span>
              <span className={styles.brandSub}>Lab Workspace</span>
            </div>
          </Link>

          <nav className={styles.nav}>
            <NavLink to="/tech" end className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
              <LayoutDashboard size={18} />
              <span>Case Queue</span>
            </NavLink>
            <NavLink to="/tech/archive" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
              <ArchiveIcon size={18} />
              <span>Case Archive</span>
            </NavLink>
            
            <div className={styles.navSeparator}>Account & Support</div>
            
            <NotificationDropdown isSidebar={true} />
            
            <NavLink to="/tech/settings" className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
              <SettingsIcon size={18} />
              <span>System Settings</span>
            </NavLink>

            <button className={styles.navItem} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          </nav>
        </div>

        <div className={styles.sidebarBottom}>
          <div className={styles.techProfile}>
            <div className={styles.avatarWrapper}>
              <div className={styles.techAvatar}>{user?.initials || 'T'}</div>
              <div className={styles.onlineIndicator}></div>
            </div>
            <div className={styles.techMeta}>
              <div className={styles.techName}>{user?.name || 'Technician'}</div>
              <div className={styles.techRole}>Lab Master</div>
            </div>
          </div>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Sign Out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* ─── Main Content ────────────────────────────────────── */}
      <main className={styles.main}>
        <div className={styles.contentWrapper}>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              style={{ width: '100%', height: '100%' }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
};

export default TechLayout;
