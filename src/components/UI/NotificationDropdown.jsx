import React, { useState, useRef, useEffect } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import styles from './NotificationDropdown.module.css';

const NotificationDropdown = ({ isSidebar = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const { notifications, unreadCount, markAllRead } = useNotifications();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleToggle = () => {
    setIsOpen(!isOpen);
    if (!isOpen && unreadCount > 0) {
      markAllRead();
    }
  };

  return (
    <div className={styles.container} ref={dropdownRef}>
      <button 
        className={`${styles.triggerBtn} ${isSidebar ? styles.sidebarTrigger : ''}`} 
        onClick={handleToggle}
        aria-label="Notifications"
      >
        <Bell size={16} />
        {isSidebar && <span>Notifications</span>}
        {unreadCount > 0 && <span className={styles.badge}>{unreadCount}</span>}
      </button>

      {isOpen && (
        <div className={`${styles.dropdown} ${isSidebar ? styles.dropdownSidebar : ''}`}>
          <div className={styles.header}>
            <h4>Notifications</h4>
            {unreadCount > 0 && (
              <button className={styles.markReadBtn} onClick={markAllRead}>
                <CheckCircle2 size={14} /> Mark all read
              </button>
            )}
          </div>
          
          <div className={styles.list}>
            {notifications.length === 0 ? (
              <div className={styles.empty}>No notifications right now.</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`${styles.item} ${!n.read ? styles.unread : ''}`}>
                  <div className={styles.itemDot} />
                  <div className={styles.itemContent}>
                    <p>{n.text}</p>
                    <span className={styles.time}>{n.time}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default NotificationDropdown;
