// Learning Hub "grow your tree": skills, stages, the tree scene and the skill wheel.
// Every scene is the same size (1000×680): the background is softened so the
// tree stands out, the tree always stands in the middle, and at Forest Guardian
// one animal can join it. Points are worked out in the database, never here.
import { BGS, LOOKS, ANIMALS } from './tree-art.js';
import { esc } from './ui.js';

export { BGS, LOOKS, ANIMALS };

export const SKILLS = [
  { key: 'measurement', label: 'Measurement', short: 'Measure' },
  { key: 'skill_acq', label: 'Skill Acquisition', short: 'Skills' },
  { key: 'behavior_red', label: 'Behavior Reduction', short: 'Behavior' },
  { key: 'ethics', label: 'Ethics', short: 'Ethics' },
  { key: 'modern_aba', label: 'Modern ABA', short: 'Modern' },
  { key: 'school_shadow', label: 'School Shadow', short: 'School' },
  { key: 'safe_behavior', label: 'Safe Behavior Management', short: 'Safety' },
];
export const skillLabel = (k) => SKILLS.find((s) => s.key === k)?.label || k;

export const STAGES = [
  { name: 'Seedling', at: 10, h: 110 },
  { name: 'Sprout', at: 20, h: 165 },
  { name: 'Sapling', at: 30, h: 245 },
  { name: 'Tree', at: 40, h: 335 },
  { name: 'Grove', at: 60, h: 420 },
  { name: 'Forest Guardian', at: 100, h: 500 },
];
export const GUARDIAN = STAGES.length - 1;
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

// Small picture of one piece of art (for the choosers).
export const artImg = (file, alt = '') => `<img src="${ART}${esc(file)}" alt="${esc(alt)}" loading="lazy">`;

// Seven-sided skill wheel. skills = { key: points }.
export function wheelSvg(skills) {
  const vals = SKILLS.map((s) => Number(skills?.[s.key] || 0));
  const max = Math.max(5, ...vals);
  const cx = 160, cy = 150, R = 105;
  const pt = (i, r) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  let g = `<svg class="wheel" viewBox="0 0 320 300" role="img" aria-label="Self-reflection skill wheel: ${esc(SKILLS.map((s, i) => `${s.label} ${vals[i]}`).join(', '))}">`;
  for (const f of [1 / 3, 2 / 3, 1]) g += `<polygon points="${SKILLS.map((_, i) => pt(i, R * f).join(',')).join(' ')}" class="wheel-ring"/>`;
  SKILLS.forEach((s, i) => {
    const [x, y] = pt(i, R);
    g += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="wheel-spoke"/>`;
    const [lx, ly] = pt(i, R + 26);
    g += `<text x="${lx}" y="${ly - 6}" text-anchor="middle" class="wheel-label">${esc(s.short)}</text><text x="${lx}" y="${ly + 9}" text-anchor="middle" class="wheel-num">${vals[i]}</text>`;
  });
  g += `<polygon points="${vals.map((v, i) => pt(i, (R * Math.max(v, 0.2)) / max).join(',')).join(' ')}" class="wheel-area"/>`;
  return `${g}</svg>`;
}
