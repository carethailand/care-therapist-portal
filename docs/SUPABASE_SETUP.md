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
- **Ranks:** each person has one rank (Applicant → Junior → Senior → QCD → Supervisor) plus, optionally, the office roles HR and/or Admin.
- **Admin:** everything, including ranks and office roles, and logins for anyone.
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

## Step 12 — Training tab: ABAT Coursework (added 2026-11-16)

1. **Run** `supabase/migrations/20261116000700_training_abat.sql`, then `20261116000800_training_policies_attempts.sql` (policies to agree, all-modules rule, attempts + waiting days), in the SQL Editor (one file; Supabase may show the "destructive operations" warning because of `revoke`/`delete` inside the functions. That's expected; click **Run query**).
2. **Run** `supabase/checks/rls_check.sql` again. It must return **no rows**.
3. **ABAT content:** run *Portal training content / 1 ABAT / ABAT course setup – run once in Supabase.sql* (kept off GitHub), then in ⚙️ Admin → Training content → ABAT exam → **Import from file…** choose *ABAT Readiness Exam – Portal import file.json*.
4. In the Portal: **⚙️ Admin → Training content**:
   - **Course modules:** add each Canva / PDF / video link (shared as "anyone with the link can view").
   - **ABAT exam:** set the time limit and pass mark, then **Import from file…** (old `questions.json`) or **+ Add question**.
   - When it's ready, click **Show to staff** to switch the Training tab on.

**How it works**
- Applicants get a place on ABAT Coursework automatically when their stage is *Online course + exam*.
- Exam questions and answers are stored in the database's private area. The trainee's browser never receives the answers; marking happens on the server, with a server-side timer.
- Attempts and the waiting time between them are exam settings (ABAT: 2 attempts, 7 days apart). Trainees must agree to the course policies and tick every module first. An admin or supervisor can **Allow extra attempt** from the Trainees list.
- Each person gets a **finish-by date** when they start: ABAT course = **2 weeks for CARE new hires, 6 weeks for ABAT learners** (Course settings). Admins can change one person's date from the Trainees list (e.g. an approved extension); late people show as *Overdue*. The exam is part of that period: after the date, no new exam attempt can start until an admin extends the date.
- Canva modules are shown inside the Portal (no link on screen). To cut off a shared link, turn the public link off in Canva, make a new one, and paste it into the module.
- Questions and options are shuffled for every attempt. Trainees see pass / not pass, their score and a summary by domain (A–G), never which questions they got wrong. Admins, supervisors and QCD can open **Review** for any attempt: every question with their answer, the correct answer and ✓/✗ (Save as PDF possible). Needs file `20261116000900_exam_review.sql`.
- Passing gives a certificate (with a number) and a timeline entry. ABAT learners move to *Certified* automatically. CARE new hires: move them to *Role-play + orientation* yourself.

⚠️ The old Training portal repo (`therapist-onboarding-training`) is public and contains `questions.json` **with the answer key** and `trainees.json` with PINs. Make that repo private (GitHub → repo → Settings → Danger Zone → Change visibility) and consider refreshing the questions before using them here. Never put exam files in this repo.

## Step 13 — Leave & HR tab (added 2026-11-16)

1. **Run** `supabase/migrations/20261116001100_leave.sql`, then `supabase/checks/rls_check.sql` (no rows).
2. **Publish** the app (it reads the new employee no. / department fields, so run step 1 first).
3. In **⚙️ Admin → People**, fill in each person's **Employee no.** and **Section/department** (printed on the leave form).
4. In the **Leave & HR** tab → *Annual leave allowances*, set each person's **AL days** for the year (+ carry-over for the admin team, use-by date).
5. Switch the tab on for staff: Table Editor → `app_modules` → `leave` → `enabled = true` (or ask Claude to add a switch).

**Run also** `20261116001200_leave_session_arrangements.sql` (after 011).

**Who does what:** therapists request leave, list the sessions they'll miss, and see their balances; an **admin decides each missed session** (cancelled / covered by / make-up) with *Arrange sessions*; **HR approves or declines** (admins can too); an **admin ticks "Families notified"**. Days are counted by work week: **seniors, QCD and supervisors Monday–Friday** (5-day week), **juniors and admin staff Monday–Saturday**; Sundays never count, half days allowed, and people can correct the number (e.g. a scheduled Saturday). Sessions are recorded by **3-letter case code only** (e.g. ABC); the database refuses anything else. Each person's year can be saved as a PDF laid out like the paper form.

## Step 14 — CARE Connect (added 2026-11-16)

1. **Run** `supabase/migrations/20261116001300_care_connect.sql`, then `20261116001400_care_connect_more.sql`, then `20261116001500_care_connect_hidden_sender.sql`, then `supabase/checks/rls_check.sql` (no rows).
2. **Publish** the app.
3. Switch the tab on when ready: `update public.app_modules set enabled = true where key = 'connect';`

**How it works:** therapists send an *idea, concern, problem, question or thank-you* to the **Admin team** (admin + HR), the **Supervisor & QCD team**, or both. The page promises a reply within **5 working days**; the inbox flags messages waiting longer. The team can reply, add **internal notes** (never shown to the sender), set the status (*Received → Looking into it → Resolved*) and choose who looks after it.
**Recipients:** Admin team (admin + HR), Supervisor & QCD team, Senior team, or one person (only they see it; they can *Pass to the Admin team*). Problems always go to the Admin team. Messages to one person can be anonymous only if they're a thank-you.
**Kudos board:** a thank-you can ask Admin to post it; an admin approves (and may tidy the wording) under *Kudos waiting for the board*. All CARE staff see the board on CARE Connect and the latest three on Home.
**Anonymous:** the message has no sender, and nobody in the Portal (team, supervisors, admins) can see who sent it. The sender sees it, with replies, in *My messages* on any device: the link is kept in a locked private table the app can't read (SAFEGUARDS 12). Times are kept as the day only.

> **Honest limit:** someone opening the database directly (the project owner) could see the private sender link, and Supabase's own request logs (about a day) record who made each request. CARE's rule (SAFEGUARDS 12) is that nobody ever looks.

## Step 15 — Kudos stickers + milestone badges (added 2026-11-16)

1. **Run** `supabase/migrations/20261116001600_stickers_milestones.sql`, then `supabase/checks/rls_check.sql` (no rows).
2. **Publish** the app (run the SQL first: the new Portal sends a sticker with every message).

**Stickers:** a thank-you can carry one sticker (15 to choose from, in `web/assets/stickers/`, list in `web/js/stickers.js`). It shows on the message, in the admin's kudos queue, on the Kudos board and on the Home kudos card.
**Milestone badges** (`web/assets/milestones/`), unlocked by themselves for CARE staff (not applicants or ABAT learners):
- *Passed probation*: when the person's stage is **Therapist** (active).
- *1, 2, 3, 4, 5, 7, 10 years*: counted from the **Start date** on the People screen (stars = years; 3 = Hat trick, 5 = High five, 10 = Legend).
- *Longest-serving therapist*: the current therapist (Junior, Senior, QCD or Supervisor) with the earliest Start date; ties share it, and it passes on when someone leaves (`milestone_longest()`).
Home shows the latest year badge (it replaces the one before) plus Passed probation and Longest-serving; the Journey page shows the whole collection with unlock dates.
**Credit:** sticker and milestone art is from Vecteezy.com (free licence, credit required). The Portal shows "Stickers and milestone badges: Vecteezy.com" wherever they appear.

## Step 16 — Our Team page (added 2026-11-16)

1. **Run** `supabase/migrations/20261116001700_our_team.sql`, then `supabase/checks/rls_check.sql` (no rows).
2. **Publish** the app.
3. Switch the tab on when ready: `update public.app_modules set enabled = true where key = 'team';`

**What it shows:** current CARE staff (not applicants, ABAT learners or people who have left), grouped as *Admin & HR* (office staff without a clinical rank), *Supervisors*, *QCD*, *Senior therapists*, *Junior therapists*. Each card: photo (or initials), nickname and full name, rank and office badges, the latest year badge plus Passed probation / Longest-serving, a short "about me" (280 characters) and years at CARE. Only current CARE staff can open the tab.
**Editing:** each person taps *Edit my card* to add a photo and their line. The photo is cropped to a square and shrunk in the browser before upload (about 50 KB). Photos are stored privately in Supabase Storage (`team-photos`, 2 MB limit, JPG/PNG/WebP); staff see them through links that last an hour. SAFEGUARDS 13: staff photos only, never children.

## Step 17 — One Learning Hub tab (added 2026-11-16)

**Run** `supabase/migrations/20261116001800_merge_learning_tabs.sql`. Learning Hub, Resource Links and Journal Library (placeholders) become one tab, **Learning Hub**, with those as sections when it's built.

## Step 18 — ABAT Coursework page design (added 2026-11-16)

1. **Run** `supabase/migrations/20261116001900_abat_coursework.sql` (renames the course to *ABAT Coursework*, says "lessons" instead of "modules", adds an empty accreditation line).
2. **Publish** the app (run the SQL first: the new page reads the accreditation line).

The course page now has a header (name, summary, lessons and hours, finish-by date, progress bar, step path) and folding steps: the step you're on is open, the others closed. Lessons show a coloured domain letter (A–G) and a round tick. To show "Qualified by QABA" (or similar) under the course name, fill in **Accreditation line** in ⚙️ Admin → Training content → Course settings.

## Step 19 — Senior Therapist Training (added 2026-11-16)

1. **Run** `supabase/migrations/20261116002000_senior_training.sql`, then `supabase/checks/rls_check.sql` (no rows).
2. **Run** the private file *Portal training content › 2 Senior › Senior course setup – run once in Supabase.sql* (kept off GitHub). It adds the seven steps, ten videos and the 2026 practicum checklist, and switches the programme on.
3. **Publish** the app.

**How it works:** a supervisor taps *+ Recommend someone* (Junior therapists only) with a reason; an admin taps **Approve**. Trainees tick videos themselves (admin sends the links). Supervisors/QCD/admin log in-person hours (*Log a group session* or per person), record the written and oral exam results (score / full score + pass / not pass), and fill the practicum checklist (Prep 1–4, Clinic 1–4, technical skills) in the Portal; the checklist shows the pass rule as ticks. Trainees see pass / not pass + date for exams, and their practicum marks and comments. When the oral exam (the last step) is recorded as passed and every recorded step is passed, the place is completed and a certificate is issued; an admin then taps **Promote to Senior** (rank and badge change, timeline entry).

## Step 20 — Senior in-person chapters (added 2026-11-16)

**Run** `supabase/migrations/20261116002100_senior_chapters.sql` (after Step 19), then publish. The in-person training step lists the 14 chapters; when logging a session, the supervisor ticks the chapters covered. Trainees see each chapter ticked once covered; the Trainees table shows hours and chapters (e.g. 16 / 40 h · 6/14 chapters).

## Step 21 — Training groups, schedule and attendance (added 2026-11-16)

1. **Run** `supabase/migrations/20261116002200_training_groups.sql`, then `supabase/checks/rls_check.sql` (no rows).
2. **Publish** the app.

In **Training → Trainees**, programmes with in-person training (Senior) get a **People | Groups & schedule** switch.
- **Admins** create a group (name + people with an active place; one group per person), then **+ Plan session**: a training session (date, start time, hours, chapters, place, supervisor), an exam date (written / oral), or other. Sessions can be edited, cancelled or deleted.
- **Supervisors / QCD / admins** tap **Attendance** after a training session (everyone ticked by default); hours and chapters are logged for everyone who came. Saving again replaces that session's attendance.
- **Trainees** see *Next: date, time* in the course header, their group's schedule (upcoming + past, with *Attended*) in the in-person step, and planned exam dates on the exam steps.

## Step 22 — Chapter assignments (added 2026-11-16)

1. **Run** `supabase/migrations/20261116002300_training_assignments.sql`, then `supabase/checks/rls_check.sql` (no rows). It also creates the private file store `training-work` (10 MB per file; PDF, Word, JPG/PNG/WebP).
2. **Publish** the app.

- **Trainees:** the in-person training step lists the 14 chapter assignments, each *due 7 days after the session that covers it*. **Upload** (photos are shrunk first), **Open**, **Replace** until reviewed; they see *Submitted*, *Reviewed* or *Please redo* with the comment.
- **Supervisors / QCD / admins:** **To review (N)** in Trainees → People lists everything waiting; each trainee's **Open** panel has **Assignments** (all 14 chapters). Open the file, add a comment, mark **Reviewed** or **Please redo**.
- Files are private (only the trainee and the training team can open them, via links that last 10 minutes). "Close group" (next) exports and clears them.
