// Small DOM helpers. Always build text with esc() or textContent — never
// paste database values into innerHTML unescaped.

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function showView(id) {
  for (const v of document.querySelectorAll('[data-view]')) {
    v.hidden = v.id !== id;
  }
}

export function setMessage(el, text, kind = 'info') {
  el.textContent = text || '';
  el.dataset.kind = kind;
  el.hidden = !text;
}

// Thailand-friendly date, e.g. "16 Nov 2026".
export function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// Today's date in Thailand (device-local), as YYYY-MM-DD. Never use toISOString() for this.
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const titleCase = (s) =>
  String(s ?? '').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
