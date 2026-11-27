// src/context/ThemeContext.jsx

import React, {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useEffect,
  useCallback
} from 'react';
import PropTypes from 'prop-types';

const STORAGE_KEY = 'appTheme';
const DEFAULT_THEME = 'light';

/**
 * Context لإدارة سمة التطبيق (light / dark)
 */
const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  isDark: false,
  toggleTheme: () => {},
  setThemeMode: (_mode) => {}
});

/**
 * ThemeProvider
 * - يحمّل السمة من localStorage أو من تفضيل النظام
 * - يطبّقها على <html data-theme="...">
 * - يستمع لتغير تفضيل النظام إذا لم يختَر المستخدم سمة يدوياً
 */
export const ThemeProvider = ({ children }) => {
  // تحديد السمة الابتدائية (SSR-safe)
  const getInitialTheme = () => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    return mql.matches ? 'dark' : DEFAULT_THEME;
  };

  const [theme, setTheme] = useState(getInitialTheme);

  // تطبيق السمة على <html> وتخزينها
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // الاستماع لتغير تفضيل النظام (إذا لم يُحدد المستخدم سمة يدوياً)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = e => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    if (mql.addEventListener) {
      mql.addEventListener('change', handleChange);
      return () => mql.removeEventListener('change', handleChange);
    } else {
      mql.addListener(handleChange);
      return () => mql.removeListener(handleChange);
    }
  }, []);

  // تبديل بين light و dark
  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  // ضبط السمة صراحة
  const setThemeMode = useCallback(mode => {
    if (mode === 'light' || mode === 'dark') {
      setTheme(mode);
    }
  }, []);

  const value = {
    theme,
    isDark: theme === 'dark',
    toggleTheme,
    setThemeMode
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

ThemeProvider.propTypes = {
  children: PropTypes.node.isRequired
};

/**
 * هوك لاستهلاك ThemeContext
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

export default ThemeContext;
