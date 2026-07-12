-- Public-transport reference data (NaPTAN, free open data) + each venue's
-- nearest bus stop and rail station. transport_stops is service-role only;
-- the venue pages read the pre-computed nearest_* columns, so no geo query at
-- display time. Run this in the Supabase SQL editor.

create table if not exists transport_stops (
  atco      text primary key,
  name      text not null,
  kind      text not null,            -- 'bus' | 'rail' | 'subway'
  locality  text,
  latitude  double precision not null,
  longitude double precision not null
);
create index if not exists transport_stops_bbox on transport_stops (latitude, longitude);
create index if not exists transport_stops_kind on transport_stops (kind);

alter table venues add column if not exists nearest_bus_stop      text;
alter table venues add column if not exists nearest_bus_stop_m     int;   -- metres
alter table venues add column if not exists nearest_rail_station   text;
alter table venues add column if not exists nearest_rail_station_m int;

alter table transport_stops enable row level security;
