// Kudos stickers (thank-you messages). Art: Vecteezy.com, free licence —
// the credit line below is required wherever stickers are shown.
// Adding or removing one: put/remove the PNG in assets/stickers/ and edit this list.
import { esc } from './ui.js';

export const STICKERS = [
  { key: 'unicorn', label: 'Great job (unicorn)' },
  { key: 'unicorn-jump', label: 'Great job (leaping unicorn)' },
  { key: 'cactus-amazing', label: 'Great job, you\'re amazing (cactus)' },
  { key: 'robot-red', label: 'Great job (red robot)' },
  { key: 'lion', label: 'Great job (space lion)' },
  { key: 'rainbow', label: 'Well done (rainbow)' },
  { key: 'cactus-cool', label: 'Well done (cool cactus)' },
  { key: 'robot-blue', label: 'Well done (blue robot)' },
  { key: 'ufo', label: 'Well done (UFO)' },
  { key: 'tiger', label: 'Well done (space tiger)' },
  { key: 'butterfly', label: 'You did it (butterfly)' },
  { key: 'rainbow-pink', label: 'You did it (rainbow)' },
  { key: 'penguin', label: 'You did it (astronaut penguin)' },
  { key: 'shooting-star', label: 'You\'re a superstar (shooting star)' },
  { key: 'unicorn-star', label: 'You\'re a superstar (unicorn)' },
];

const byKey = new Map(STICKERS.map((s) => [s.key, s]));

export const stickerSrc = (key) => `assets/stickers/${key}.png`;

// <img> for a sticker key, or '' if there's none / it's unknown.
export function stickerImg(key, cls = 'sticker') {
  const s = byKey.get(key);
  return s ? `<img class="${esc(cls)}" src="${stickerSrc(s.key)}" alt="Sticker: ${esc(s.label)}" width="256" height="256" loading="lazy">` : '';
}

export const ART_CREDIT = 'Stickers and milestone badges: <a href="https://www.vecteezy.com" target="_blank" rel="noopener">Vecteezy.com</a>';
