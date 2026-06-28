export type City = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  created_at: string;
};

export type Genre = {
  id: string;
  name: string;
  slug: string;
};

export type Profile = {
  id: string;
  email: string | null;
  display_name: string | null;
  role: "user" | "venue_owner" | "admin";
  created_at: string;
};

export type Venue = {
  id: string;
  owner_id: string;
  city_id: string;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
  image_url: string | null;
  logo_url: string | null;
  cover_photo_url: string | null;
  gallery_image_urls: string[];
  opening_hours: string | null;
  opening_hours_json: Record<string, { closed?: boolean; open?: string; close?: string }> | null;
  latitude: number | null;
  longitude: number | null;
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  tiktok: string | null;
  spotify: string | null;
  youtube: string | null;
  spotlight_until: string | null;
  approved: boolean;
  created_at: string;
  updated_at: string;
};

export type Event = {
  id: string;
  venue_id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string | null;
  cover_charge: string | null;
  ticket_url: string | null;
  image_url: string | null;
  cancelled: boolean;
  featured_until: string | null;
  highlighted_until: string | null;
  genre_takeover_until: string | null;
  weekend_boost_until: string | null;
  created_at: string;
  updated_at: string;
};

export type Artist = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  image_url: string | null;
  website: string | null;
  instagram: string | null;
  twitter: string | null;
  facebook: string | null;
  spotify: string | null;
  bandcamp: string | null;
  youtube: string | null;
  city_id: string | null;
  claimed_by: string | null;
  approved: boolean;
  created_at: string;
  updated_at: string;
};

export type EventWithVenue = Event & {
  venue: Venue & { city: City };
  genres: Genre[];
  artists?: Artist[];
};

export type Organiser = {
  id: string;
  name: string;
  slug: string;
  bio: string | null;
  image_url: string | null;
  website: string | null;
  instagram: string | null;
  facebook: string | null;
  twitter: string | null;
  tiktok: string | null;
  spotify: string | null;
  bandcamp: string | null;
  youtube: string | null;
  email: string | null;
  claimed_by: string | null;
  approved: boolean;
  created_at: string;
  updated_at: string;
};
