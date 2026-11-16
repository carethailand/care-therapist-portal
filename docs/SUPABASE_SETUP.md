# Supabase setup — Portal project (Phase 0)

The steps to stand up **Project B — Therapist Portal**, in order. Each one is something you do in the Supabase dashboard or on GitHub. Nothing here touches the Binder except optional step 8, which only adds a tiny "ping" function.

**Time needed:** about 45 minutes, plus email sender setup (step 4).

---

## What we're building

| Piece | What it does |
|---|---|
| `therapists` | One record per therapist, from the day they're accepted. Its `id` is the shared **therapist_id** that every future module (exam, hours, leave, evaluations) attaches to. |
| `staff_roles` | Who is admin / HR / supervisor / senior / therapist. A person can hold several roles. Only admins can grant roles. |
| `journey_events` | The timeline. A stage change writes an entry here **automatically**, so the record builds itself. "My Journey" just displays it. |
| `app_modules` | The tab switches. A tab appears only when `enabled = true`. Admins can see switched-off tabs (marked *hidden*) to preview them first. |
| `keepalive()` | A harmless function the daily GitHub ping calls so the free project never pauses. |

**Who sees what (enforced by the database, not the app):**

| | Therapist | Senior | Supervisor | HR | Admin |
|---|---|---|---|---|---|
| Own record + timeline | read | read | read | read | read |
| Everyone's records + timelines | — | — *(trainees later, Phase 5)* | read | read | read |
| Add / edit therapist records | — | — | — | ✓ | ✓ |
| Add timeline entries | — | — | ✓ | ✓ | ✓ |
| Grant / remove roles | — | — | — | — | ✓ |
| Switch tabs on/off | — | — | — | — | ✓ |
| Delete a therapist record | nobody — leaving = status `exited` | | | | |

Someone whose status is `exited` loses all access automatically.

---

## Step 1 — Create the project

Supabase dashboard → **New project** (same organisation as the Binder; your free plan has room for this second project).

- **Name:** `care-therapist-portal`
- **Region:** Southeast Asia (Singapore) — same as the Binder
- **Database password:** generate a strong one and save it in your password manager. You won't need it day to day.
- **Security** section:
  - **Enable Data API:** ✅ on. The app talks to the database through it.
  - **Automatically expose new tables:** ⬜ **off.** A new table then stays closed until a migration grants access on purpose. That matters for the exam answer key (Phase 1), which must never be reachable from the browser. Our migrations already grant what they need, so they work with this off.
  - **Enable automatic RLS:** ✅ on. A second lock: any new table gets Row Level Security even if a migration forgets.

Also turn on **two-factor sign-in (MFA)** for your Supabase account (Account → Security). That one login opens both the Portal and the Binder.

## Step 2 — Run the database files

**SQL Editor → New query.** Paste each file, run it, then save the query using the name on its first line (`-- (keep) …`). Run them **in this order, once each:**

1. `supabase/migrations/20261116000100_identity_roles_journey.sql`
2. `supabase/migrations/20261116000200_app_modules.sql`
3. `supabase/migrations/20261116000300_keepalive.sql`

Then run the check: `supabase/checks/rls_check.sql`. **It should return no rows.** If any table is listed, stop and send me the result.

## Step 3 — Sign-in settings

**Authentication → Sign In / Providers:**
- **Allow new users to sign up: OFF.** This matters: only admins create logins. (The automatic login-to-record link relies on this.)
- Email provider: on. Confirm email: on.

**Authentication → URL Configuration:**
- **Site URL:** the Portal's GitHub Pages address (e.g. `https://<your-github-name>.github.io/care-therapist-portal/`)
- **Redirect URLs:** add that same address, plus `http://127.0.0.1:8766/` for local testing.

## Step 4 — Email sender (needed before therapists can reset passwords)

Supabase's built-in email **only sends to members of your Supabase team** and only a couple per hour. So therapists will *not* receive invite or "forgot password" emails until you connect your own sender.

- **Now (enough for Phase 0 testing):** skip this. You create logins by hand with a temporary password (step 5).
- **Before rollout to staff:** set up a free SMTP sender (e.g. Brevo or Resend free tier, using a CARE address) under **Authentication → Emails → SMTP Settings**, then raise **Rate Limits** to a sensible number. *Decision for you: which sender and which "from" address.*

## Step 5 — Make yourself the first admin

1. Open `supabase/setup/add_staff_member.sql`, paste it into the SQL Editor, and fill in your email, name, and roles: `array['admin','supervisor','therapist']`. Run it. **Don't save the filled-in copy to GitHub.**
2. **Authentication → Users → Add user → Create new user** with the *same* email, a temporary password, and **Auto Confirm User** ticked.
3. The login and the record link themselves automatically.

Add other test people the same way. They change their password from the **Password** button once signed in.

## Step 6 — Connect the app

**Project Settings → API** (or *Data API*): copy the **Project URL** and the **anon / publishable** key into `web/js/config.js`.

> Only the anon/publishable key goes in the app. **Never** the `service_role` / secret key — the repo is public.

## Step 7 — Test locally

Start the local preview (`portal-local` in `.claude/launch.json`, or `python3 -m http.server 8766 --directory web`) and open `http://127.0.0.1:8766/`. Sign in. You should see **My Journey** with "Entered stage: active" in the timeline, plus the other tabs marked *hidden* (because you're an admin).

## Step 8 — Keep-alive ping

1. Push the repo to GitHub (public is fine — UI and SQL only, no secrets).
2. Repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `PORTAL_SUPABASE_URL` and `PORTAL_SUPABASE_ANON_KEY`
3. **Actions → Keep Supabase awake → Run workflow** once to check it's green.

*Optional — keep the Binder awake too.* The Binder needs the same tiny function first. Run this in the **Binder's** SQL Editor (it reads no tables and no client data):

```sql
-- (keep) Binder – keep-alive ping
create or replace function public.keepalive() returns timestamptz
language sql stable set search_path = '' as $$ select now() $$;
revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
```

Then add `BINDER_SUPABASE_URL` and `BINDER_SUPABASE_ANON_KEY` secrets. The Binder step is skipped until they exist.

> GitHub switches off scheduled workflows in a repo with no commits for 60 days and emails you first. If that happens, click **Enable workflow**. A free UptimeRobot check is a backup.

## Step 9 — Turn on GitHub Pages

Repo → **Settings → Pages → Source: GitHub Actions.** The deploy workflow publishes only the `web/` folder.

---

## Phase 0 decisions I've made (easy to change)

- **No build step.** Plain HTML + JavaScript modules, like the Binder, but split into files instead of one big `index.html`.
- **Admin tasks are SQL for now** (add person, change stage, flip a tab). An in-app staff screen comes later.
- **Therapists can't edit their own record yet.** Changes go through admin/HR.
- **Binder link is a stored ID** (`binder_user_id`), not a shared login.

## Open decisions that affect Phase 0

1. **One login across Portal + Binder?** *(Plan §10.3.)* I recommend **separate logins for now.** The projects are separate on purpose, and syncing logins would join them. `binder_user_id` lets the Portal deep-link to the Binder without that.
2. **Email sender** for invites and password resets (step 4).
3. **Senior role scope:** seniors see only their own record until the overlap module (Phase 5) defines which trainees they work with.

---

## Step 10 — Admin → Staff page (added 2026-11-16)

**a. Run** `supabase/migrations/20261116000400_staff_admin.sql` in the SQL Editor (same way as files 1–3). It lets HR give the plain *therapist* role and adds the "never leave the Portal without an admin" guard.

**b. Login helper (`supabase/functions/staff-admin/index.ts`).** ✅ Deployed by Claude on 2026-11-16, with Verify JWT off. The function checks the caller itself. Redeploy it after any change to the file: Dashboard → **Edge Functions → staff-admin → Code**, or ask Claude.

**c. After the Portal is on GitHub Pages:** add its address (e.g. `https://<name>.github.io`) to `ALLOWED_ORIGINS` at the top of the function and deploy again.

**Who can do what on the Staff page:**
- **Admin:** everything, including roles, and logins for anyone.
- **HR:** add/edit people, give or remove the *applicant* and *therapist* roles, and create/reset logins for applicants and therapists only. HR can't do this for seniors, QCD, supervisors, HR or admins, so HR can never sign in as someone with more access.
- Temporary passwords are shown once. The person must choose their own at first sign-in.

## Step 11 — Applicants and ABAT learners (added 2026-11-16)

Run in the SQL Editor, **one at a time, in this order**:
1. `supabase/migrations/20261116000600_applicant_abat_a.sql` on its own (adds the *applicant* role and the *Certified* step).
2. `supabase/migrations/20261116000610_applicant_abat_b.sql` (adds "Who is this?" (CARE / ABAT), lets HR manage applicants, opens My Journey and Training & Exam to applicants, and makes the automatic Applicant → Therapist switch at Probation).

The login helper already allows HR to create logins for applicants (redeployed by Claude, version 2).

**How it works on the Staff page:**
- **New CARE hire:** Who is this? = *CARE staff / new hire*, role *Applicant*, stage *Interview*. Move them along the stages. When they pass overlap session 8 and sign the contract, set the stage to **Probation**. They become a Therapist automatically.
- **ABAT learner:** Who is this? = *ABAT course only*. They're always Applicant only. Stage *Online course + exam* → **Certified** when they pass.
- Filter the list with **CARE staff / New hires / ABAT learners**.
