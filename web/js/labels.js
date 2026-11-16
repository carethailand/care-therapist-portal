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

// Clinical RANK: one per person, lowest to highest. Each rank includes what
// the ranks below it can do (database rules list every rank that qualifies).
//   applicant  new hire in training, or ABAT learner
//   therapist  Junior therapist: covers their own cases
//   senior     Senior therapist: covers any case; new hires overlap with them
//   qcd        Quality Control Department: role-play training, overlap forms, evaluations
//   supervisor supervises therapists
// OFFICE roles sit outside the ladder and can be added to any rank: hr, admin.
export const RANKS = ['applicant', 'therapist', 'senior', 'qcd', 'supervisor'];
export const OFFICE_ROLES = ['hr', 'admin'];
export const RANK_LABEL = {
  applicant: 'Applicant',
  therapist: 'Junior therapist',
  senior: 'Senior therapist',
  qcd: 'QCD',
  supervisor: 'Supervisor',
};
// Highest rank someone holds (older records may hold several), or null.
export const rankOf = (roles) => [...RANKS].reverse().find((r) => roles.includes(r)) ?? null;

// What people should read: rank first, then office roles, as [{ key, label }]
// where key picks the chip colour.
export function displayRoles(roles) {
  const rank = rankOf(roles);
  const out = rank ? [{ key: rank, label: RANK_LABEL[rank] }] : [];
  for (const r of OFFICE_ROLES.filter((x) => roles.includes(x))) out.push({ key: r, label: roleLabel(r) });
  return out;
}
export const rolesText = (roles) => displayRoles(roles).map((r) => r.label).join(' · ');

// Badge artwork per rank / office role (assets/badges/, credit in CREDITS.md).
export const BADGE_FILE = {
  applicant: 'Applicant.png', therapist: 'Junior.png', senior: 'Senior.png',
  qcd: 'QCD.png', supervisor: 'Supervisor.png', hr: 'Admin.png', admin: 'Admin.png',
};

export const statusLabel = (s) => (s === 'exited' ? 'Left CARE' : titleCase(s ?? ''));
