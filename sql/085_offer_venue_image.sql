-- Offers can be attached to a specific place, and carry a poster image.
alter table offers add column if not exists venue_id uuid references venues(id) on delete set null;
alter table offers add column if not exists image_url text;

create index if not exists offers_venue_id_idx on offers(venue_id);
