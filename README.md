# CARE Therapist Portal

One record per therapist, from the day they're accepted, holding their whole journey at CARE: hiring, training, probation, and day-to-day work.

- **Plan:** `CARE_Therapist_Portal_Architecture_Plan.md` (internal, kept off GitHub; ask Songg)
- **Safety rules:** [SAFEGUARDS.md](SAFEGUARDS.md). Read these before changing anything.
- **Database setup:** [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)

## Status
**Phase 0 (foundation).** Sign-in, roles, therapist record, journey timeline, and the tab shell. Only **My Journey** is switched on. The other tabs exist but stay hidden from staff until their phase is built.

## Layout
```
web/                     the app (this folder alone is published to GitHub Pages)
  index.html
  css/app.css
  js/config.js           Supabase URL + public key, app version
  js/supabase.js         the one Supabase client
  js/auth.js             sign in / out, passwords
  js/data.js             database reads
  js/app.js              shell: screens, tab bar, routing
  js/tabs/               one file per tab (journey.js, coming-soon.js, …)
  js/admin/              admin pages (staff.js), reached from ⚙️ Admin
supabase/
  migrations/            database changes, run in filename order
  functions/             server-side helpers (staff-admin: creates logins)
  setup/                 fill-in-the-blanks admin SQL (never commit filled copies)
  checks/                read-only safety checks
.github/workflows/       deploy to Pages + daily keep-alive ping
```

## Run locally
```bash
python3 -m http.server 8766 --bind 127.0.0.1 --directory web
```
Then open http://127.0.0.1:8766/

## Adding a tab (later phases)
1. Write `web/js/tabs/<key>.js` exporting `render(panel, { me, roles, module })`.
2. Register it in `TABS` in `web/js/app.js`.
3. Admin previews it (admins see hidden tabs), then sets `enabled = true` for that row in `app_modules`. No redeploy needed for the switch.
