-- Add website URLs to the seeded places so parents can check the details
-- themselves. Run once in the Supabase SQL editor.

update public.venues set website = 'https://www.dundeesciencecentre.org.uk'                                  where slug = 'dundee-science-centre';
update public.venues set website = 'https://www.vam.ac.uk/dundee'                                             where slug = 'va-dundee';
update public.venues set website = 'https://www.leisureandculturedundee.com/culture/camperdown-wildlife-centre' where slug = 'camperdown-wildlife-centre';
update public.venues set website = 'https://www.leisureandculturedundee.com/sport/olympia'                    where slug = 'olympia-leisure-centre';
update public.venues set website = 'https://www.liveactive.co.uk'                                             where slug = 'perth-leisure-pool';
update public.venues set website = 'https://scone-palace.co.uk'                                               where slug = 'scone-palace';
update public.venues set website = 'https://highlandsafaris.net'                                              where slug = 'highland-safaris';
