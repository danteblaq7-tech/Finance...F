import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getItem, KEYS, setItem } from '@/lib/storage';
import { DARK, LIGHT, type Palette } from './theme';

interface ThemeState {
  colors: Palette;
  isDark: boolean;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
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
