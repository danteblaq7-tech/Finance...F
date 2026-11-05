import { useSyncExternalStore } from 'react';

// Light ("Daylight") / dark ("Midnight") mode.
//   • First visit: follow the operating system's setting.
//   • After the user picks one with the toggle, that choice is remembered (localStorage) and wins.
// index.html applies the same logic in a tiny inline script BEFORE the page paints, so there is no flash.

const KEY = 'finesse_theme';
const root = () => document.documentElement;

export const isDarkNow = () => root().classList.contains('dark');

function syncThemeColor() {
  // Colours the browser's address bar / mobile status bar.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDarkNow() ? '#0A0D14' : '#F3F6FA');
}

function stored(): 'dark' | 'light' | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

/** Call once at start-up. Applies the saved/system theme and keeps following the system until the user chooses. */
export function initTheme(): void {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  const apply = () => {
    const saved = stored();
    root().classList.toggle('dark', saved ? saved === 'dark' : (media?.matches ?? true));
    syncThemeColor();
  };
  apply();
  media?.addEventListener('change', () => {
    if (!stored()) apply();
  });
}

/** The user's explicit choice (the toggle button). */
export function setTheme(dark: boolean): void {
  root().classList.toggle('dark', dark);
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    /* storage blocked: the choice still applies for this visit */
  }
  syncThemeColor();
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(root(), { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

/** Re-renders when the theme changes (so e.g. the code editor can switch with the page). */
export const useIsDark = () => useSyncExternalStore(subscribe, isDarkNow, () => true);
