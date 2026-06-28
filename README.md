# The Buzz Guide

Live music in Dundee — and (eventually) the rest of Scotland.

A free directory where pubs, clubs and venues post their gig schedules so locals can
find live music tonight, this weekend and beyond. Filter by city, genre, and date.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS** — frontend
- **Supabase** — Postgres database, auth, file storage
- **Vercel** — hosting

All on free tiers to start. See `SETUP.md` for the click-by-click setup.

## Quick start (local)

```bash
npm install
cp .env.example .env.local        # fill in Supabase URL + anon key
npm run dev                       # → http://localhost:3000
```

## Project layout

```
src/
  app/
    page.tsx                          Home (city picker)
    (public)/                         Anonymous-browsable pages
      [city]/page.tsx                 City listings (e.g. /dundee)
      [city]/events/[id]/page.tsx     Event detail
      [city]/venues/[slug]/page.tsx   Venue profile
      about/page.tsx                  About
    (auth)/login, signup, check-email Auth pages
    auth/callback, signout            Auth route handlers
    dashboard/                        Venue portal (protected)
      page.tsx                        Overview + upcoming gigs
      venue/                          Manage venue profile
      events/new, events/[id]/edit    Add / edit gigs
    admin/                            Approve venues (admins only)
  components/
    Navbar, Footer, EventCard, VenueCard, EventFilters, ImageUploader, CitySwitcher
  lib/
    supabase/  client.ts, server.ts, middleware.ts
    types.ts, utils.ts, dateRange.ts
supabase/
  schema.sql                          Tables, triggers, RLS, seed
  storage.sql                         Storage bucket + policies
```

## Roles

- `user` — currently unused (browsing is anonymous, no signup needed).
- `venue_owner` — default for everyone who signs up. Can manage their own venue + gigs.
- `admin` — can approve venues and access `/admin`. Set this manually via SQL — see `SETUP.md`.

## Adding a new city

```sql
update public.cities set active = true where slug = 'glasgow';
```

That's it — venues can pick that city in the dropdown and the public site will route to `/glasgow`.

## Going to production

See `SETUP.md` § "Going live".
