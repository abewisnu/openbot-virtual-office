/**
 * Theme mode: `system` follows the OS, `light` and `dark` pin one palette.
 *
 * The palette itself lives in `src/styles/index.css` as custom properties on
 * `:root` (dark) and `:root[data-theme='light']` (light). This module only
 * decides which one is active by writing `data-theme` (resolved palette) and
 * `data-theme-mode` (the user's choice) on `<html>`.
 */
export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export type ResolvedTheme = 'light' | 'dark';

/** Coarse pointer, but exact enough to know what the OS currently prefers. */
const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function prefersLight(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(LIGHT_QUERY).matches;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'light') return 'light';
  if (mode === 'dark') return 'dark';
  return prefersLight() ? 'light' : 'dark';
}

/** Write the resolved palette on `<html>` and return it, so callers can assert. */
export function applyTheme(mode: ThemeMode): ResolvedTheme {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.dataset.themeMode = mode;
  return resolved;
}

/**
 * Watch the OS palette while the mode is `system`. Returns an unsubscribe
 * function; calling it when `matchMedia` is unavailable is a no-op.
 */
export function watchSystemTheme(onChange: (resolved: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
  const mq = window.matchMedia(LIGHT_QUERY);
  const listener = () => onChange(mq.matches ? 'light' : 'dark');
  mq.addEventListener('change', listener);
  return () => mq.removeEventListener('change', listener);
}
