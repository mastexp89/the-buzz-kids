# Web App Audit — for Mobile App Sync

Snapshot of the web app's current state for the iOS / mobile rewrite.
All paths are relative to `src/app/`.

---

## 1. Auth

### Sign-up form (`(auth)/signup/page.tsx`)
- **Account-type pills still there**: Venue / Artist / Event organiser. Set via `?as=venue|artist|organiser` URL param or clicked.
- **Fields**:
  - All: `display_name`, `email`, `password` (min 8 chars)
  - Venue accounts only: `venue_name` (collected upfront so the trigger can scaffold)
  - Artist / organiser: just name + email + password
- **One form, single submit**. Pills toggle field visibility, not the endpoint.
- **Submission**: `supabase.auth.signUp({ email, password, options: { emailRedirectTo, data: { display_name, venue_name: account_type === "venue" ? venue : null, account_type } } })`
- **`options.data` shape**: `{ display_name: string, venue_name: string|null, account_type: "venue"|"artist"|"organiser" }`. Sits on `auth.users.raw_user_meta_data`.
- **Trigger** (`sql/024_artist_signup_dedupe.sql`) creates the `profiles` row, mapping `account_type` to `profiles.role`:
  - `venue` → `venue_owner`
  - `artist` → `artist`
  - `organiser` → `event_organiser`
- **Artist-only side-effect**: trigger checks for an unclaimed artist row with a matching normalised name. If one exists, it does NOT auto-create a new artist — `/dashboard/setup` wizard handles it.

### Auth methods
- **Email + password** — primary, standard Supabase flow
- **Magic links** — used internally only:
  - Admin "sign in as user" feature (`generateImpersonationLink`)
  - Branded transactional emails
  - **NOT** exposed as a passwordless login option on the public form
- ❌ No Google sign-in
- ❌ No Apple sign-in
- ❌ No 2FA / MFA
- ❌ No phone-number sign-in

### Email verification
- Whatever's configured in **Supabase Dashboard → Authentication → Settings**. Default is "confirm email enabled". When enabled, signup returns `data.user` but no `data.session` until the user clicks the email link.
- **Confirmation redirect URL**: still `/auth/callback` — unchanged.
- **Custom branded HTML email templates** in use for all four:
  - Confirm signup
  - Reset password
  - Magic link
  - Change email
- HTML lives in `docs/supabase-email-templates.md` — pasted directly into the Supabase Dashboard.

### Auth callback (`/auth/callback/route.ts`)
- Handles email confirmation, magic-link, OAuth-style callbacks
- Exchanges `?code=...` for a session via `supabase.auth.exchangeCodeForSession`
- On error: redirects to `/login?error=<message>` so the user gets a readable explanation
- On success: redirects to `?next=` param (defaults to `/dashboard`)

### Password reset
- **Initiator**: `supabase.auth.resetPasswordForEmail(email, { redirectTo: ${SITE}/auth/update-password })`
- **In-app reset page**: `/auth/update-password` (unchanged)
- **Email template**: branded (custom HTML in Supabase dashboard)

### `profiles` table columns (current)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK, FK to auth.users(id) |
| `email` | text | Synced from auth.users on signup trigger |
| `display_name` | text nullable | |
| `role` | text | check: `user`, `venue_owner`, `artist`, `event_organiser`, `admin` |
| `created_at` | timestamptz | default now() |

**No new columns** added. Phone / location / preferences NOT stored on profiles. If mobile wants those, add new columns + populate via signup `options.data`.

---

## 2. Submit-a-gig flow (`/submit-gig`)

Still a single page. **No native flow built yet** — the v1.2 idea hasn't shipped on web either.

- Auth required (redirects to `/login?next=/submit-gig`)
- Two paths from the page:
  - **Manual form** — pick city → pick venue (autocomplete) → date + title + description + lineup + price + ticket URL
  - **📸 Upload poster** at `/submit-gig/upload-poster` — uses the AI extraction pipeline (Claude Vision)
- Submission handler: `submit-gig/actions.ts → submitGig(...)`
- Submitted gigs land as `events.status = 'pending'` in the venue owner's dashboard queue
- Venue owner gets a notification email
- If the venue isn't on The Buzz Guide yet, the form lets the user enter the venue's name + city; we create a `venue_suggestions` row and email the venue.

---

## 3. New tables / migrations (sql/011 → sql/027)

Run in this order in Supabase (007–010 were already applied previously):

| File | Purpose |
|---|---|
| `sql/011_venue_claims.sql` | Claim flow for unowned venues. `venue_claims` table, RLS, triggers. |
| `sql/012_event_extraction.sql` | AI event extraction tracking. `extraction_batches` table + `auto_imported_*` columns on events. |
| `sql/013_artist_claims.sql` | Mirror of venue claims, for artist pages. |
| `sql/014_analytics.sql` | `page_views` table (server-side tracking). Powers `/admin/analytics` and the live activity widget. |
| `sql/015_click_tracking.sql` | `click_*` columns on venues + events (track outbound link clicks). |
| `sql/016_create_artist_on_signup.sql` | First-cut trigger that creates an artist row for artist-account signups. |
| `sql/017_last_facebook_scrape.sql` | `venues.last_facebook_scrape` timestamp; FB cron uses this to prioritise stalest first. |
| `sql/018_artist_socials_and_storage.sql` | Adds `instagram`, `facebook`, `twitter`, `tiktok`, `spotify`, `bandcamp`, `youtube` columns to artists + storage bucket. |
| `sql/019_messages.sql` | `messages` table — single thread per non-admin user with admin team. |
| `sql/020_festivals_and_venue_cover.sql` | Full festival schema + `venues.cover_photo_url`. |
| `sql/021_festival_stat_overrides.sql` | Per-festival display overrides ("100+ acts" etc.). |
| `sql/022_festival_preview_token.sql` | Share unpublished festival pages via `?preview=...` |
| `sql/023_slug_redirects.sql` | `slug_redirects` table — old artist/venue URLs auto-301 to new ones. |
| `sql/024_artist_signup_dedupe.sql` | **Replaces** sql/016 trigger — skip auto-create when similar unclaimed artist exists. |
| `sql/025_user_delete_fk_cleanup.sql` | ON DELETE SET NULL on stray FKs to `auth.users` so account delete actually works. |
| `sql/026_angus_city_and_nearby_areas.sql` | Adds `cities.nearby_areas text[]` + Angus city row. |
| `sql/027_venues_owner_id_nullable.sql` | Lets `venues.owner_id` be NULL so auto-imported venues sit unclaimed. |

---

## 4. Mobile-specific config keys

**None prepared on web side.** No `EXPO_PUBLIC_*` env keys, no mobile-specific config files. Mobile app needs its own:
- `EXPO_PUBLIC_SUPABASE_URL` (same as `NEXT_PUBLIC_SUPABASE_URL`)
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (same as `NEXT_PUBLIC_SUPABASE_ANON_KEY`)

---

## 5. UI / UX changes worth mirroring

### Copy
- Replaced "live music · Dundee" with "**Gigs · DJs · Nights out**" / "**what's on tonight**" everywhere — generic so it works for multiple cities
- Replaced "punters" with "fans" / "customers"
- Multi-city: homepage now shows "**Browse Dundee →**" / "**Browse Angus →**" buttons (one per active city, Dundee first)
- City pages now have a "**Covering: <towns>**" line under the city name (uses `nearby_areas`)

### Visuals
- **Image priority chain on venues**: `logo_url` → `cover_photo_url` → `image_url` → bee placeholder
- Venue pages restructured: **What's On above the fold**, gallery moved to a compact strip below with lightbox (click thumbnail → fullscreen + ESC/arrows)
- Festival landing pages have **dark theme + blurred hero image**

### Functionality
- **Multi-city**: navbar / footer auto-pick "Cities" link when multiple active, direct to single city when one
- **Festivals**: full landing pages with Venues / Artists / Schedule / Map tabs
- **Sponsored festival banner** on homepage when an active/upcoming festival is published
- **Artist signup wizard** at `/dashboard/setup` — claim existing or create new with dupe-check
- **Account deletion** — required by Apple; web is fixed at `/dashboard/account` ("Delete profile" button in Danger zone)
- **Tonight in <City>** sections on homepage — per-city, no mixing
- **Live activity widget** on `/admin` — page-view counts (1 min / 5 min / today) + hot venue + hot event in last 5 minutes
- **Event JSON-LD** now includes `endDate` (date-only fallback), `offers`, `organizer` — fixed Search Console warnings

---

## 6. Feature flags / toggles

| Flag | Type | Effect |
|---|---|---|
| `cities.active` | boolean | Hide entire city + 404 its URL when false. Toggle at `/admin/cities`. |
| `cities.nearby_areas` | text[] | Towns covered by city. Drives importer location filter and "Covering …" copy. |
| `festivals.published` | boolean | Festival page visibility |
| `festivals.preview_token` | text | When set, festival is accessible via `?preview=<token>` even if unpublished |
| `events.cancelled` | boolean | Hides from listings |
| `events.status` | enum | `approved` / `pending` / `rejected` |
| `venues.approved` | boolean | Hides from public listings if false |
| `venues.auto_imported` | boolean | Marks scraper-created venues, drives "Auto-imported" badge in admin |
| `venues.owner_id` | uuid nullable | NULL = unclaimed in directory |
| `artists.approved` | boolean | Hides from /artists if false |
| `artists.claimed_by` | uuid nullable | NULL = unclaimed (page exists but no user owns it) |

---

## 7. API endpoints worth wiring up

| Endpoint | Auth | Use case |
|---|---|---|
| `POST /api/account/delete` | Cookie OR `Authorization: Bearer <jwt>` | **Mobile-ready already**. Send the user's `access_token` from `supabase.auth.getSession()`. Body can include `{ confirmEmail }` for double-check. |
| `GET /api/cron/scrape-facebook` | Bearer with `CRON_SECRET` | Trigger FB cron manually (admin only — has buttons in `/admin/cron-runs`) |
| `GET /api/cron/dedupe-events` | Bearer with `CRON_SECRET` | Trigger dedupe manually |
| `GET /api/calendar/[id]` | Public | iCal feed per event — useful if mobile wants "Add to calendar" |
| `GET /api/search?q=...` | Public | Cross-entity search (venues + artists + events) |
| `GET /api/artists/search?q=...` | Public | Artist autocomplete |
| `POST /api/track` | Public, no auth | Page view tracking — call on every screen view to populate `page_views` |

---

## 8. Apple App Store blocker

Web side fixed. **iOS app still needs**:
- "Delete account" button somewhere (Settings is the standard spot)
- Confirmation dialog
- POST to `/api/account/delete` with `Authorization: Bearer <accessToken>` from `supabase.auth.getSession()`
- On success, sign the user out locally + show a confirmation screen

The web `/api/account/delete` route accepts both cookie auth (web) and Bearer JWT (mobile) — you don't need a separate endpoint.

Also outstanding: **demo password** in App Store Connect → App Review Information.

---

## 9. Things that may need backend work to unblock mobile

- **Push notifications**: no backend infra yet. If mobile wants pushes for "your gig was approved" / "new message", needs a `device_tokens` table + Expo push service integration.
- **Phone-number signup**: Supabase supports it, but trigger logic + form would need updating to handle no-email signup.
- **OAuth (Google/Apple)**: enable in Supabase dashboard, add provider config, add provider buttons to mobile (and ideally web). The `/auth/callback` route already handles OAuth-style code exchange.

---

_Generated from a live audit of the web codebase. Anything that was true at audit time but stops being true should be reflected back into this doc._
