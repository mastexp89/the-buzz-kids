-- 089: optional end date for offers/deals. Most deals are standing ("kids eat
-- free"), but some are time-boxed (a 7-day £1 swim). When set, the public
-- Deals/Food tabs hide the offer after this date; admin still sees it.
alter table public.offers add column if not exists ends_on date;

notify pgrst, 'reload schema';
