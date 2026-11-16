// Placeholder for tabs whose module has not been built yet.
import { esc } from '../ui.js';

export async function render(panel, { module }) {
  panel.innerHTML = `
    <section class="card muted-card">
      <h2>${esc(module.label)}</h2>
      <p>${esc(module.description || '')}</p>
      <p class="muted">Coming in Phase ${esc(module.phase ?? '—')}.</p>
    </section>`;
}
