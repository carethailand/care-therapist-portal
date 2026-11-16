// Friendly names shared by the Staff page and the record exports.
import { titleCase } from './ui.js';

export const STAGE_LABEL = {
  interview: 'Interview',
  online_course: 'Online course + exam',
  roleplay_orientation: 'Role-play + orientation',
  field_overlap: 'Field overlap (sessions 1–8)',
  probation: 'Probation',
  active: 'Active therapist',
  certified: 'Certified',
  exited: 'Left',
};
export const stageLabel = (s) => STAGE_LABEL[s] ?? titleCase(s ?? '');

export const TRACK_LABEL = { care_hire: 'CARE staff / new hire', abat: 'ABAT course only (not CARE staff)' };
export const trackLabel = (t) => TRACK_LABEL[t] ?? titleCase(t ?? '');

export const roleLabel = (r) => (r === 'hr' || r === 'qcd' ? r.toUpperCase() : titleCase(r));

export const statusLabel = (s) => (s === 'exited' ? 'Left CARE' : titleCase(s ?? ''));
