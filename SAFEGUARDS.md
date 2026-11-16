# CARE Therapist Portal — SAFEGUARDS (read before editing)

This Portal holds **staff and training records**: who someone is, their journey, roles, and (later) hours, evaluations, and leave. It is the record of people's careers at CARE, so treat it with care.

## Golden rules
1. **No child PHI in this project. Ever.** Children's records live only in the CaRe Binder (a separate Supabase project). The Portal may store a Binder *ID* to deep-link, never a child's name, address, or clinical data. Hours imports must strip client names and addresses down to categories (age band, communication profile) **before** anything is saved.
2. **No secrets in this repo.** It is public. Only the anon/publishable key goes in `web/js/config.js`. Never the `service_role` key, database password, exam answer keys, or a filled-in copy of `supabase/setup/*.sql`.
3. **Every new table gets Row Level Security, at least one policy, and explicit `grant`s in the same migration.** The project was created with "Automatically expose new tables" **off**, so a table with no `grant ... to authenticated` is closed to the app. Grant only what the app needs, and never grant `anon` anything except `keepalive()`. Secret tables (exam answer keys) get **no grants at all** and are read only by server-side grading functions. Then run `supabase/checks/rls_check.sql`; it must return no rows.
4. **Permission checks happen in the database (RLS), not in the browser.** Hiding a button is never security. The browser asks for everything; the database decides.
5. **Records are never deleted.** A therapist who leaves gets status `exited`, which removes their access. There is no delete policy on `therapists`.
6. **Ranks are a ladder: Applicant → Junior (`therapist`) → Senior → QCD → Supervisor; HR and Admin are office roles on top.** One rank per person. A rule for "X and above" must list every higher rank too (e.g. senior, qcd, supervisor). Only admins give Senior and above, HR or Admin; HR may give only Applicant and Junior. Keep it that way so nobody can promote themselves.
7. **Thailand dates.** Database defaults use `Asia/Bangkok`. In the browser, never use `new Date().toISOString().slice(0,10)` for "today" (it gives UTC, which is yesterday before 07:00).
8. **Every SQL file or snippet starts with a name line** (`-- (keep) Name` or `-- (test) Name`) so saved queries in the SQL Editor stay tidy.
9. **Songg runs SQL; tools don't.** Write SQL for Songg to run in the dashboard. Don't run queries against either Supabase project directly.
10. **Exports stay out of GitHub.** "Download record" (PDF) and "Export everyone" (Excel) contain staff personal data. They belong in CARE's Google Drive. `.gitignore` blocks `*.xlsx`/`*.csv`; never commit a PDF export either.
11. **Exam questions and answers live only in the database's `private` schema.** The browser gets questions through `exam_start()` without answers; marking is server-side. Never add exam files (questions.json etc.) to this repo; admins import them through ⚙️ Admin → Training content.
12. **CARE Connect anonymous messages stay anonymous.** Anonymous messages carry no sender. The link to the sender (so they can see their own messages on any device) lives only in the locked table `private.connect_anon_senders`, which the app can't read; only the CARE Connect functions use it, and only to show senders their own messages. **Nobody ever queries that table, or Supabase's request logs, to find out who sent an anonymous message.** Never expose it through a view, an export, or a new function. Times of anonymous messages and follow-ups are kept as the day only. Team members only see messages sent to their team.

## Do not break
- `AUTH_STORAGE_KEY = 'care_portal_auth'` in `config.js`. The Binder uses `'care_auth'` on the same github.io address; sharing a key would sign people out of one app when they use the other.
- `esc()` / `textContent` for all database text shown on screen.
- Signups stay **disabled** in Supabase Auth. The auto-link trigger (`private.link_new_auth_user`) matches logins to records by email, which is only safe when admins create every login.
- Each release: bump `APP_VERSION` in `config.js`.

_Plain language, reassurance, "your data is safe" first. Keep this file current._
