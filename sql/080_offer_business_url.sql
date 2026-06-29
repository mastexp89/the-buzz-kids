-- ============================================================
-- The Buzz Kids: give offers two links.
--   url          -> "View the offer" (the page the deal is on / our source)
--   business_url -> the actual shop / restaurant / place website
-- Run once in Supabase SQL editor (after 077-079). Safe to re-run.
-- ============================================================

alter table public.offers
  add column if not exists business_url text;

-- Backfill the business website for the seeded deals (matched by provider).
update public.offers set business_url = 'https://www.asda.com/'                  where provider = 'Asda Cafe';
update public.offers set business_url = 'https://www.morrisons.com/'             where provider = 'Morrisons Cafe';
update public.offers set business_url = 'https://www.sainsburys.co.uk/'          where provider like 'Sainsbury%';
update public.offers set business_url = 'https://www.tesco.com/'                 where provider = 'Tesco Cafe';
update public.offers set business_url = 'https://www.sizzlingpubs.co.uk/'        where provider = 'Sizzling Pubs';
update public.offers set business_url = 'https://www.marstons.co.uk/'            where provider like 'Marston%';
update public.offers set business_url = 'https://www.pizzahut.co.uk/'            where provider like 'Pizza Hut%';
update public.offers set business_url = 'https://www.dobbies.com/'               where provider like 'Dobbies%';
update public.offers set business_url = 'https://www.scotrail.co.uk/'            where provider = 'ScotRail';
update public.offers set business_url = 'https://www.tesco.com/clubcard/'        where provider = 'Tesco Clubcard';
update public.offers set business_url = 'https://www.historicenvironment.scot/'  where provider = 'Historic Environment Scotland';
update public.offers set business_url = 'https://angusalive.scot/'               where provider = 'ANGUSalive';
update public.offers set business_url = 'https://www.fifeleisure.org.uk/'        where provider = 'Fife Sports & Leisure';
update public.offers set business_url = 'https://www.liveactive.co.uk/'          where provider = 'Live Active Leisure';

notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
