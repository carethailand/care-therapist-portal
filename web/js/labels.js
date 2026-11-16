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

// Therapists have two tiers. In the database a senior holds BOTH 'therapist'
// and 'senior'; a junior holds 'therapist' only.
//   Junior therapist: covers their own cases only.
//   Senior therapist: can cover any case; new hires observe / do field overlap with them.
// displayRoles() turns the raw roles into what people should read, as
// [{ key, label }] where key picks the chip colour.
const ROLE_ORDER = ['admin', 'hr', 'supervisor', 'qcd', 'senior', 'therapist', 'applicant'];
export function displayRoles(roles) {
  const out = [];
  for (const r of ROLE_ORDER.filter((x) => roles.includes(x))) {
    if (r === 'senior') out.push({ key: 'senior', label: 'Senior therapist' });
    else if (r === 'therapist') { if (!roles.includes('senior')) out.push({ key: 'therapist', label: 'Junior therapist' }); }
    else out.push({ key: r, label: roleLabel(r) });
  }
  return out;
}
export const rolesText = (roles) => displayRoles(roles).map((r) => r.label).join(' · ');

export const statusLabel = (s) => (s === 'exited' ? 'Left CARE' : titleCase(s ?? ''));
