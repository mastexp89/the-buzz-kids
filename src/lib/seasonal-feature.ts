// The homepage's seasonal feature band. Picks itself from the calendar so it
// never goes stale — no one has to remember to swap it. Images are design
// assets from the homepage photo pack (illustrative, never tied to a venue).

export type SeasonalFeature = {
  eyebrow: string;
  headline: [string, string];
  body: string;
  cta: string;
  href: string;
  image: string;
  blob: [string, string];
  ideas: { t: string; s: string; img: string }[];
};

const EVENTS = "/browse?tab=events";

const CHRISTMAS: SeasonalFeature = {
  eyebrow: "This Christmas",
  headline: ["Santa, pantos &", "festive fun."],
  body: "From Santa's grottos and pantos to lights trails and fireworks, find the best family days out across Scotland this Christmas.",
  cta: "Explore Christmas ideas",
  href: EVENTS,
  image: "/images/bonus-christmas.webp",
  blob: ["FESTIVE FUN", "THIS MONTH"],
  ideas: [
    { t: "Santa's grottos", s: "Meet the big man", img: "/images/bonus-christmas.webp" },
    { t: "Pantos & shows", s: "Oh no it isn't!", img: "/images/bonus-shows.webp" },
    { t: "Lights & fireworks", s: "Sparkly nights out", img: "/images/bonus-fireworks.webp" },
  ],
};

const HALLOWEEN: SeasonalFeature = {
  eyebrow: "This October",
  headline: ["Spooky season &", "half-term fun."],
  body: "From Halloween trails and pumpkin patches to October-week holiday clubs, find the best family days out across Scotland this month.",
  cta: "Explore October ideas",
  href: EVENTS,
  image: "/images/bonus-halloween.webp",
  blob: ["FAMILY FUN", "THIS MONTH"],
  ideas: [
    { t: "Halloween trails", s: "Spooky family fun", img: "/images/bonus-halloween.webp" },
    { t: "Autumn walks", s: "Crisp days outdoors", img: "/images/bonus-outdoor-walks.webp" },
    { t: "Cosy indoor play", s: "Rainy-day rescue", img: "/images/bonus-indoor-play.webp" },
  ],
};

const SPRING: SeasonalFeature = {
  eyebrow: "This spring",
  headline: ["Brighter days,", "bigger adventures."],
  body: "From Easter egg trails to farm visits and the first picnic days, find the best family-friendly things to do across Scotland this season.",
  cta: "Explore spring ideas",
  href: EVENTS,
  image: "/images/bonus-spring-easter.webp",
  blob: ["FAMILY FUN", "THIS SPRING"],
  ideas: [
    { t: "Easter egg trails", s: "Across Scotland", img: "/images/bonus-spring-easter.webp" },
    { t: "Animal days out", s: "Farms & zoos", img: "/images/bonus-animals-and-zoos.webp" },
    { t: "Woodland walks", s: "Beautiful places", img: "/images/bonus-outdoor-walks.webp" },
  ],
};

const SUMMER: SeasonalFeature = {
  eyebrow: "This summer",
  headline: ["Long days,", "big adventures."],
  body: "Beaches, adventure parks and holiday clubs — find the best family days out across Scotland these summer holidays.",
  cta: "Explore summer ideas",
  href: EVENTS,
  image: "/images/bonus-beaches.webp",
  blob: ["SUMMER", "HOLIDAYS"],
  ideas: [
    { t: "Beach days", s: "Sandcastles & paddles", img: "/images/bonus-beaches.webp" },
    { t: "Adventure parks", s: "Zip lines & ropes", img: "/images/bonus-adventure-parks.webp" },
    { t: "Wildlife parks", s: "Meet the animals", img: "/images/bonus-animals-and-zoos.webp" },
  ],
};

const WINTER: SeasonalFeature = {
  eyebrow: "This winter",
  headline: ["Cosy days,", "indoor adventures."],
  body: "Soft play, trampoline parks, aquariums and shows — the best rainy-day family days out across Scotland this winter.",
  cta: "Explore winter ideas",
  href: EVENTS,
  image: "/images/bonus-indoor-play.webp",
  blob: ["RAINY DAY", "RESCUE"],
  ideas: [
    { t: "Soft play", s: "Burn off energy", img: "/images/bonus-indoor-play.webp" },
    { t: "Trampoline parks", s: "Bounce it out", img: "/images/bonus-trampolines.webp" },
    { t: "Aquariums", s: "Under the sea", img: "/images/bonus-aquariums.webp" },
  ],
};

const AUTUMN: SeasonalFeature = {
  eyebrow: "This autumn",
  headline: ["Crunchy leaves,", "cosy days out."],
  body: "Woodland walks, farm days and indoor fun for when the weather turns — find the best family days out across Scotland this autumn.",
  cta: "Explore autumn ideas",
  href: EVENTS,
  image: "/images/bonus-outdoor-walks.webp",
  blob: ["AUTUMN", "ADVENTURES"],
  ideas: [
    { t: "Woodland walks", s: "Crisp days outdoors", img: "/images/bonus-outdoor-walks.webp" },
    { t: "Animal days out", s: "Farms & zoos", img: "/images/bonus-animals-and-zoos.webp" },
    { t: "Cosy indoor play", s: "Rainy-day rescue", img: "/images/bonus-indoor-play.webp" },
  ],
};

/** Feature for a given date (UK months): Nov–Dec Christmas, Oct Halloween,
 *  Mar–Apr spring, May–Aug summer, Sep autumn, Jan–Feb winter. */
export function seasonalFeature(now: Date = new Date()): SeasonalFeature {
  const m = Number(now.toLocaleDateString("en-GB", { month: "numeric", timeZone: "Europe/London" }));
  if (m === 11 || m === 12) return CHRISTMAS;
  if (m === 10) return HALLOWEEN;
  if (m === 3 || m === 4) return SPRING;
  if (m >= 5 && m <= 8) return SUMMER;
  if (m === 9) return AUTUMN;
  return WINTER;
}
