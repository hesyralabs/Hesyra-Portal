import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, FileText, Settings, Archive, CreditCard, LayoutDashboard, X, Command } from 'lucide-react';
import { useCases } from '../../context/CaseContext';
import { useAuth } from '../../context/AuthContext';
import styles from './CommandPalette.module.css';

const CommandPalette = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  const navigate = useNavigate();
  const { cases } = useCases();
  const { user } = useAuth();

  // ─── Command List ──────────────────────────────────────────
  const getCommands = useCallback(() => {
    const isTech = user?.role === 'tech';
    const isAdmin = user?.role === 'admin';
    
    const baseCommands = [
      { id: 'dash', title: 'Dashboard', icon: <LayoutDashboard size={18} />, path: isTech ? '/tech' : '/' },
      { id: 'archive', title: 'Archive', icon: <Archive size={18} />, path: isTech ? '/tech/archive' : '/archive' },
      { id: 'settings', title: 'Settings', icon: <Settings size={18} />, path: isTech ? '/tech/settings' : '/settings' },
    ];

    if (!isTech) {
      baseCommands.push({ id: 'billing', title: 'Billing', icon: <CreditCard size={18} />, path: '/billing' });
    }
    
    if (isAdmin) {
      baseCommands.push({ id: 'admin', title: 'Super Admin', icon: <Settings size={18} />, path: '/admin' });
    }

    // Filtered Cases
    const filteredCases = cases
      .filter(c => 
        c.id.toLowerCase().includes(query.toLowerCase()) || 
        c.patient.toLowerCase().includes(query.toLowerCase())
      )
      .slice(0, 5)
      .map(c => ({
        id: `case-${c.id}`,
        title: `Case ${c.id}: ${c.patient}`,
        icon: <FileText size={18} />,
        path: isTech ? `/tech/case/${c.id}` : `/case/${c.id}`,
        subtitle: c.status
      }));

    // Filtered Pages
    const filteredPages = baseCommands.filter(cmd => 
      cmd.title.toLowerCase().includes(query.toLowerCase())
    );

    return [...filteredPages, ...filteredCases];
  }, [query, cases, user]);

  const commands = getCommands();

  // ─── Handlers ─────────────────────────────────────────────
  const toggle = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setIsOpen(prev => !prev);
      setQuery('');
      setSelectedIndex(0);
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  const handleSelect = (cmd) => {
    navigate(cmd.path);
    setIsOpen(false);
  };

  const handleKeyDown = (e) => {
    if (commands.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % commands.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + commands.length) % commands.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (commands[selectedIndex]) {
        handleSelect(commands[selectedIndex]);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [toggle]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={() => setIsOpen(false)}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <Search className={styles.searchIcon} size={20} />
          <input
            autoFocus
            className={styles.input}
            placeholder="Type a command or search cases..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
          />
          <div className={styles.kbd}>ESC</div>
        </div>

        <div className={styles.results}>
          {commands.length > 0 ? (
            commands.map((cmd, idx) => (
              <div
                key={cmd.id}
                className={`${styles.item} ${idx === selectedIndex ? styles.selected : ''}`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => handleSelect(cmd)}
              >
                <div className={styles.itemIcon}>{cmd.icon}</div>
                <div className={styles.itemContent}>
                  <div className={styles.itemTitle}>{cmd.title}</div>
                  {cmd.subtitle && <div className={styles.itemSubtitle}>{cmd.subtitle}</div>}
                </div>
                {idx === selectedIndex && <div className={styles.enterKey}><Command size={12} /> ENTER</div>}
              </div>
            ))
          ) : (
            <div className={styles.empty}>No results for "{query}"</div>
          )}
        </div>

        <div className={styles.footer}>
          <span>↑/↓ to navigate</span>
          <span>↵ to select</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
