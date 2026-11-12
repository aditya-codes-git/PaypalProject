import { createContext, useContext, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark';
const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem('reliefops-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* Storage may be unavailable in a private browser. */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#09090b' : '#ffffff');
  }, [theme]);
  return <ThemeContext.Provider value={{ theme, toggle: () => setTheme(value => value === 'dark' ? 'light' : 'dark') }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

export function ThemeToggle({ animate = false }: { animate?: boolean }) {
  const { theme, toggle } = useTheme();
  const transitioning = useRef(false);
  const label = `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`;

  function switchTheme(event: MouseEvent<HTMLButtonElement>) {
    if (transitioning.current) return;
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('reliefops-theme', nextTheme); } catch { /* Theme still works for this session. */ }
    if (!animate || !document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      toggle();
      return;
    }

    const { left, top, width, height } = event.currentTarget.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement;
    transitioning.current = true;
    root.dataset.themeReveal = '';
    root.style.setProperty('--theme-reveal-x', `${x}px`);
    root.style.setProperty('--theme-reveal-y', `${y}px`);
    root.style.setProperty('--theme-reveal-radius', `${Math.ceil(radius)}px`);

    const transition = document.startViewTransition(() => flushSync(toggle));
    function cleanUp() {
      transitioning.current = false;
      delete root.dataset.themeReveal;
      root.style.removeProperty('--theme-reveal-x');
      root.style.removeProperty('--theme-reveal-y');
      root.style.removeProperty('--theme-reveal-radius');
    }
    void transition.ready.catch(() => {});
    void transition.finished.then(cleanUp, cleanUp);
  }

  return <button className="theme-toggle" type="button" onClick={switchTheme} aria-label={label} title={label}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>;
}
