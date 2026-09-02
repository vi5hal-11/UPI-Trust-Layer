import { useCallback, useEffect, useState } from 'react';

const KEY = 'uatl-theme';

/**
 * The initial class is set by an inline script in index.html before first
 * paint, so this hook only has to read what is already on <html> and keep it
 * in sync from there. No theme flash.
 */
export function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem(KEY, dark ? 'dark' : 'light');
    } catch {
      // A browser with storage blocked still gets a working toggle for this
      // session; it just will not be remembered.
    }
  }, [dark]);

  const toggle = useCallback(() => setDark((d) => !d), []);

  return { dark, toggle };
}
