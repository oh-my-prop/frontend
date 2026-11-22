// Light/dark theme switch shared by every page.
//
//   import { mountThemeToggle } from '/src/ui/theme.js';
//   mountThemeToggle(containerElement);
//
// The choice is saved in localStorage; with no saved choice the OS preference
// applies (see tokens.css). A change dispatches `omp:themechange` on window so
// canvas drawings (the price chart) can repaint with the new colors.

export const THEME_KEY = 'oh-my-prop.theme';
const SVG_NS = 'http://www.w3.org/2000/svg';

export function currentTheme(root = document.documentElement, media = globalThis.matchMedia) {
  const explicit = root.getAttribute('data-theme');
  if (explicit === 'light' || explicit === 'dark') return explicit;
  return media?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(theme, root = document.documentElement) {
  root.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Not persisted; still applied for this page.
  }
  globalThis.dispatchEvent?.(new CustomEvent('omp:themechange', { detail: { theme } }));
}

function icon(className, paths) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', className);
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export function mountThemeToggle(container) {
  if (!container) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme-toggle';
  const label = () => {
    const next = currentTheme() === 'dark' ? '밝은 화면으로' : '어두운 화면으로';
    button.setAttribute('aria-label', next);
    button.title = next;
  };
  button.append(
    icon('icon-moon', ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z']),
    icon('icon-sun', ['M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M5.6 5.6l1.4 1.4', 'M17 17l1.4 1.4', 'M5.6 18.4 7 17', 'M17 7l1.4-1.4', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z']),
  );
  button.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    label();
  });
  globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    label();
    globalThis.dispatchEvent(new CustomEvent('omp:themechange', { detail: { theme: currentTheme() } }));
  });
  label();
  container.append(button);
  return button;
}
