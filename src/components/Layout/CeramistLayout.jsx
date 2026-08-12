import React from 'react';
import { Outlet, NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import { LogOut, Paintbrush, CheckCircle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import NotificationDropdown from '../UI/NotificationDropdown';
import { useAuth } from '../../context/AuthContext';
import styles from './TechLayout.module.css';

// ═══════════════════════════════════════════════════════════════
// Ceramists were being served TechLayout, whose sidebar is hardcoded
// to /tech, /tech/archive and /tech/settings. Those routes require the
// `technician` role, so ProtectedRoute bounced a ceramist straight back
// to /ceramist — every link in the sidebar looked broken, and no item
// ever highlighted as active because none of them matched the URL.
//
// This nav only contains destinations a ceramist can actually reach.
// ═══════════════════════════════════════════════════════════════
const CeramistLayout = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const initials = (user?.name || 'C')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link to="/ceramist" className={styles.logo}>
            <div className={styles.logoIcon}>
              <img src="/logo.png" alt="Hesyra" />
            </div>
            <div className={styles.brandText}>
              <span className={styles.brandMain}>Hesyra</span>
              <span className={styles.brandSub}>Finishing Studio</span>
            </div>
          </Link>

          <nav className={styles.nav}>
            <NavLink to="/ceramist" end
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
              <Paintbrush size={18} />
              <span>Finishing Queue</span>
            </NavLink>
            <NavLink to="/ceramist/completed"
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}>
              <CheckCircle size={18} />
              <span>Completed</span>
            </NavLink>

            <div className={styles.navSeparator}>Account</div>

            <NotificationDropdown isSidebar={true} />
          </nav>
        </div>

        <div className={styles.sidebarBottom}>
          <div className={styles.techProfile}>
            <div className={styles.avatarWrapper}>
              <div className={styles.techAvatar}>{initials}</div>
              <div className={styles.onlineIndicator}></div>
            </div>
            <div className={styles.techMeta}>
              <div className={styles.techName}>{user?.name || 'Ceramist'}</div>
              <div className={styles.techRole}>Ceramist</div>
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

export default CeramistLayout;
