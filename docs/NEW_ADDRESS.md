# Giving the Portal its own address

**Why:** the Portal (`carethailand.github.io/care-therapist-portal`) and the Binder share the
start of their address, `carethailand.github.io`. Browsers save **one password per address
start**, so the two apps keep replacing each other's saved password. They also share one
browser storage area. With its own address, e.g. **`portal.carethailand.co.th`**, the
browser treats the Portal as a separate website.

Nothing changes for the data: Supabase, the database and GitHub stay the same.

---

## Part A – Ask the person who looks after carethailand.co.th (once, ~5 minutes for them)

Send them this:

> Hi! Could you please add one DNS record to **carethailand.co.th**:
>
> | Type | Name / Host | Value / Points to | TTL |
> |---|---|---|---|
> | CNAME | `portal` | `carethailand.github.io` | default |
>
> It's for our staff Portal on GitHub Pages. Thank you!

(For the Binder later: the same line with `binder` as the name.)

**Optional but recommended (stops anyone else using the name):** in GitHub, click your
picture → **Settings → Pages → Add a verified domain** → type `carethailand.co.th`.
GitHub shows a **TXT** record. Send that to the same person too. Then come back and click **Verify**.

---

## Part B – Get ready (before the switch; the old address keeps working)

1. **Supabase** (Songg): Dashboard → **Authentication → URL Configuration → Redirect URLs** →
   **Add URL**: `https://portal.carethailand.co.th/**` → Save.
   Keep the old `carethailand.github.io` line. Don't change **Site URL** yet.
2. **Claude:** let the admin helper (`staff-admin`) accept the new address as well as the old one,
   then deploy it (after Songg says OK). Invites and password links keep working from both.

---

## Part C – Switch day (once the DNS line from Part A is in)

1. **GitHub** (Songg): the **care-therapist-portal** repository → **Settings → Pages** →
   **Custom domain**: type `portal.carethailand.co.th` → **Save**.
   - Wait for the green tick ("DNS check successful"). It can take a few minutes up to an hour.
   - Then tick **Enforce HTTPS**. The certificate can take up to an hour; until then the box may be grey.
   - From now on, the old `carethailand.github.io/care-therapist-portal` link **forwards to the new
     address by itself**, so old bookmarks still work.
2. **Supabase** (Songg): **Authentication → URL Configuration → Site URL** →
   `https://portal.carethailand.co.th/` → Save.
3. **Claude:** a small SQL update so Slack links open the new address, and the admin helper's
   default link changed to the new address. Songg runs the SQL and pushes the new version.
4. **Test** (Songg, 2 minutes):
   - Open `https://portal.carethailand.co.th`, sign in, and click **Save** when the browser offers to save the password.
   - Open the old link: it should jump to the new address.
   - Send yourself a password reset or invite from People. The email link should open the new address.

---

## Part D – Tell the team

> The Portal has a new address: **portal.carethailand.co.th** (the old link still works and
> forwards). Please sign in once there and save your password when the browser asks.
> Your Binder password stays saved separately.

Everyone is signed out once, because the browser sees a new website. Small settings saved in
the browser (e.g. light/dark theme) reset once too.

---

## The Binder

The Binder needs the same steps in its own project (its own DNS line `binder`, its own GitHub
Pages custom domain, its own Supabase redirect URLs, and any links inside it). Do it in the
Binder's own Claude chat. Until the Binder moves too, its saved password lives under
`carethailand.github.io`, and the Portal's under the new address, so they stop clashing as soon
as the Portal moves.
