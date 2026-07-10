# Mobile app sync — The Buzz Kids

Running contract between the **web** app (this repo) and the **Buzz Kids mobile app**
(`the-buzz-kids-app`). They share the same Supabase project, so backend/model changes
here must be reflected in the app. Web and app releases go out in pairs.

Add a dated entry at the top whenever a change lands that the app needs to know about.
Keep entries to what the app must **mirror** (feature parity) or **handle** (schema).

---

## 2026-07-09 (later) — Scheduled aggregator importer (backend only)

New weekly cron pulls kids' events from regional "what's on" portals (Visit
Angus etc.) into the review queue. **No app change needed** — it just creates
normal pending `events` (reviewed → approved like any other) plus `new_place`
rows in `edit_suggestions`. Shared-schema note:

- **`events.auto_imported_from` CHECK now allows `'aggregator'`** (sql/091,
  added to the existing `manual_upload/facebook/instagram/website/email` set).
  If the app ever writes/reads that column, know the value exists.
- New service-role-only tables `aggregator_sources`, `aggregator_seen` (RLS
  on, no public policies) — app can ignore them.

## 2026-07-09 — Lucky wheel (web-only for now) + notify_signups gained opt-in columns

New web marketing feature: a spin-to-win email-capture wheel at `/win` (admin at
`/admin/wheel`). **App doesn't need to mirror it yet** — it's off by default and
nothing links to it publicly until Dylan activates it. Flagged here only for the
shared-schema change:

- **`notify_signups` now has `confirmed boolean default false`, `confirm_token
  uuid`, `confirmed_at timestamptz`** (sql/090). Additive + defaulted, so existing
  app writes to `notify_signups` are unaffected. If the app ever captures emails
  into this table, know that the wheel's draw only counts rows where
  `confirmed = true` (double opt-in via `/win/confirm?token=`).
- New service-role-only tables `wheel_config`, `wheel_prizes`, `wheel_spins`
  (RLS on, no public policies — all access is server-side). The app can ignore
  these unless we later build an in-app wheel, in which case it reuses them.

## 2026-07-08 (app reply) — reviews hidden, Deals merged, stay-teaser in; OTA-capable builds baking

App now mirrors both 2026-07-08 web entries: ReviewsSection unrendered +
review copy scrubbed (component dormant, matching web's disable-not-delete),
home tiles are Places / What's On / **Deals** (→ /offers, merged food-first
list with per-card category chips, `ends_on` null-or-future filter, "⏳ Until
X" chip) / **Places to stay — coming soon** (non-tappable teaser). Old
`?tab=` params are accepted-but-ignored aliases.

The `eas update:configure` artefacts are committed (deduped — the configure
run had doubled associatedDomains/intentFilters/permissions and re-added
RECORD_AUDIO; re-blocked). Production builds for BOTH platforms are running
now with all of the above + the inbox: these become the iOS resubmission and
the Play closed-test AAB, and are the first OTA-capable builds — from them
onward, JS-only changes ship via `eas update --branch production`.

## 2026-07-07 (app reply) — inbox built; broadcast pushes route there from build 7

App now has a real Messages screen (`app/inbox.tsx`): the user's `messages`
thread, unread admin rows marked read on open, and a composer (user replies via
the existing "user inserts own reply" RLS policy). Reachable from Account →
Messages. Signed-out users get a friendly sign-in state (covers anonymous
devices tapping an app-only broadcast).

`notificationToHref` now maps **both** `broadcast` and `admin_message` →
`/inbox` — web does NOT need to change the payload type back; keep sending
`type: "broadcast"`. Dead music-era mappings (`gig_submitted` → /manage)
removed; added generic `event` (eventId) and `venue`/`place` (venueSlug) types
for future deep-link pushes.

⚠ Applies from the **next app build (7+)** — build 6 (in review) still has the
old mapping, but the web's interim `broadcast` type means taps just open home
there. No action needed web-side.

## 2026-07-08 (later) — EAS Update configured; ONE more TestFlight build needed

Dylan's TestFlight build can't receive OTA updates: `updates.url` was never in
app.json and no update branch existed. The web session ran `eas update:configure`
(adds `updates.url` → u.expo.dev/9c645f30…, channel wiring in eas.json) — this
change is sitting UNCOMMITTED in the app working tree alongside the app
session's in-progress work; commit it together.

**Release path:** finish the pending sync items → `eas build --profile
production` → TestFlight. That build bakes OTA in. From then on, JS-only
changes ship with `eas update --branch production` — no store releases.
Until that build, nothing new reaches installed apps.

## 2026-07-08 (later) — on-site reviews RETIRED

Web removed the parent-reviews feature (Google ratings cover social proof):
ReviewsSection gone from place pages, review copy scrubbed from home/about/
signup, admin Reviews tile hidden. Components + `/admin/reviews` + the
`reviews` table stay dormant (disable-not-delete; existing rows kept).

**App: remove/hide all reviews UI (write + display) and ship as an EAS Update
(OTA)** — JS-only change, no store release needed (runtimeVersion/expo-updates
already configured). Keep bucket list untouched. If any review screens are
native-module-dependent (they shouldn't be), flag before assuming OTA works.

## 2026-07-08 — Deals tabs merged; Places to stay teased

Web changes the app should mirror on its home tiles + browse:
- **"Food deals" + "Days out" merged into one "Deals" tab/tile** (title
  "Deals", sub "Kids eat free · vouchers · money off tickets etc"). Web URL
  `?tab=food` is now an alias of `?tab=deals`. The offers query fetches BOTH
  categories (food first), each card chips its own category ("🍽️ Eating out" /
  "🎟️ Tickets & days out"). DB categories unchanged (`food` / `days-out`).
- **4th home tile is now "Places to stay" — coming soon** (🏡, non-clickable,
  "Coming soon" badge). Feature lands in the next few days.
- **`offers.ends_on` (sql/089, applied)** — optional end date. Public deals
  lists must filter `ends_on is null OR ends_on >= today` and can show an
  "⏳ Until X" chip. Convert-to-deal carries an event's `end_date` across.

## 2026-07-07 (later) — broadcast pushes: payload type changed to avoid dead route

Tapping an admin broadcast push opened the app's 404 ("screen doesn't exist"):
the app maps `data.type === "admin_message"` → `/inbox`, but the kids app has
no inbox screen (music-era leftover in `lib/push.ts`).

- **Web now sends `data: { type: "broadcast" }`** for all admin message/broadcast
  pushes (unmapped in the app → tap just opens the app at home). Interim fix, no
  app rebuild needed.
- **App to-do:** either build an inbox/messages screen and map `broadcast` (and
  `admin_message`) to it, or explicitly map both to `/` — then tell web to switch
  back to a routed type.
- Web also gained an **app-only broadcast mode** (`/admin/messages/broadcast` →
  "App push only"): pushes to every device incl. anonymous, no inbox rows/emails.
  Push titles now default to "The Buzz Kids" (was "The Buzz Guide").

## 2026-07-07 — app caught up; two web endpoints wanted

App now mirrors: multi-area What's On (client-side filtering with `end_date`
overlap + `recurrence_pattern` occurrence logic ported from WhatsOnView),
WeatherStrip (Open-Meteo, per-area venue-coord centroid, hidden on
"everywhere") on What's On + Places, offer brand logos (icon.horse → Google
favicon), house-ad exclusion, standalone events, direct `edit_suggestions`
writes (anon INSERT policy applied 2026-07-03 as app migration 088) + DB
trigger `notify_edit_suggestion` → Resend → hello@.

Sponsor clicks from the app go through `GET /api/sponsor-click/{id}` (counted).
Sister-link taps post `click_buzzguide` with `source=app_about`.

**Web-side wishlist to fully close the loop:**
- An impressions endpoint the app can call (`increment_sponsor_impression` RPC
  is service-role only) — app ad views are currently uncounted.
- A mobile page-view endpoint (POST /api/track only accepts click kinds;
  page views are recorded during SSR, which the app never hits). App screen
  views are currently untracked — `trackScreen()` in the app is a no-op stub
  waiting on this.

## 2026-07-03 — accounts-lite, edit suggestions, offers & sponsors

Migrations already applied to the shared DB (`sql/085`, `086`, `087`). The app just
needs to be aware of the schema + model.

### 1. Accounts model changed — business self-service is RETIRED
- No more venue-owner / organiser signup, claim flow, or owner dashboards.
- **Parent/fan accounts are KEPT** (bucket list, reviews, alerts) — leave those as-is.
- Replaced with a **suggest-an-edit / lead** model. App should mirror:
  - A **"Suggest an edit"** action on every place and event: reason + free text +
    optional contact + an "I run this place/activity" toggle.
  - **"List your activity"** = a simple *tell-us-about-your-place* lead form,
    **not** an account signup.
  - Both write to the new `edit_suggestions` table.

### 2. New table: `edit_suggestions`
| column | notes |
| --- | --- |
| `target_type` | `'venue'` \| `'event'` \| `'new_place'` |
| `target_id` | uuid; null for `new_place` |
| `target_name` | denormalised label for the admin list |
| `city_slug` | optional |
| `reason` | short category (Closed / Wrong details / …) |
| `details` | free-text correction / message |
| `contact_name`, `contact_email` | optional |
| `is_owner` | bool — "runs this place" |
| `status` | `'new'` \| `'reviewed'` \| `'done'` (default `new`) |
| `image_url` | optional poster/photo attached to the suggestion |
| `created_at` | timestamptz |

Writes go through the service role server-side (anon can submit; no insert RLS policy).
Staff (`admin`/`editor`) can read.

### 3. Offers/deals: `image_url` + `venue_id`
- `offers.image_url` (uploaded poster) and `offers.venue_id` (attach a deal to a place) exist.
- **Auto brand logos:** when a deal has no `image_url`, derive the brand logo from its
  `business_url` domain: `https://icon.horse/icon/{domain}` with fallback
  `https://www.google.com/s2/favicons?domain={domain}&sz=128`. Mirror this so deal cards
  aren't blank. An uploaded `image_url` always wins.

### 4. Events can be standalone (no venue)
- Events may have `venue_id = null` with `city_id` + `location_name` set (townwide / gala
  events). **Event views must handle no-venue events** — fall back to `location_name` /
  city for the location; don't assume a venue is present.

### 5. Sponsors / ads — "house ad" convention
- If the app renders the `sponsors` table: show up to 4 active `popular`/`premium`
  sponsors, premium weighted 2×.
- There's a **house ad** row (slug `advertise-with-us`) whose `link_url` is a
  mailto/advertise URL. Web renders it as an "Advertise here → Get prices" CTA card, not a
  brand logo. The app should render it as a CTA **or** skip it — never show it as a fake
  brand sponsor.

### 6. Submissions email the admin (server-side)
- Place, edit, and deal submissions all email `hello@thebuzzkids.co.uk` via Resend.
- If the app calls its own endpoints (instead of the shared server actions), make sure
  those notify too.
