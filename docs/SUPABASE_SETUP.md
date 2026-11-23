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

## Step 23 — Close a training group (added 2026-11-16)

1. **Run** `supabase/migrations/20261116002400_training_group_close.sql`.
2. **Publish** the app.

When everyone in a group has finished (completed, not passed or withdrawn), **Groups & schedule** shows **Close group** instead of *+ Plan session*. It:
1. **Downloads one .zip**: `Summary.xlsx` (People, Sessions, Assignments, Practicum, About) + a folder per person with `Record.html` (prints to PDF) and their assignment files. Save it in CARE's Google Drive.
2. After you check the .zip, **Clear files and close group** deletes the uploaded files from the Portal (scores, hours, checklist marks and results stay) and marks the group *Closed*.

**Completed card:** a finished programme shows one card with its badge (S for Senior, Q for QCD), the completion date, **View certificate** and **Show steps**. Current Seniors and above see *Senior Therapist Training · Completed before the Portal* with the S badge automatically.

## Step 24 — New training badges + training completed before the Portal (added 2026-11-17)

1. **Run** `supabase/migrations/20261116002500_legacy_training.sql`.
2. **Publish** the app (run the SQL first: the People screen reads the new column).

Badges for completing training are now certificate-and-rosette badges: **silver** = Senior Therapist Training, **gold** = QCD Training, **prism** = Supervisor Training.
- Senior Therapist Training counts automatically for Senior therapists and above.
- QCD Training counts automatically for QCD staff. For **Supervisors**, an admin ticks **Completed before the Portal → QCD Training** on the People screen (only those who did it).
- Supervisor Training counts for Supervisors.

## Step 25 — Learning Hub: study log, leaves and your tree (added 2026-11-17)

1. **Run** `supabase/migrations/20261117002600_learning_hub.sql`. It adds the 26 topics and switches the **Learning Hub** tab on for CARE staff.
2. **Run** the private file `Portal training content/Learning Hub/Learning Hub links (setup).sql` (kept off GitHub: some links are Google Drive files). It adds the links from the old hub.
3. **Publish** the app.

How it works:
- Each person first **plants their seed**: 10 skill points placed across the 7 skills (a self-check, up to 4 in one skill).
- **Leaves** (worked out in the database, never by the page): 1 per reflection box written properly (15+ characters; up to 5 per log; only the first 2 logs a day), 1 per resource marked done with a one-line note (up to 3 a day), +5 when a supervisor / QCD / admin reviews a reflection. Supervisors / QCD / admin can also **Give** leaves (role-play, training…).
- **10 leaves = 1 skill point**, which the person puts into a skill. The tree grows with total skill points: Seedling 10 · Sprout 20 · Sapling 30 · Tree 40 · Grove 60 · Forest Guardian 100 (an animal can join).
- The **self-reflection skill wheel** (a self-check, used by supervisors to plan support and training) is private (the person + supervisors / QCD / admin). The **tree** shows on Our Team for everyone.
- Supervisors / QCD / admin: **Team** view (to review, give leaves, see wheels) and **Links** view (add / edit links).

## Step 26 — Learning Hub: one measurement topic (added 2026-11-17)

**Run** `supabase/migrations/20261117002700_learning_measurement_methods.sql`. A-01 and A-02 become one topic, "Measurement methods: continuous & discontinuous" (A-02's links and logs move to A-01; A-02 is hidden). The page works before or after you run it.

## Step 27 — Learning Hub: manage topics (added 2026-11-17)

1. **Run** `supabase/migrations/20261117002800_learning_topic_manage.sql` (after 027).
2. **Publish** the app. Run the SQL first: editing a topic saves its new description field.

Topics now show as **cards** in the 7 areas (each area has its own colour); tapping a card opens the topic's page (description, links, Done, "Log a study session on this topic"). Codes like A-01 are no longer shown.
Supervisors / QCD / admin: **Manage topics** (was "Links") → **+ Add topic** in any area, or tap a topic to rename it, move it to another area, add a short description, change its order, and add / edit / reorder / remove its links. **Remove topic** deletes an empty topic, or hides one that already has study logs (shown under "Hidden topics", where it can be shown again).

## Step 28 — Sign-in links to send on Slack (added 2026-11-17)

1. **Deploy** the updated `staff-admin` Edge Function (Verify JWT stays **OFF**). It adds a third action, `signin_link`.
2. In Supabase → **Authentication → Sign In / Providers → Email**, set **Email OTP Expiration** to `86400` (24 hours, the most allowed). Sign-in links last this long.
3. Check **Authentication → URL Configuration → Redirect URLs** includes `https://carethailand.github.io/care-therapist-portal/` (it should already).
4. **Publish** the app.

How to use: ⚙️ Admin → People → **🔗 Sign-in links** → tick people (everyone without a login is ticked) → **Make links** → **Copy Slack message** for each and paste it into that person's **direct message**. The link works once: they tap it, choose a password and are signed in. Someone who already has a login gets a "choose a new password" link (for forgotten passwords). HR can make links for applicants and junior therapists only; admins for everyone. No password is ever shown or sent.

## Step 29 — Choose badges for my team card (added 2026-11-17)

1. **Run** `supabase/migrations/20261117002900_team_badge_showcase.sql` (after 028).
2. **Publish** the app (it works before the SQL too: cards then show the usual badges).

**My Journey → My team card / My badges** (the one place to edit your card since P8k): edit photo and "about me", and tap up to 5 earned badges in **My badges**, in the order you want. Others see only those, plus "+N" for the rest. Badges not earned are never shown. If someone hasn't chosen, the card shows their latest year, probation, longest-serving and training badges (up to 5). Training badges (Senior / QCD / Supervisor) now show on team cards too.

**Update (P8l, function v5):** sign-in links now open the Portal itself (…/#signin=…) and the person taps **Continue**. The old links went to Supabase directly, and Slack's link preview "opened" them first, using them up. The secret part sits after "#", which previews never send. Expired or used links now say so clearly. Links made before this update won't work: make new ones.

## Step 30 — Learning Hub: CARE tools + old hub history (added 2026-11-17)

1. **Run** `supabase/migrations/20261117003000_learning_tools.sql` (after 029).
2. **Run** the private file `Portal training content/Learning Hub/Learning Hub history + tools (setup).sql`. It adds the CARE tools (Timesheet, ABA Binder, Handouts, Twinkl, Canva), the extra links from the old hub's Resources sheet, and the old history: 1 leaf per different resource each current staff member looked up, with those resources shown as Done. No reflection text is copied.
3. **Publish** the app.

CARE tools show as a row at the top of the Learning Hub (a swipeable strip on phones). Supervisors / QCD / admin edit them under **Manage topics → CARE tools** (name, optional link, optional note, icon). Handouts has no link yet: add it there when ready.

## Step 31 — SAFMEDS practice (added 2026-11-17)

1. **Run** `supabase/migrations/20261117003100_safmeds.sql` (after 030).
2. **Run** the private file `Portal training content/Learning Hub/SAFMEDS sets (setup).sql` (CARE's 8 sets, 78 cards).
3. **Publish** the app.

Learning Hub → **SAFMEDS**: tap a set → **Learn** (flip through, no timer) or **1-minute timing** (shuffled; say the answer, tap the card, mark Got it / Missed; Space / → / ← on a keyboard). The database saves the counts and decides leaves: 1 leaf for the first timing of the day; a set is **mastered** when its aim (default 30+ correct, 2 or fewer missed) is met on 3 different days, +5 leaves once per set. Each set shows the best score, aim dots (x of 3) and a chart of past timings. Supervisors / QCD / admin edit sets under **Manage topics → SAFMEDS sets** (name, aim, cards; Remove hides a set and keeps past timings).

**Also (P8n, no SQL):** Training → Trainees → Open a person → **Remove from this course** (admin, active places). The place is marked Withdrawn (kept for the record, hidden from the list); they can be assigned again later.

## Step 32 — Portal manager role + supervisors approve kudos (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003200_portal_manager_a.sql` **on its own** (adds the role name).
2. **Run** `supabase/migrations/20261118003210_portal_manager_b.sql`.
3. **Deploy** the updated `staff-admin` Edge Function (Portal managers can make logins and sign-in links). Verify JWT stays OFF.
4. **Publish** the app.

**Portal manager (GM)** is an office role: everything an Admin can do to run the Portal (People, logins, sign-in links, export, tabs, training content and approvals, promotions, Learning Hub, kudos), **except** leave details (requests, reasons, sessions, allowances, decisions) and the **Admin team inbox** in CARE Connect, which stay with Admin (and HR). Give yourself **Portal manager first**, save, then untick Admin (you can't remove your last control role). **Supervisors** can now approve kudos too.

## Step 33 — Slack notifications (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003300_slack_notifications.sql`.
2. In Slack, make an **incoming webhook** for each channel (see below), then paste the addresses into the private file `Portal people/Slack webhooks (setup).sql` and run it. It ends by posting a hello to each channel.

Channels: **#admin-leave** (new leave request, leave cancelled) · **#tx-to-admin** (CARE Connect to Admin, passed on to Admin, training place waiting for approval) · **#tx-to-sup** (CARE Connect to Supervisors & QCD, reflection / assignment to review) · **#tx-to-senior** (CARE Connect to Seniors) · **#kudos-approval** (kudos waiting). Messages say only what is waiting and from whom (never for anonymous messages), with a link: no message text, reasons or scores.

Making a webhook: Slack → **Tools & settings → Manage apps** (or api.slack.com/apps) → create an app "CARE Portal" for the CareThailand workspace → **Incoming Webhooks** → On → **Add New Webhook to Workspace** → pick the channel → copy the address. Repeat for each channel. Whoever adds the webhook must be in that channel (private channels); it keeps working after they leave. Keep the addresses private.

## Step 34 — QCD and Supervisor Training "Coming soon" (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003400_training_coming_soon.sql` (after 033; it is safe before or after the app is published).
2. **Publish** the app.

Training & Exam now shows **QCD Training (Therapist Liaison)** and **Supervisor Training (Case Manager / Supervisor)** to everyone at CARE, marked **Talk to Admin**: the steps and what each one needs, with no lessons yet and nobody can be assigned. People who already hold the rank see "Completed before the Portal" as before. Supervisor step details say "Talk to the Admin team for details" until Songg sends them. When a path is ready, its content is added and `coming_soon` is switched off.

**Also (P9a–c, no SQL):** the last journey stage is now **Thriving**; office-only staff see their role on Home instead of the journey track; Portal managers show a small **GM** tag on their photo instead of a badge; CARE Connect inboxes (My inbox · Admin · Supervisors · Seniors) are tabs.

**Also (P9e–f, no SQL):** a **new version popup**: after a push, anyone with the Portal open sees "A new version of the Portal is ready" with **Update now** / **Later** (checked when they come back to the Portal and every 10 minutes; never during an exam; Later = not asked again for that version). Training paths whose steps have no details yet (Supervisor) show just the step line, no step cards.

## Step 35 — Learning Hub for the admin team: admin skills + flower field (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003500_admin_learning_hub.sql` (after 034).
2. **Publish** the app.

**Who:** office-only staff (Admin / HR / Portal manager with **no** therapist rank) get the admin hub. Everyone with a clinical rank keeps the therapist hub. Someone who already planted a tree keeps it.

- **7 admin skills:** Scheduling & Coordination · Family Communication · Records & Privacy · Finance & Billing · Team & HR Support · Tools & Systems · Professionalism & Ethics, with 21 starter topics and a few links (Google Workspace and Slack help, PDPC Thailand).
- **Flower field** instead of a tree, same points and stages: Bud 10 (2 flowers, mix 2 kinds) · Bloom 20 (5, 3) · Flower patch 30 (10, 4) · Garden 40 (15, 5) · Meadow 60 (20, 6) · Flower Field Keeper 100 (28 flowers + one animal). Same 4 backgrounds and 9 animals; 10 kinds of flower (Vecteezy, non-AI).
- **Leaves:** study reflections and Done resources as before, plus **helping** (+1 each, at most 3 a day, automatic): replying to a CARE Connect message sent to Admin (once per message), answering a leave request.
- **Portal manager** reviews admin reflections (+5), gives admin staff leaves (e.g. help outside the Portal) and manages admin topics/links (Learning Hub → Manage topics → **Admin team topics**). Supervisors / QCD don't see the admin team in Team.
- SAFMEDS and CARE tools are hidden on the admin hub.

## Step 36 — Learning Hub: experience leaves by rank (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003600_learning_experience_leaves.sql` (after 035). Everyone who has already planted gets their bundle straight away.
2. **Publish** the app.

After the 10-point self-check, each person gets a one-time bundle of **experience leaves** for their clinical rank, to place in the skills they choose: Therapist 0 · Senior 100 · QCD 200 · Supervisor 300 (10 leaves = 1 skill point, so Senior starts at Sprout, QCD at Sapling, Supervisor at Tree). A promotion tops it up automatically (e.g. Senior → QCD +100); it is never taken back. Shown in Recent leaves as "Experience as …". The admin team (no clinical rank) gets none for now. The "Use your leaves" window now stays open so many points can be placed in one go.

**Also (P9h–j, no SQL):** flower field with layers, grass and bushes (Vecteezy 69962547); update popup also checks 4 s after opening, on returning to the window, and every 5 min (tap the version number to check now); plain topic cards (only the small area dot keeps its colour).

## Step 37 — Learning Hub: move points on your own skill wheel (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003700_learning_rebalance.sql` (after 036).
2. **Publish** the app.

Learning Hub → **Move points** (next to "Self-reflection skill wheel"): take points from one skill (−) and give them to another (+), then Save. The total stays the same, so the tree / flower field never shrinks. Only the person themselves can do this, any time; no history is kept.

## Step 38 — Learning Hub: leaves for years at CARE (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003800_learning_years_leaves.sql` (after 037). Everyone who has already planted gets theirs straight away.
2. **Publish** the app.

Every full year at CARE (from the **start date** in People) = **5 skill points (50 leaves)**, for everyone at CARE including the admin team, on top of the rank bundle (Senior 10 · QCD 20 · Supervisor 30 points). All past years count, so a Supervisor with 10 years starts in Grove and one with 12+ at Forest Guardian. Each work anniversary adds 50 more, picked up when the person next opens the Learning Hub (a 🎉 note shows). Never taken back; correcting a start date upwards tops it up. Shown in Recent leaves as "N years at CARE". The "Use your leaves" window offers 1 or 5 points a tap.

## Step 39 — New therapist onboarding path (added 2026-11-18)

1. **Run** `supabase/migrations/20261118003900_new_tx_onboarding.sql` (after 038).
2. **Publish** the app.

Training & Exam → **Trainees → New therapist onboarding** (first in the list). New therapists appear while their stage in People is Interview → Probation (CARE staff / new hire). **Open** a person to plan and record:

| Step | Admin / Portal manager plans | Recorded by | Rule |
|---|---|---|---|
| 1 Interview | date (+ interviewer) | — | — |
| 2 Online course | — | from the Training tab | ABAT passed (+ CARE Way when it's switched on) |
| 3 Orientation | date, place, who runs it | the person running it / sup / QCD / admin | Done |
| 4 Role-play (9 topics) | date + trainer (supervisor / QCD) per topic | the trainer: attended, signed off, % Independent (optional) | 80% flag for tracking; sign-off = attended |
| 5 Written exam (paper) | date, place, proctor | proctor / sup / QCD / admin: score of 130 | pass 80% (104) |
| 6 Field overlap 1–7 | date, trainer (any therapist, seniors listed first), case code | the trainer: signed off + short note | — |
| 6 Session 8 field evaluation | date, supervisor, case code | supervisor: average 0–4 + date reviewed | pass 3 or more |
| 7 Probation | evaluator (a supervisor, who also runs the review session), probation evaluation date (= probation end date in People), case code, review session date + time (P9r/P9s) | supervisor: Passed / Not yet | → Thriving |

When everything for a stage is done, the person's panel shows **Move to …** (admin confirms; it changes their stage in People as before). Trainers who aren't on the training team (e.g. seniors running overlaps) see **Onboarding sessions you lead** at the top of their Training tab. The trainee sees their path (dates, people, done / passed; never scores or notes) in Training & Exam, a "Next: …" card on Home and a link on My Journey. Checklists stay on paper. Case codes only (3 capital letters), never a name.

## Step 40 — Kudos "To everyone" + who it's for (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004000_kudos_to.sql` (after 039).
2. **Publish** the app (P9p).

When someone ticks **Ask Admin to post this on the Kudos board**, a new box asks **Who is this kudos for?** (optional, e.g. "Pao and Ploy"). Empty = the board says **To everyone at CARE** (a thank-you sent to one person still shows their name). The inbox it was sent to only decides who reviews it; it no longer shows on the board. In **Kudos waiting for the board**, the admin / supervisor can change "To …" as well as the wording. Kudos already posted to a team now say "To everyone at CARE".

Also in P9p (no SQL): Learning Hub → **How to earn leaves** (link under the leaves count, and a section at the bottom): how each way earns leaves, the daily limits and the stages, plus a line about "surprise leaves" (gifts from supervisors / Portal manager are kept a secret). Therapists see only the therapist ways (tree); office-only staff see only the admin ways (flower field: helping, Portal manager review). It only explains; the database still decides the leaves.

staff-admin **v6** deployed 2026-11-19: the Portal manager can create logins, reset passwords and make sign-in links, the same as an admin.

## Step 41 — One-tap planting + edit the wheel with − / + (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004100_learning_wheel_edit.sql` (after 040).
2. **Publish** the app (P9p).

- **Planting is one tap.** The tree / flower field starts at its first stage (Seedling / Bud) for everyone, with an empty wheel. The 10 starter skill points come as 100 welcome leaves, on top of promotion and years leaves. The old "place 10 points, max 4 each" screen is gone.
- **Edit my wheel** (button above the wheel, and "Use your skill points"): − / + one point at a time, then Save. New points cost 10 leaves each; points can also be moved between skills. The total never goes down, so the tree never shrinks. Replaces "Use your leaves" (1 or 5 a tap) and "Move points".
- Under the wheel: "You have N skill points left to use."
- Stages now start at 0: Seedling / Bud is the first stage, then Sprout 20 · Sapling 30 · Tree 40 · Grove 60 · Forest Guardian 100 (same for the flower field). People already in the hub are unchanged.

## Step 42 — New badges, first five (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004200_badges_round2.sql` (after 041).
2. **Publish** the app (P9q).

Five new badges unlock by themselves and appear in My Journey → badges (earned, plus the next level locked), and can be picked for the Our Team card (up to 5). If someone hasn't picked, they fill any free space on the card.

| Badge | Unlocks when | Who |
|---|---|---|
| ABAT passed | an ABAT place is marked passed | therapist ranks |
| SAFMEDS master | a SAFMEDS set is mastered | therapist ranks |
| Resources (9 levels) | Learning Hub resources done | everyone on the staff badge path |
| Reviewed logs (9 levels) | study logs reviewed | everyone on the staff badge path |
| Kudos given (9 levels) | thank-yous you SEND with your name, to a person or a team, on the board or not (Portal 043; history counts) | everyone on the staff badge path |

Levels: **silver 1 / 5 / 8 · gold 10 / 15 / 18 · holographic 20 / 25 / 30** (1, 2, 3 stars in each colour, plus the number; same silver / gold / holographic colours as the Senior, QCD and Supervisor Training badges; no colour words on screen). Other people only see the level reached (e.g. 10), never exact counts or what was studied. Still to come (waiting for art): Field evaluation passed, Helping hand, Newest therapist and the hand-given badges.

## Training tab: My training / My trainees (P9u, 2026-11-19, no SQL)

- **Supervisors, QCD, and seniors who lead onboarding sessions** get two tabs: **My training** (their own programmes, done-before-the-Portal and previews) and **My trainees** (sessions they lead + the Trainees panel for the training team). The page remembers the last tab on that device; the first time, it opens on My trainees if they have sessions to record.
- **Office-only staff** (admin, HR, Portal manager with no clinical rank): no clinical programme cards; they see only the trainees side (plus any programme they are actually enrolled in).
- **Therapists with no trainees**: one page, as before.
- Supervisors / QCD still see every trainee in every programme (unchanged).

## Step 43 — Kudos badge = kudos given (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004300_kudos_given_badge.sql` (after 042).
2. **Publish** the app (P9v).

The hand-with-heart badge now counts thank-yous a person **sends** (with their name). Anonymous thank-yous never count, so a badge can't give an anonymous sender away. A separate **Kudos received** badge comes later (art folder 16).

## Step 44 — Newest therapist badge (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004400_newest_therapist_badge.sql` (after 043).
2. **Publish** the app (P9w).

The current therapist (Junior, Senior, QCD or Supervisor) with the latest start date holds **Newest therapist** (blue rosette, baby feet with a gold star). It passes on by itself when someone newer becomes a therapist; trainees still in onboarding don't count. Shown on My Journey like Longest-serving (locked "Newest at CARE" when someone else holds it), and on the team card (with Longest-serving) unless the person picked other badges.

## Step 45 — Supervision tab, part 1: QCD sessions (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004500_supervision_qcd.sql` (after 044).
2. **Publish** the app (P9y). The tab stays **hidden** (admins see it marked HIDDEN to try it first). To switch it on for everyone, run:
   `update public.app_modules set enabled = true where key = 'supervision';`

- **QCD / supervisors** → Team: everyone (current therapists) with this year's QCD count, last total, and **Needs attention** (last 2 QCDs, any case, both below 2.5 → "PIP suggested"; a supervisor decides). Open a person → **Record a QCD session**: date, case code (3 letters), level (Junior / Senior-QCD / Supervisor), tap 0 · 1 · 2 · 3 · N/A per item, notes (strengths, previous goals, new goals). Totals = average of the section averages, worked out again in the database. Not on yourself.
- **Therapists** → My supervision: their own QCD sessions (read-only) with a small trend line.
- **Supervisors + admin / Portal manager** → **Edit checklist**: change wording, groups, levels, add / remove / reorder items and sections. Each save is a new version; recorded sessions keep the wording they were scored with.
- The checklist starts as the QCD master (Junior 22 items, Senior 43). The **Supervisor** level has no items yet (Chandni's list).
- HR doesn't see this tab. Scores and short text only (no files): about 1 MB a year for QCD sessions.

## Step 46 — Leave: ask to cancel approved leave (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004600_leave_cancel_request.sql` (after 045).
2. **Publish** the app (P9z).

- **Pending** request: the therapist cancels it straight away (as before).
- **Approved** leave that hasn't ended: the therapist taps **Ask to cancel** and gives a short reason. It shows "Cancel requested" (they can tap **Keep my leave** to withdraw). Slack admin-leave gets "Cancel request".
- **Admin / HR** see it in **Waiting for HR** (and the new **Cancel requests** filter): **Approve cancel** (leave cancelled, days back on the balance) or **Keep leave** (with a note the therapist sees).

## Step 47 — Supervision list by rank + names A–Z everywhere (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004700_supervision_people_rank.sql` (after 046).
2. **Publish** the app (P9z).

- Supervision → Team: supervisors are no longer listed (they don't get QCD sessions); the list is grouped **QCD → Senior → Junior**, names A–Z in each group. Supervisors have no "My supervision" view for now, and the QCD form's level choice is Junior or Senior / QCD.
- Names are sorted A–Z (by the name people see, ignoring capitals) on every page: People, Our Team, Leave, Training, onboarding, CARE Connect, Learning Hub team, Supervision.

## QCD results view (Q1, 2026-11-19, no SQL)

My supervision (and a person's window for QCD / supervisors) now shows: 4 numbers (latest total + change, year average, strongest area, area to work on), **total score over time** (dotted 2.5 line; sessions below 2.5 are hollow rings; tap a point for date / case / who), **score by section, each session** (stronger colour = higher, number always shown), **focus items** (items scored 0–1 in the latest session) and **goals** (strengths, previous goals, new goals), then the session list. Light and dark colours are set separately (text contrast ≥ 4.5).

## Step 48 — Live QCD observation + raw tallies (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004800_qcd_live_tallies.sql` (after 047).
2. **Publish** the app (Q1).

**Record a QCD session** now opens a full-screen live screen (made for tablet / laptop): sections on the left (All items · Recent · Not scored yet · each section with progress, total so far), items on the right in any order, with a search box.
- **Counted** items: tap ✓ correct / ✕ missed. The score works itself out from % correct (Junior 70% = 3, 50% = 2, 30% = 1; Senior / QCD 90 / 70 / 50%) once there are at least 3 chances ("too few yet" before). **Rated** items (Professionalism): tap 0–3 / N/A.
- Tap any score to set it **by hand** (dashed outline), or go back to the tally. **Undo** the last tap.
- Saved **on this device** as you go; if you leave, you can continue next time. **Review and save** shows every score, then strengths / goals.
- The raw tallies (correct / chances per item) are saved with the session for the year-end summary; recorded sessions keep their scores.
- Checklist editor: each item is **Counted ✓ / ✕** or **Rated 0–3**, and the score rule (minimum chances and the % for 1 / 2 / 3, per level) can be changed.

## Step 49 — QCD drafts kept in the Portal (added 2026-11-19)

1. **Run** `supabase/migrations/20261118004900_qcd_drafts.sql` (after 048).
2. **Publish** the app (Q2).

While scoring a live QCD, the draft is saved on the device **and** in the Portal (a moment after each tap), so you can start on one device and finish on another. The header shows 🔒 "Draft saved · only you can see it until you tap Save QCD". A draft is private to the person scoring (one per scorer per therapist) and is deleted when the QCD is saved; drafts older than 30 days are cleared. With no connection it says "Draft kept on this device only" (yellow) and sends it up when the connection is back.

## Step 50 — Yearly review, step 1: year-end self-reflection (added 2026-11-19)

1. **Run** `supabase/migrations/20261118005000_yearly_self_reflection.sql` (after 049).
2. **Publish** the app (Q3).

- **Everyone** (office staff too; HR can now open the Supervision tab) sees **Yearly review {year}** in My supervision → **Year-end reflection**: the CARE Year-End Reflection & Growth Review, 22 questions in 6 parts (Thai or English), one part at a time with a side list showing progress. It saves as they type (🔒 draft only they can see), then **Submit**. They can still change it after submitting.
- **Supervisors + admin / Portal manager** → Team → **Yearly review**: everyone grouped (Supervisors, QCD, Senior, Junior, Office team) A–Z with "submitted / draft / not started"; open a submitted one to read it. Drafts can't be opened. QCD don't see this list.
- The questions are a versioned form ('self') kept in the database; answers keep the version they were written with.

## Step 51 — Yearly review, step 2: admin evaluation (added 2026-11-19)

1. **Run** `supabase/migrations/20261118005100_yearly_admin_eval.sql` (after 050).
2. **Publish** the app (Q4).
3. In Supervision → Team → Yearly review → **Admin sections**, check each section's owner (the SQL looks up Pao, Oat and Ploy by nickname; pick the right person if one is "Nobody yet").
4. Open **P'A** and **Chandni** → tick **No yearly review for this person**.

- **Admin evaluation**, twice a year (half 1 Jan–Jun, half 2 Jul–Dec; any time): Human Resources · Billing / Payroll · Scheduling, 0–3 or N/A per item (scale from the half-year admin sheet; Time late rule shown). Each section is scored **only by its owner**; the Portal manager can cover any section. Section average + **HR performance** = average of the three sections.
- **Attendance** for the half (AL / PL / SL / LWP / other, approved leave from Leave & HR, plus the AL allowance) is shown to Admin and HR for the discussion; it isn't scored.
- Team → Yearly review: each person shows reflection status + admin progress (half 1 x/3 · half 2 x/3); filter **Admin to score**. Open a person → **Reflection | Admin evaluation**.
- Who reads: supervisors + admin / Portal manager. The person sees scores only when the review is released (step 4). Office staff write a reflection but aren't evaluated here.

## Step 52 — Yearly review, step 3: clinical checklist with IOA (added 2026-11-19)

1. **Run** `supabase/migrations/20261118005200_yearly_clinical_ioa.sql` (after 051).
2. **Publish** the app (Q5).

- Open a person (Team → Yearly review) → **Clinical**. **Admin (e.g. Ploy) / Portal manager → Assign / change**: lead supervisor, second supervisor, and the mid-year / year-end review meeting dates (can be added later; the lead runs the meetings with an admin).
- **Lead and second** each score the yearly checklist on their own (17 items from the half-year supervisor sheet; Junior 10, Senior/QCD 17; 0–3 / N/A, plus strengths / areas to grow): Save draft, then **Submit my scores**. Neither sees the other's until they've submitted.
- **Compare and set the final** (the lead): lead | second | final per item, items that **differ** highlighted, **IOA %** (items scored the same ÷ items both scored). Agreed items are filled in; the lead taps the final for the rest and saves. If the second never scores (e.g. no clinic with the person), the lead can set the final from their own scores.
- Final = the clinical score (average of the section averages). Supervisors + admin see the final and IOA; the person sees it at release (step 4).
- For reference while scoring: the year's QCD sessions and the **QCD item summary** (all tallies added up, score from the data vs average of sessions).
- **Edit yearly checklist** (supervisors / admin): Chandni adds the supervisor items there (tick Supervisor). Supervisors are evaluated by Chandni as lead, no second.
- List: "Clinical: lead Boss ✓ · second Fon …" or "final 2.92 · IOA 80%"; filter **Clinical for me**.

## Step 53 — Yearly review, step 4: release + sign (added 2026-11-19)

1. **Run** `supabase/migrations/20261118005300_yearly_release_sign.sql` (after 052).
2. **Publish** the app (Q6).

- In the person's yearly review (Team → Yearly review → open a person), admin / Portal manager or the **lead supervisor** see "Shown to …" with **Show check-in** (was "mid-year") and **Show year-end** (and Hide, until the person signs). Use them in the review meeting.
- **Check-in shown** (the mid-year check-in meeting): the person sees their admin evaluation for half 1 and their QCD so far (My supervision → Yearly review → Check-in meeting → See details).
- **Year-end shown**: the person sees Clinical, HR performance (average of the halves) and the **Final score** (= average of the two), with every item in See details, then taps **I agree, sign** (optional comment). After signing it can't be hidden.
- The list shows "shown: mid ✓ · year-end ✓ · signed 15 Dec" per person. Office staff only see the reflection step.

## Step 54 — Year report + Close the year (added 2026-11-19)

Run `supabase/migrations/20261118005400_year_report_close.sql` after Step 53.

- **Year report:** one page per person: QCD charts, clinical checklist, admin evaluation, final score and signature. Open it from a person in Yearly review → **Year report**, then **Save as PDF** (the browser's print window → Save as PDF; it prints in light colours, one person per page).
  - Admin, supervisors and the Portal manager can open anyone's. QCD can't.
  - The person can open their own from **My supervision** once the year-end review is shown.
  - **All reports (PDF)** in Yearly review makes one PDF with everyone.
- **Close the year** (Admin or Portal manager, from 1 December): keeps one summary line per person (QCD average, clinical, HR performance, final, lead/second, signed date) and deletes that year's details (QCD sessions, clinical and admin scores, comments, reflections, assignments, old drafts). Type `CLOSE 2026` to confirm. **Save the PDFs first: it can't be undone.** Keep the PDFs in the CARE drive, never in GitHub.
- A closed year shows the summary table in Yearly review; each person sees their own summary line.

## Step 55 — Hand-given badges + Kudos received (added 2026-11-19)

Run `supabase/migrations/20261118005500_badge_gifts.sql` after Step 54, then publish the app (Q11).

- **Our Team → a person's card → 🎖️ Give a badge** (Supervisor, QCD, admin, Portal manager): School shadow, Supporter, Stimuli Master, Unshakable. Not to yourself; each badge once per person. Admin / Portal manager can **Take back**.
- Hand-given badges never show as locked; the person sees them once given (card + My Journey), and can pick them for their team card.
- **Kudos received** (THANKS badges, 1–30): thank-yous sent to you with the sender's name. Anonymous ones never count.

## Step 56 — Office badges: Scheduler + Centre manager (added 2026-11-20)

Run `supabase/migrations/20261118005600_admin_badges.sql` after Step 55, then publish the app (Q12).

- Two more hand-given badges in Our Team → Give a badge, **only for Admin / the Portal manager**: Scheduler and Centre manager. Supervisors and QCD only see the 4 clinical ones.
- Every hand-given badge now has a short meaning, shown when giving it, under it in My Journey, and when you point at it on a team card.
- School shadow, Supporter, Stimuli Master and Unshakable no longer have a ribbon (the picture says it); Kudos received keeps its THANKS ribbon with the count.

## Step 57 — Change a pending leave request (added 2026-11-20)

Run `supabase/migrations/20261118005700_leave_request_edit.sql` after Step 56, then publish the app (Q13).

- While a request is **waiting for HR**, the therapist sees **Edit** next to Cancel: they can change the type, dates, half day, days, reason and the sessions they'll miss. HR sees "✏️ Changed <date>" on it, and the admin-leave Slack channel gets a note (if Slack is set up).
- Once approved, changes go through **Ask to cancel** (Step 46) as before.

## Step 58 — The CARE board + red dot (added 2026-11-20)

Run `supabase/migrations/20261120005800_care_board.sql` after Step 57, then publish the app (Q14).

- CARE Connect now opens with the **CARE board**: badge news and kudos in one list (All / Badges / Kudos), newest first, with a "New" tag on anything since you last looked.
- Every new badge is news; count badges (Resources, Study logs, Kudos given, Kudos received) only at a new colour (1, 10, 20). Badges people already had when you run this are saved quietly, so the board starts fresh. Longest-serving and Newest aren't announced.
- All CARE staff can react ⭐ ❤️ 👍 🚀 🎉 (once each, tap again to undo). "Who reacted" shows the names.
- Below the board: a compact inbox (5 rows, then "Show all") and a folded **Share something** box: Idea, Concern, Question, Thank you. Problem is now part of Concern.
- Admin / Supervisors see a small "Kudos waiting for the board" bar when something needs posting.
- A **red dot** on the CARE Connect tab means something new on the board or in your inbox. Opening CARE Connect clears it.

## Step 59 — QCD counts in the final score + "Check-in meeting" (added 2026-11-20)

1. **Run** `supabase/migrations/20261120005900_final_score_qcd.sql` (after 054; it doesn't need 058).
2. **Publish** the app (Q15).

- **Final score = average of Clinical, HR performance and QCD average** (equal thirds). If a part is missing (e.g. no admin evaluation for half 1), it uses the parts there are.
- The mid-year meeting is now called the **Check-in meeting** everywhere: the lead + an admin look at the QCD so far and the admin evaluation (half 1). At the check-in, QCD is shown for the talk only.
- The year report, the person's year-end review and Close the year all use the new rule.

## Step 60 — Explorer and All set badges (added 2026-11-21)

1. **Run** `supabase/migrations/20261121006000_explorer_all_set.sql` (after 058).
2. **Publish** the app (Q18).

- **Explorer**: open every tab in your own menu at least once. The Portal keeps one tick per tab per person (first time only). Office staff only need the tabs they have. My Journey shows progress ("5 of 8 so far").
- **All set**: team card has a photo, an "about me" line and chosen badges.
- Both are for CARE staff (not applicants). New ones are announced on the CARE board; cards that were already "All set" are saved quietly.
- Art (Q19): Explorer = the explorer in the leaves (Vecteezy); All set = round ribbon badge from the "badge idea" pack with "ALL SET".

## Step 61 — Office badge "Assistant" + Explorer / All set on your card (added 2026-11-21)

1. **Run** `supabase/migrations/20261121006100_assistant_badge.sql` (after 060).
2. **Publish** the app (Q19).

- **Assistant** (the robot with the headset): hand-given office badge, like Scheduler and Centre manager. Only Admin / the Portal manager can give it (Our Team → 🎖️ Give a badge).
- Fix: Explorer and All set can now be chosen to show on your team card.

## Step 62 — Supervisor evaluation, part 1 (added 2026-11-23)

1. **Run** `supabase/migrations/20261123006200_supervisor_evaluation.sql` (after 061).
2. **Run** the private file `Supervisor evaluator (setup).sql` (kept outside GitHub). It names the one person who scores supervisors. Its last line should show exactly one name.
3. **Publish** the app (Q22, then Q23 for the Admin step).

- The checklist has 103 items in 9 weighted areas, rated 1–5 or N/A, with an optional detail note for each item. There's also a summary, previous goals and new goals.
- Scores are worked out in the database. An area's average counts rated items only. The weights are shared again over the areas that were rated. Bands: below 2 Does not meet, 2 Developing, 3 Meets, 3.5 Exceeds, 4.5 Exceptional.
- The steps are: draft → finished → shared → signed.
- The evaluator uses **Supervision → Team → Supervisor evaluations** to start or continue an evaluation, then marks it **finished**. They can reopen it until it's shared.
- **Admin** (the Admin role itself, not just Portal manager) sees every finished evaluation in the same place. They set up the review meeting, **Print** it (with signature lines), and **Share** it with the supervisor. Admin or the evaluator can hide it again until it's signed.
- The supervisor uses **Supervision → My supervision → My evaluations** to read it once it's shared and sign it. Signing means "seen", not "agree".
- Other supervisors never see these. A draft is only seen by the evaluator. Evaluations aren't removed when a year is closed.
- Running 062 again is safe (e.g. after an update to it).

## Step 63 — Supervisor evaluation, part 2: due dates (added 2026-11-23)

1. **Run** `supabase/migrations/20261123006300_supervisor_eval_due.sql` (after 062).
2. **Run** the private file `Import 2026/2026 supervisor evaluation dates.sql` (kept outside GitHub). It adds evaluations done before the Portal. The last table shows each supervisor's next evaluation.
3. **Publish** the app (Q24).

- **Supervision → Team → Supervisor evaluations** shows each supervisor's next evaluation, its due date, and whether it's overdue, due soon (within 30 days) or on track. The title shows how many are overdue or due soon.
- The rule:
  - In the first year as a supervisor: a 6-month evaluation, then a 12-month one (counted from "supervisor since").
  - After that: a mid-year check-in 6 months after the last 12-month or annual evaluation, then the annual evaluation 12 months after it. If the check-in was skipped and 10 months have passed, the annual comes next.
- What counts as done: evaluations marked finished in the Portal, plus "past evaluations" typed in for dates before the Portal (date and type only).
- Tap a supervisor's name to set **Supervisor since** and to add or remove past evaluations. The evaluator and Admin can do this.
- A new evaluation starts with the type that's due.
