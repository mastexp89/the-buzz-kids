# The Buzz Guide — Setup Guide

This is the click-by-click version. By the end you'll have:

1. A live site at `https://the-buzz.vercel.app` (or your own domain).
2. A Supabase database holding venues + gigs.
3. The ability to log in as an admin and approve new venues.

Total time: ~30–45 minutes the first time. Cost: £0.

> **Tip.** Open this file in a separate window so you can follow along while clicking.

---

## Phase 1 — Run the project locally (10 min)

You already have Node.js installed.

### 1.1  Unzip the project

You should have a folder called `the-buzz/` somewhere on your computer.
Open it in **Visual Studio Code** (free download: https://code.visualstudio.com).

### 1.2  Install dependencies

In VS Code, open a terminal: **Terminal → New Terminal**.

```bash
npm install
```

This will take 1–2 minutes the first time.

### 1.3  Make a copy of the env file

```bash
copy .env.example .env.local
```

(On macOS/Linux: `cp .env.example .env.local`)

Don't run anything yet — first set up Supabase.

---

## Phase 2 — Set up Supabase (15 min)

Supabase is a hosted Postgres database with built-in auth and file storage. Free tier is generous.

### 2.1  Create the project

1. Go to **https://supabase.com** and click **Start your project** → sign up with GitHub or email (free).
2. Click **New project**.
3. Fill in:
   - **Name:** `the-buzz`
   - **Database password:** click **Generate password**, then **copy it somewhere safe**. You won't need it day-to-day, but save it.
   - **Region:** **West EU (London)** — closest to your users.
   - **Plan:** Free.
4. Click **Create new project** and wait ~2 minutes while it provisions.

### 2.2  Run the schema

1. In the left sidebar, click **SQL Editor** (the icon that looks like `>_`).
2. Click **+ New query**.
3. Open `supabase/schema.sql` from the project folder, copy ALL of it, paste it into the editor.
4. Click **Run** (bottom right). You should see "Success. No rows returned." That's correct.
5. Click **+ New query** again.
6. Open `supabase/storage.sql`, copy all of it, paste, **Run**.

Done — the database is set up.

### 2.3  Get your API keys

1. In the left sidebar, click **Project Settings** (the gear at the bottom).
2. Click **API**.
3. Copy two values:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public key** (a long string starting with `eyJ…`)

### 2.4  Paste them into `.env.local`

Open `.env.local` in VS Code. Replace the placeholders:

```env
NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc…(very long)
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Save the file.

### 2.5  Configure auth redirect URLs

While you're in Supabase:

1. Sidebar → **Authentication → URL Configuration**.
2. **Site URL:** `http://localhost:3000` (you'll change this when you go live).
3. **Redirect URLs:** add these two lines (one per line):
   - `http://localhost:3000/auth/callback`
   - `http://localhost:3000/**`
4. Click **Save**.

### 2.6  (Optional but recommended) Disable email confirmation for testing

For your first test, it's fastest to skip email confirmation:

1. Sidebar → **Authentication → Providers → Email**.
2. Turn **Confirm email** OFF.
3. **Save**.

You can re-enable it before launch.

---

## Phase 3 — First run (5 min)

Back in VS Code's terminal:

```bash
npm run dev
```

Open **http://localhost:3000** in your browser. You should see The Buzz Guide home page.

### 3.1  Create your venue-owner account

1. Click **List your venue** (top right).
2. Fill in your details — use a real email so you can become admin in the next step.
3. You'll be sent to the dashboard. Set up your venue profile (the form will be pre-filled with the venue name you entered on signup).

### 3.2  Make yourself admin

This is the only thing you need to do manually because admins can do destructive things.

1. Back in **Supabase → SQL Editor → + New query**.
2. Paste this and **Run** (replace the email with the one you signed up with):

```sql
update public.profiles
set role = 'admin'
where email = 'youremail@example.com';
```

3. Refresh the local site — you should now see an **Admin** link in the navbar.

### 3.3  Approve your own venue

1. Go to **Admin** in the navbar.
2. Click **Approve** next to your venue.
3. Visit `http://localhost:3000/dundee` — your venue is now public.

### 3.4  Add your first gig

1. **Dashboard → + Add gig**.
2. Fill it in. Pick some genres. Save.
3. Visit `/dundee` again — the gig appears in the listings.

🎉 The whole loop works locally.

---

## Phase 4 — Going live with Vercel (15 min)

### 4.1  Push the code to GitHub

1. Sign up at **https://github.com** if you haven't.
2. In GitHub, click **+ → New repository** → name it `the-buzz` → **Private** is fine → **Create**.
3. In VS Code's terminal:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/the-buzz.git
git push -u origin main
```

(Use a personal access token if GitHub asks for one — see https://github.com/settings/tokens.)

### 4.2  Deploy to Vercel

1. Go to **https://vercel.com** and **Sign up with GitHub**.
2. Click **Add New… → Project**.
3. Import `the-buzz` from your GitHub.
4. Vercel detects it's a Next.js project — leave the build settings alone.
5. **Environment Variables** — add these three (same values as `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` — for now, leave blank; you'll set this in a moment.
6. Click **Deploy**.

After ~2 minutes, you'll get a URL like `https://the-buzz-abc123.vercel.app`.

### 4.3  Set the site URL and update Supabase

1. In Vercel → **Settings → Environment Variables** → set `NEXT_PUBLIC_SITE_URL` to the live URL Vercel gave you (e.g. `https://the-buzz-abc123.vercel.app`).
2. Click **Deployments → Redeploy** on the latest deployment to pick up the new env var.
3. In **Supabase → Authentication → URL Configuration**:
   - **Site URL:** your Vercel URL.
   - **Redirect URLs:** add `https://the-buzz-abc123.vercel.app/auth/callback` and `https://the-buzz-abc123.vercel.app/**`.

You're live.

### 4.4  Hook up your domain

You said you have a hosting reseller — perfect for buying/managing the domain.

1. From your reseller (or any registrar — Cloudflare and Namecheap have the cheapest .co.uk and .com renewals) buy a domain like `thebuzz.scot`, `thebuzzlive.co.uk`, etc.
2. In **Vercel → your project → Settings → Domains** → add the domain. Vercel will show you DNS records to add.
3. In your reseller's DNS panel for that domain, add the records Vercel asks for (an A record and/or a CNAME). Save.
4. Wait 5–60 minutes for DNS to propagate. Vercel will show a green "Valid Configuration" tick.
5. Once green, update `NEXT_PUBLIC_SITE_URL` to the new domain, and add the new domain to Supabase's redirect URLs (same steps as 4.3). Redeploy.

Done — site is on your domain.

---

## Phase 5 — Before launch checklist

- [ ] Re-enable **Confirm email** in Supabase (Auth → Providers → Email).
- [ ] In Supabase **Auth → Email Templates**, customise the confirmation email to say "The Buzz Guide" instead of "Supabase".
- [ ] Add a real favicon/logo to `public/` (replace the missing `favicon.ico`).
- [ ] Replace placeholder text on the About page (`src/app/(public)/about/page.tsx`) with your real story / contact email.
- [ ] Recruit 5–10 venues to seed the launch (a Dundee site with no listings looks dead — pre-fill it so it doesn't).
- [ ] Set up a simple form/email so people can flag wrong info.
- [ ] Tweet/Instagram a launch post and pin it.
- [ ] Add Google Analytics or **Plausible** if you want traffic stats (one-line snippet in `src/app/layout.tsx`).

---

## Phase 6 — Day-to-day admin

Whenever a new venue signs up:

1. Visit `https://yourdomain/admin`.
2. Review their venue (name, address, description — does it look real?).
3. Click **Approve** — they go live instantly.

Set up an email forward from `hello@thebuzz.scot` (your domain) to your real inbox so venues can contact you.

---

## Adding a new city later

When you're ready to expand:

```sql
update public.cities set active = true where slug = 'edinburgh';
```

That's all — venues in that city can now sign up, and `/edinburgh` works publicly.
If you want a city not in the seed list:

```sql
insert into public.cities (name, slug, active) values ('Inverness', 'inverness', true);
```

---

## Troubleshooting

**"Invalid login credentials"** when signing in — make sure you used the same email + password you signed up with. If you forgot, reset via Supabase Auth → Users → "Send password recovery".

**Auth callback isn't working in production** — the most common cause is forgetting to add the production URL to Supabase's **Redirect URLs** list (Phase 4.3).

**"Failed to fetch"** in the browser console — almost always a missing or wrong env var. Double-check `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

**My venue isn't showing on the public site** — check it's been **Approved** in `/admin`. RLS hides unapproved venues from the public.

**Image upload fails with permission error** — make sure you ran `supabase/storage.sql` (Phase 2.2 step 5–6).

---

## What's NOT in this MVP (intentionally)

These are great v2 ideas but skipped to keep launch lean:

- Native iOS/Android apps (the site is mobile-first responsive — works great on a phone).
- End-user accounts (favourites, saved venues, push notifications).
- Recurring events / templates ("every Wednesday at 9pm"). Right now venues add each gig individually.
- Embedded maps. Phase 2: drop in Google Maps embeds on venue pages.
- Stripe / paid promoted listings. Phase 3 — once you have traction.
- Newsletter / "what's on this week" digest emails.
- Reviews/ratings.

Build the audience first, monetise once venues are getting real foot traffic from you.
