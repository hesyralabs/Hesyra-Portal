import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate, Link, useLocation } from 'react-router-dom';
import {
  LogOut, LayoutDashboard, Users, Ticket, BarChart3,
  Sun, Moon, Settings as SettingsIcon, AlertTriangle, ClipboardList, Package
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import styles from './ManagerLayout.module.css';

const ManagerLayout = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => { logout(); navigate('/login'); };

  const navItems = [
    { to: '/manager',          label: 'Operations Overview', icon: LayoutDashboard, end: true },
    { to: '/manager/cases',    label: 'Case Management',     icon: ClipboardList },
    { to: '/manager/workload', label: 'Team Workload',       icon: BarChart3 },
    { to: '/manager/clinics',  label: 'Clinic Accounts',     icon: Users },
    { to: '/manager/catalog',  label: 'Material Catalog',    icon: Package },
    { to: '/manager/tickets',  label: 'Support Tickets',     icon: Ticket },
  ];

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link to="/manager" className={styles.logo}>
            <div className={styles.logoIcon}>
              <img src="/logo.png" alt="Hesyra" />
            </div>
            <div className={styles.brandText}>
              <span className={styles.brandMain}>Hesyra</span>
              <span className={styles.brandSub}>Operations</span>
            </div>
          </Link>

          <nav className={styles.nav}>
            {navItems.map(item => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}

            <div className={styles.navSeparator}>Preferences</div>

            <button className={styles.navItem} onClick={toggleTheme}>
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          </nav>
        </div>

        <div className={styles.sidebarBottom}>
          <div className={styles.profile}>
            <div className={styles.avatarWrapper}>
              <div className={styles.avatar}>{user?.name?.substring(0, 2).toUpperCase() || 'MG'}</div>
              <div className={styles.onlineIndicator}></div>
            </div>
            <div className={styles.profileMeta}>
              <div className={styles.profileName}>{user?.name || 'Manager'}</div>
              <div className={styles.profileRole}>Operations Lead</div>
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

export default ManagerLayout;
