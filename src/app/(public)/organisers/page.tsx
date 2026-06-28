import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Event organisers — The Buzz Guide",
  description: "Promoters and event organisers on The Buzz Guide.",
};

export default async function OrganisersDirectoryPage() {
  const supabase = await createClient();
  const { data: organisers } = await supabase
    .from("organisers")
    .select("id, name, slug, bio, image_url")
    .eq("approved", true)
    .order("name");

  const list = organisers ?? [];

  return (
    <div className="container-page py-10 sm:py-14 max-w-5xl">
      <p className="eyebrow mb-2">Promoters & event runners</p>
      <h1 className="h-display text-4xl sm:text-5xl mb-3">Event organisers</h1>
      <p className="text-buzz-mute mb-8 max-w-2xl">
        Promoters and event organisers running gigs across the area. Click through
        for their upcoming events and links.
      </p>

      {list.length === 0 ? (
        <div className="card p-10 text-center text-buzz-mute">
          No organisers listed yet — check back soon.
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((o) => (
            <li key={o.id}>
              <Link
                href={`/organisers/${o.slug}`}
                className="card-hover p-4 flex gap-4 items-start lift h-full"
              >
                {o.image_url ? (
                  <div
                    className="w-16 h-16 rounded-xl bg-buzz-surface shrink-0"
                    style={{
                      backgroundImage: `url(${o.image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-buzz-surface border border-buzz-border grid place-items-center text-2xl shrink-0">
                    📋
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display text-lg uppercase truncate group-hover:text-buzz-accent transition">
                    {o.name}
                  </div>
                  {o.bio && (
                    <p className="text-xs text-buzz-mute line-clamp-2 mt-1">{o.bio}</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
