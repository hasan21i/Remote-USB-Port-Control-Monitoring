// src/hooks/useTheme.js

import React, {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  useEffect,
  useCallback
} from 'react';
import PropTypes from 'prop-types';

const STORAGE_KEY    = 'appTheme';
const DEFAULT_THEME  = 'light';

/**
 * @typedef {'light'|'dark'} ThemeMode
 *
 * @typedef {Object} ThemeContextValue
 * @property {ThemeMode}       theme        – السمة الحالية
 * @property {boolean}         isDark       – هل السمة داكنة؟
 * @property {() => void}      toggleTheme  – تبديل بين السمات
 * @property {(mode: ThemeMode) => void} setThemeMode – ضبط السمة صراحة
 */

/** سياق للسمة */
const ThemeContext = createContext(/** @type {ThemeContextValue|null} */ (null));

/**
 * ThemeProvider
 *  • يحمّل السمة من localStorage أو من تفضيل النظام
 *  • يطبق السمة على `<html data-theme="...">`
 *  • يتابع تغيّر تفضيل النظام ويتفاعل معه
 */
export const ThemeProvider = ({ children }) => {
  // نحدد القيمة الابتدائية سريّاً (SSR-safe)
  const getInitial = () => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : DEFAULT_THEME;
  };

  const [theme, setTheme] = useState(getInitial);

  // عند تغيير theme: نطبّق على <html> ونخزّنه
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // نتابع تغير تفضيل النظام
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = e => setTheme(e.matches ? 'dark' : 'light');

    mql.addEventListener
      ? mql.addEventListener('change', onChange)
      : mql.addListener(onChange);

    return () => {
      mql.removeEventListener
        ? mql.removeEventListener('change', onChange)
        : mql.removeListener(onChange);
    };
  }, []);

  /** يبدّل بين 'light' و'dark' */
  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  /**
   * يضبط السمة صراحة
   * @param {ThemeMode} mode
   */
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
 * Hook للوصول إلى سياق السمة
 * @returns {ThemeContextValue}
 */
export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
};

export default useTheme;
