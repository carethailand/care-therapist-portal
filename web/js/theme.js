// Light / dark mode. "auto" follows the phone or computer's own setting.
// The choice is remembered on this device only (browser storage).
const KEY = 'care_portal_theme';
const ORDER = ['auto', 'light', 'dark'];
const LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
const ICON = { auto: 'sun-moon', light: 'sun', dark: 'moon' };
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getChoice() {
  try { const v = localStorage.getItem(KEY); return ORDER.includes(v) ? v : 'auto'; } catch { return 'auto'; }
}

export function apply(choice = getChoice()) {
  const dark = choice === 'dark' || (choice === 'auto' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = dark ? '#1C1815' : '#FAF7F2';
}

export function setChoice(choice) {
  try { localStorage.setItem(KEY, choice); } catch { /* private mode: still applies for now */ }
  apply(choice);
}

export const next = (choice) => ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];
export const label = (choice) => LABEL[choice];
export const iconName = (choice) => ICON[choice];

// Follow the system when it changes (only matters in Auto).
media.addEventListener?.('change', () => { if (getChoice() === 'auto') apply('auto'); });
