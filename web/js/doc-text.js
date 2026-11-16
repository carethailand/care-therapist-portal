// Shows a training document (plain text with a few simple marks) as HTML.
//   ## Heading      ### Smaller heading      • bullet point      other lines = paragraphs
// Every line is escaped first, so document text can never inject HTML.
import { esc } from './ui.js';

export function docHtml(text) {
  const out = [];
  let list = false;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    if (line.startsWith('### ')) { closeList(); out.push(`<h4>${esc(line.slice(4))}</h4>`); }
    else if (line.startsWith('## ')) { closeList(); out.push(`<h3>${esc(line.slice(3))}</h3>`); }
    else if (line.startsWith('• ') || line.startsWith('- ')) {
      if (!list) { out.push('<ul>'); list = true; }
      out.push(`<li>${esc(line.slice(2))}</li>`);
    } else { closeList(); out.push(`<p>${esc(line)}</p>`); }
  }
  closeList();
  return out.join('');
}
