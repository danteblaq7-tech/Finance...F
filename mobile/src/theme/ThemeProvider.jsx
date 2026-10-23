import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getItem, KEYS, setItem } from '@/lib/storage';
import { DARK, LIGHT } from './theme';

const ThemeContext = createContext(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true); // dark is the Finesse default, same as the web app

  useEffect(() => {
    void getItem(KEYS.theme).then((v) => {
      if (v === 'light') setIsDark(false);
    });
  }, []);

  const toggle = useCallback(() => {
    setIsDark((d) => {
      void setItem(KEYS.theme, d ? 'light' : 'dark');
      return !d;
    });
  }, []);

  const value = useMemo(() => ({ colors: isDark ? DARK : LIGHT, isDark, toggle }), [isDark, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
