-- Per-festival contact email for the "Want to play? / Want to be
-- involved?" CTAs on the festival landing page. Previously hardcoded
-- to grouchosmusicbar@gmail.com because that's who the first festival
-- was for — wrong on every other festival.

ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS contact_email text;
