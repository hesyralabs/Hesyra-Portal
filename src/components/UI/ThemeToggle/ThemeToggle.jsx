import React from 'react';
import { Sun, Moon, Palette } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import styles from './ThemeToggle.module.css';

const ThemeToggle = ({ className = '' }) => {
  const { theme, setTheme } = useTheme();

  const handleToggle = () => {
    if (theme === 'brand') setTheme('dark');
    else if (theme === 'dark') setTheme('light');
    else setTheme('brand');
  };

  const getTooltipContent = () => {
    if (theme === 'brand') return 'Switch to Dark Mode';
    if (theme === 'dark') return 'Switch to Light Mode';
    return 'Switch to Brand Mode';
  };

  return (
    <button 
      className={`${styles.toggle} ${className}`} 
      onClick={handleToggle}
      title={getTooltipContent()}
      aria-label="Toggle Theme"
    >
      <div className={`${styles.iconWrapper} ${styles[theme]}`}>
        {theme === 'brand' && <Palette className={styles.icon} size={18} />}
        {theme === 'dark' && <Moon className={styles.icon} size={18} />}
        {theme === 'light' && <Sun className={styles.icon} size={18} />}
      </div>
    </button>
  );
};

export default ThemeToggle;
