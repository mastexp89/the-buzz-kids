-- 070_perth_perthshire.sql  (The Buzz Kids)
-- Make Perth & Perthshire a live location. Perth ships as an inactive
-- "coming soon" city in schema.sql; here we activate it, widen it to the
-- whole shire, and list the towns it covers (like Angus / Fife do).

update public.cities
set name = 'Perth & Perthshire',
    active = true,
    nearby_areas = '{Crieff,Pitlochry,Blairgowrie,Aberfeldy,Auchterarder,Dunkeld,Scone,Kinross,"Coupar Angus"}'
where slug = 'perth';

-- Safety net if the seed row was ever removed.
insert into public.cities (name, slug, active, nearby_areas)
select 'Perth & Perthshire', 'perth', true,
       '{Crieff,Pitlochry,Blairgowrie,Aberfeldy,Auchterarder,Dunkeld,Scone,Kinross,"Coupar Angus"}'
where not exists (select 1 from public.cities where slug = 'perth');
