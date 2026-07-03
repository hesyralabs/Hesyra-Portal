import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    // Check localStorage
    const savedTheme = localStorage.getItem('hesyra-theme');
    if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'brand') {
      return savedTheme;
    }
    
    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    
    return 'brand'; // Default to Hesyra brand theme
  });

  useEffect(() => {
    // Update document class
    document.documentElement.classList.remove('light-mode', 'dark-mode', 'brand-mode');
    document.documentElement.classList.add(`${theme}-mode`);
    
    // Persist
    localStorage.setItem('hesyra-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
