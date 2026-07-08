# Mobile app sync — The Buzz Kids

Running contract between the **web** app (this repo) and the **Buzz Kids mobile app**
(`the-buzz-kids-app`). They share the same Supabase project, so backend/model changes
here must be reflected in the app. Web and app releases go out in pairs.

Add a dated entry at the top whenever a change lands that the app needs to know about.
Keep entries to what the app must **mirror** (feature parity) or **handle** (schema).

---

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
