-- Seed: Dundee Scoff — first paid sponsor on The Buzz Guide.
-- Run this AFTER applying sql/029_sponsors.sql.
--
-- image_url is intentionally left blank — log into /admin/sponsors and
-- upload the logo via the "Edit" button after this insert runs. (You can
-- also paste a hosted URL here if you'd rather skip the UI step.)

insert into public.sponsors (
  name,
  slug,
  tier,
  city_id,
  category,
  image_url,
  link_url,
  blurb,
  status,
  starts_at,
  ends_at,
  monthly_price
)
select
  'Dundee Scoff',
  'dundee-scoff',
  'popular',
  c.id,
  'takeaway',
  null,                                       -- upload via admin UI
  'https://dundeescoff.co.uk/',
  'Dundee Takeaways',                         -- editable in admin
  'active',
  now(),
  now() + interval '30 days',
  60.00
from public.cities c
where c.slug = 'dundee'
on conflict (slug) do nothing;
