// Learning Hub "grow your tree" (and the admin team's flower field): skills, stages, scenes and the skill wheel.
// Every scene is the same size (1000×680): the background is softened so the
// tree stands out, the tree always stands in the middle, and at Forest Guardian
// one animal can join it. Points are worked out in the database, never here.
import { BGS, LOOKS, ANIMALS, FLOWERS, GRASS, BUSHES } from './tree-art.js';
import { esc } from './ui.js';

export { BGS, LOOKS, ANIMALS, FLOWERS };

// Areas, with colours from the Portal's own palette (badge colours + sage / clay).
export const SKILLS = [
  { key: 'measurement', label: 'Measurement', short: 'Measure', color: '#3B8FC4' },
  { key: 'skill_acq', label: 'Skill Acquisition', short: 'Skills', color: '#6F8A69' },
  { key: 'behavior_red', label: 'Behavior Reduction', short: 'Behavior', color: '#B95E44' },
  { key: 'ethics', label: 'Ethics', short: 'Ethics', color: '#80614C' },
  { key: 'modern_aba', label: 'Modern ABA', short: 'Modern', color: '#C8901A' },
  { key: 'school_shadow', label: 'School Shadow', short: 'School', color: '#CF4F84' },
  { key: 'safe_behavior', label: 'Safe Behavior Management', short: 'Safety', color: '#4F8C86' },
];
// The admin team's hub has its own 7 skills (and a flower field instead of a tree).
export const ADMIN_SKILLS = [
  { key: 'adm_schedule', label: 'Scheduling & Coordination', short: 'Schedule', color: '#3B8FC4' },
  { key: 'adm_family', label: 'Family Communication', short: 'Families', color: '#CF4F84' },
  { key: 'adm_records', label: 'Records & Privacy', short: 'Records', color: '#4F8C86' },
  { key: 'adm_finance', label: 'Finance & Billing', short: 'Finance', color: '#C8901A' },
  { key: 'adm_team', label: 'Team & HR Support', short: 'Team', color: '#6F8A69' },
  { key: 'adm_tools', label: 'Tools & Systems', short: 'Tools', color: '#80614C' },
  { key: 'adm_profession', label: 'Professionalism & Ethics', short: 'Ethics', color: '#B95E44' },
];
export const skillsFor = (hub) => (hub === 'admin' ? ADMIN_SKILLS : SKILLS);
export const skillLabel = (k) => [...SKILLS, ...ADMIN_SKILLS].find((s) => s.key === k)?.label || k;

export const STAGES = [
  { name: 'Seedling', at: 10, h: 110 },
  { name: 'Sprout', at: 20, h: 165 },
  { name: 'Sapling', at: 30, h: 245 },
  { name: 'Tree', at: 40, h: 335 },
  { name: 'Grove', at: 60, h: 420 },
  { name: 'Forest Guardian', at: 100, h: 500 },
];
export const GUARDIAN = STAGES.length - 1;
// Flower field: same points as the tree; more flowers, and more kinds to mix, as it grows.
export const FIELD_STAGES = [
  { name: 'Bud', at: 10, n: 2, kinds: 2 },
  { name: 'Bloom', at: 20, n: 5, kinds: 3 },
  { name: 'Flower patch', at: 30, n: 10, kinds: 4 },
  { name: 'Garden', at: 40, n: 15, kinds: 5 },
  { name: 'Meadow', at: 60, n: 20, kinds: 6 },
  { name: 'Flower Field Keeper', at: 100, n: 28, kinds: 6 },
];
export const stagesFor = (hub) => (hub === 'admin' ? FIELD_STAGES : STAGES);
export const kindsAt = (points) => FIELD_STAGES[stageOf(points)].kinds;
export const LEAVES_PER_POINT = 10;

export function stageOf(points) {
  let s = 0;
  STAGES.forEach((x, i) => { if (points >= x.at) s = i; });
  return s;
}
// { stage, next (points needed for the next stage or null), pct within this stage }
export function progress(points) {
  const s = stageOf(points);
  const next = STAGES[s + 1];
  if (!next) return { stage: s, next: null, pct: 100 };
  const from = STAGES[s].at;
  return { stage: s, next: next.at, pct: Math.max(0, Math.min(100, Math.round(((points - from) / (next.at - from)) * 100))) };
}

const W = 1000, H = 680, BASE = 630, MID = 500, SKY = '#eaf3f1';
const ART = 'assets/tree/';
let uid = 0;

// The scene as an <svg>. tree = { points, bg, looks:[6], animal }, stage optional (defaults from points).
export function sceneSvg(tree, { stage = null, label = '' } = {}) {
  if (tree.hub === 'admin') return fieldSvg(tree, { stage, label });
  const s = stage ?? stageOf(tree.points ?? 10);
  const b = BGS[tree.bg ?? 0] || BGS[0];
  const look = LOOKS[s][(tree.looks || [])[s] ?? 0] || LOOKS[s][0];
  const k = 1060 / b.w;
  const th = STAGES[s].h, tw = (th * look.w) / look.h;
  const id = `tr${uid++}`;
  const gold = s === GUARDIAN;
  let g = `<svg class="tree-scene" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || `${STAGES[s].name} tree`)}" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="${id}"><stop offset="0" stop-color="${gold ? '#fff3c4' : '#ffffff'}" stop-opacity="${gold ? 0.95 : 0.85}"/><stop offset=".55" stop-color="${gold ? '#fff3c4' : '#ffffff'}" stop-opacity=".45"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <clipPath id="c${id}"><rect width="${W}" height="${H}"/></clipPath></defs>
    <g clip-path="url(#c${id})"><rect width="${W}" height="${H}" fill="${SKY}"/>
    <image href="${ART}${b.file}" x="${MID - b.cx * k}" y="${BASE - b.gy * k}" width="${b.w * k}" height="${b.h * k}"/>
    <rect width="${W}" height="${H}" fill="${SKY}" opacity=".45"/>`;
  const r = Math.max(th * 0.62, tw * 0.62);
  g += `<ellipse cx="${MID}" cy="${BASE - th * 0.5}" rx="${r * 1.05}" ry="${r}" fill="url(#${id})"/>`;
  g += `<ellipse cx="${MID}" cy="${BASE + 4}" rx="${Math.max(tw * 0.32, 40)}" ry="10" fill="#2f4a2a" opacity=".18"/>`;
  g += `<image href="${ART}${look.file}" x="${MID - tw / 2}" y="${BASE - th}" width="${tw}" height="${th}"/>`;
  if (s === GUARDIAN && tree.animal != null && ANIMALS[tree.animal]) {
    const a = ANIMALS[tree.animal], ah = 125, aw = (ah * a.w) / a.h;
    const ax = Math.min(MID + tw * 0.34, W - 60 - aw);
    g += `<ellipse cx="${ax + aw / 2}" cy="${BASE + 6}" rx="${aw * 0.4}" ry="7" fill="#2f4a2a" opacity=".18"/>`;
    g += `<image href="${ART}${a.file}" x="${ax}" y="${BASE + 6 - ah}" width="${aw}" height="${ah}"/>`;
  }
  return `${g}</g></svg>`;
}

// Where flowers stand: [x, ground y, size, tilt°, row] with row 0 = far, 1 = middle, 2 = front.
// Listed in the order they appear as the field grows (2, 5, 10, 15, 20, 28 flowers).
// Front stems sink into the bushes at different depths, so the heads sit at different heights.
const SLOTS = [
  [445, 738, 1.08, -4, 2], [590, 750, 1, 5, 2],
  [375, 642, 0.8, 3, 1], [655, 640, 0.82, -3, 1], [510, 560, 0.64, 0, 0],
  [315, 748, 1, -6, 2], [710, 740, 1.05, 4, 2], [515, 632, 0.78, 2, 1], [590, 558, 0.61, 2, 0], [510, 762, 1.15, 0, 2],
  [255, 644, 0.8, -4, 1], [770, 642, 0.78, 5, 1], [300, 563, 0.61, -2, 0], [710, 560, 0.63, 3, 0], [195, 756, 1.1, -3, 2],
  [820, 748, 1, 6, 2], [140, 637, 0.76, 2, 1], [880, 638, 0.8, -2, 1], [190, 566, 0.57, 0, 0], [830, 564, 0.59, 0, 0],
  [85, 740, 1, -5, 2], [930, 752, 1.08, 3, 2], [40, 647, 0.78, 4, 1], [95, 568, 0.55, 0, 0], [920, 566, 0.57, 2, 0],
  [380, 554, 0.55, -3, 0], [640, 552, 0.55, 3, 0], [960, 644, 0.76, -3, 1],
];
// A little white daisy for the bushes.
const daisy = (x, y, r) => `<g transform="translate(${x} ${y})">${[0, 60, 120, 180, 240, 300].map((a) =>
  `<ellipse rx="${r * 0.38}" ry="${r * 0.95}" transform="rotate(${a}) translate(0 ${-r * 0.9})" fill="#fbf8f0"/>`).join('')}<circle r="${r * 0.42}" fill="#f2c94c"/></g>`;
// One piece of art standing on (x, y), w wide, optionally mirrored.
const piece = (a, x, y, w, flip = false, extra = '') => {
  const h = (w * a.h) / a.w;
  return `<image href="${ART}${a.file}" x="${x - w / 2}" y="${y - h}" width="${w}" height="${h}"${flip ? ` transform="translate(${2 * x} 0) scale(-1 1)"` : ''}${extra}/>`;
};
// A row of bushes from x0 to x1, standing on y.
function bushRow(x0, x1, y, w, seed, extra = '') {
  let out = '';
  for (let x = x0, i = seed; x <= x1 + w * 0.3; x += w * 0.68, i++) out += piece(BUSHES[i % 3], x, y + ((i * 13) % 3) * 6, w * (0.9 + ((i * 7) % 4) * 0.06), i % 2 === 1, extra);
  return out;
}
// The flower field scene (same size and backgrounds as the tree). tree = { points, bg, flowers:[…], animal }
export function fieldSvg(tree, { stage = null, label = '' } = {}) {
  const s = stage ?? stageOf(tree.points ?? 10);
  const st = FIELD_STAGES[s];
  const b = BGS[tree.bg ?? 0] || BGS[0];
  const k = 1060 / b.w;
  const picks = (tree.flowers?.length ? tree.flowers : [0, 2]).slice(0, st.kinds).filter((f) => FLOWERS[f]);
  const id = `fl${uid++}`;
  const gold = s === GUARDIAN;
  const used = SLOTS.slice(0, st.n).map((p, i) => ({ p, f: FLOWERS[picks[i % picks.length]] }));
  const xs = used.map(({ p }) => p[0]);
  const x0 = Math.max(0, Math.min(...xs) - 90), x1 = Math.min(W, Math.max(...xs) + 90);
  const flower = ({ p: [x, y, z, rot], f }) => {
    const fh = 250 * z, fw = (fh * f.w) / f.h;
    return `<image href="${ART}${f.file}" x="${x - fw / 2}" y="${y - fh}" width="${fw}" height="${fh}" transform="rotate(${rot} ${x} ${y})"/>`;
  };
  const row = (r) => used.filter(({ p }) => p[4] === r).sort((a, z) => a.p[1] - z.p[1]).map(flower).join('');
  let g = `<svg class="tree-scene" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || `${st.name} flower field`)}" xmlns="http://www.w3.org/2000/svg">
    <defs><radialGradient id="${id}"><stop offset="0" stop-color="#ffffff" stop-opacity=".85"/><stop offset=".6" stop-color="#ffffff" stop-opacity=".4"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    <radialGradient id="h${id}"><stop offset="0" stop-color="#fff3c4" stop-opacity=".95"/><stop offset=".55" stop-color="#ffe08a" stop-opacity=".55"/><stop offset="1" stop-color="#ffe08a" stop-opacity="0"/></radialGradient>
    <filter id="o${id}" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="5" result="d"/>
      <feFlood flood-color="#ffffff"/><feComposite in2="d" operator="in" result="rim"/><feGaussianBlur in="d" stdDeviation="6" result="b"/>
      <feFlood flood-color="#2f4a2a" flood-opacity=".35"/><feComposite in2="b" operator="in" result="sh"/><feOffset in="sh" dy="5" result="sh2"/>
      <feMerge><feMergeNode in="sh2"/><feMergeNode in="rim"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="p${id}"><feComponentTransfer><feFuncR type="linear" slope=".72" intercept=".26"/><feFuncG type="linear" slope=".72" intercept=".26"/><feFuncB type="linear" slope=".72" intercept=".24"/></feComponentTransfer></filter>
    <clipPath id="c${id}"><rect width="${W}" height="${H}"/></clipPath></defs>
    <g clip-path="url(#c${id})"><rect width="${W}" height="${H}" fill="${SKY}"/>
    <image href="${ART}${b.file}" x="${MID - b.cx * k}" y="${BASE - b.gy * k}" width="${b.w * k}" height="${b.h * k}"/>
    <rect width="${W}" height="${H}" fill="${SKY}" opacity=".45"/>
    <ellipse cx="${(x0 + x1) / 2}" cy="${BASE - 30}" rx="${(x1 - x0) / 2 + 120}" ry="${150 + st.n * 2}" fill="url(#${id})"/>
    <path d="M${x0 - 60} 680 C${x0 - 20} 575 ${x0 + (x1 - x0) * 0.3} 548 ${(x0 + x1) / 2} 556 S${x1 + 10} 560 ${x1 + 60} 680 Z" fill="#cfe2b4"/>`;
  g += row(0);
  g += `<rect width="${W}" height="${H}" fill="${SKY}" opacity=".22"/>`;               // far flowers fade a little
  g += row(1);
  g += bushRow(x0 + 30, x1 - 30, 652, 120, 1, ` filter="url(#p${id})"`);             // back bushes, paler
  g += row(2);
  // Grass tufts in front of the stems (more as the field grows).
  const nt = Math.min(14, 2 + Math.round(st.n / 2));
  for (let i = 0; i < nt; i++) {
    const x = x0 + 30 + ((i * 0.618 + 0.31) % 1) * (x1 - x0 - 60);
    g += piece(GRASS[i % 2], x, 700 + (i % 3) * 6, 120 + (i % 4) * 20, i % 2 === 0);
  }
  g += bushRow(x0 - 30, x1 + 30, 748, 235, 0);                                        // front bushes
  const nd = Math.min(24, 2 + st.n);
  for (let i = 0; i < nd; i++) g += daisy(x0 + 20 + ((i * 0.618) % 1) * (x1 - x0 - 40), 615 + ((i * 7) % 5) * 13, 7 + (i % 3));
  g += piece(GRASS[1], x0 + 15, 696, 140) + piece(GRASS[0], x1 - 15, 698, 125, true);   // a tuft at each end
  if (gold && tree.animal != null && ANIMALS[tree.animal]) {
    // The animal is the star: a warm glow, a white sticker outline and a few sparkles.
    const a = ANIMALS[tree.animal], ah = 215, aw = (ah * a.w) / a.h;
    const cx = 640, ay = 676;
    const star = (x, y, r) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="#ffd75e" stroke="#ffffff" stroke-width="2.5" stroke-linejoin="round"/>`;
    g += `<ellipse cx="${cx}" cy="${ay - ah * 0.5}" rx="${aw * 1.05}" ry="${ah * 0.85}" fill="url(#h${id})"/>`;
    g += `<image href="${ART}${a.file}" x="${cx - aw / 2}" y="${ay - ah}" width="${aw}" height="${ah}" filter="url(#o${id})"/>`;
    g += star(cx - aw * 0.66, ay - ah * 0.88, 17) + star(cx + aw * 0.62, ay - ah * 1.04, 13) + star(cx + aw * 0.78, ay - ah * 0.5, 9);
  }
  return `${g}</g></svg>`;
}

// Small picture of one piece of art (for the choosers).
export const artImg = (file, alt = '') => `<img src="${ART}${esc(file)}" alt="${esc(alt)}" loading="lazy">`;

// Seven-sided skill wheel. skills = { key: points }.
export function wheelSvg(skills, hub = 'clinical') {
  const SKILLS = skillsFor(hub);
  const vals = SKILLS.map((s) => Number(skills?.[s.key] || 0));
  const max = Math.max(5, ...vals);
  const cx = 200, cy = 165, R = 100;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  // Full skill names, wrapped onto short lines ("Safe Behavior / Management").
  const lines = (label) => label.split(' ').reduce((acc, w) => {
    const last = acc[acc.length - 1];
    if (last && (`${last} ${w}`).length <= 10) acc[acc.length - 1] = `${last} ${w}`; else acc.push(w);
    return acc;
  }, []);
  let g = `<svg class="wheel" viewBox="0 -16 400 356" role="img" aria-label="Self-reflection skill wheel: ${esc(SKILLS.map((s, i) => `${s.label} ${vals[i]}`).join(', '))}">`;
  for (const f of [1 / 3, 2 / 3, 1]) g += `<polygon points="${SKILLS.map((_, i) => pt(i, R * f).join(',')).join(' ')}" class="wheel-ring"/>`;
  SKILLS.forEach((s, i) => {
    const [x, y] = pt(i, R);
    g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="wheel-spoke"/>`;
    const [lx, ly] = pt(i, R + 16);
    const anchor = lx > cx + 15 ? 'start' : lx < cx - 15 ? 'end' : 'middle';
    const ls = lines(s.label);
    const h = (ls.length + 1) * 14;
    const top = i === 0 ? ly - h + 4 : ly > cy + 20 ? ly + 8 : ly - h / 2 + 10;   // above the top point, below the bottom ones
    g += `<text x="${lx}" y="${top}" text-anchor="${anchor}" class="wheel-label">${ls.map((t, k) => `<tspan x="${lx}" dy="${k ? 14 : 0}">${esc(t)}</tspan>`).join('')}<tspan x="${lx}" dy="15" class="wheel-num">${vals[i]}</tspan></text>`;
  });
  g += `<polygon points="${vals.map((v, i) => pt(i, (R * Math.max(v, 0.2)) / max).join(',')).join(' ')}" class="wheel-area"/>`;
  return `${g}</svg>`;
}
