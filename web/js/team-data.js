// Our Team data: the list comes from team_directory() (names, ranks, about,
// photo, milestone results — no HR details). Photos live in the private
// "team-photos" store; the page asks for short-lived links to show them.
import { supa } from './supabase.js';

const BUCKET = 'team-photos';
const must = ({ data, error }) => {
  if (error) throw new Error(error.message || String(error));
  return data;
};

export const directory = () => supa.rpc('team_directory').then(must);

export const setProfile = (about, photoPath) =>
  supa.rpc('team_set_profile', { p_about: about, p_photo_path: photoPath }).then(must);

// { path: url } for the given photo paths (links last an hour).
export async function photoUrls(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return {};
  const { data, error } = await supa.storage.from(BUCKET).createSignedUrls(list, 3600);
  if (error) return {};
  return Object.fromEntries((data || []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
}

// Square-crop and shrink a picture to 480×480 JPEG in the browser, so uploads
// are small (~50 KB) and every card looks the same.
export async function squarePhoto(file, size = 480) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  bmp.close?.();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not read that picture.'))), 'image/jpeg', 0.85));
}

export async function uploadPhoto(meId, blob) {
  const path = `${meId}/photo-${Date.now()}.jpg`;
  must(await supa.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
  return path;
}

export async function removePhoto(path) {
  if (!path) return;
  await supa.storage.from(BUCKET).remove([path]); // best effort
}
