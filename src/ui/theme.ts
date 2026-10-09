// Light / dark / auto theme. The choice is a per-browser convenience kept in localStorage
// (under the 'jr-' prefix, so "Clear all data" resets it to Auto).
import { h } from './dom';

export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'jr-theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

function apply(t: ThemeChoice): void {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

let current: ThemeChoice = 'auto';

export function initTheme(): void {
  current = read();
  apply(current);
}

export function themeToggle(): HTMLElement {
  const opts: { id: ThemeChoice; label: string; title: string }[] = [
    { id: 'auto', label: 'Auto', title: 'Follow the system setting' },
    { id: 'light', label: 'Light', title: 'Light theme' },
    { id: 'dark', label: 'Dark', title: 'Dark theme' },
  ];
  const wrap = h('div', { class: 'theme-toggle', role: 'group', 'aria-label': 'Theme', testid: 'theme-toggle' });
  const paint = () => {
    for (const b of wrap.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.theme === current));
  };
  for (const o of opts) {
    const b = h('button', { type: 'button', title: o.title, 'data-theme': o.id }, o.label);
    b.addEventListener('click', () => {
      try {
        if (o.id === 'auto') localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, o.id);
      } catch {
        /* storage blocked: still apply for this page view */
      }
      current = o.id;
      apply(current);
      paint();
    });
    wrap.append(b);
  }
  paint();
  return wrap;
}
