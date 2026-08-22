// Buzz Winner Draw — read-only Graph API proxy for the giveaway draw tool
// (served at /draw.html). Ported from the handover's Pages-Router `api/fb.js`
// to the App Router; the logic is identical and it never writes to Facebook.
//
// Env vars (Vercel → Settings → Environment Variables):
//   FB_TOKEN_GUIDE   never-expiring Page token for The Buzz Guide
//   FB_TOKEN_KIDS    never-expiring Page token for Buzz Kids
//   FB_API_VERSION   optional, e.g. "v21.0" — bump to the current Graph version
//
// Page tokens stay server-side and are never returned to the browser.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VERSION = process.env.FB_API_VERSION || "v21.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const TOKENS: Record<string, string | undefined> = {
  guide: process.env.FB_TOKEN_GUIDE,
  kids: process.env.FB_TOKEN_KIDS,
};

async function gget(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  const j: any = await r.json();
  if (j.error) throw new Error(j.error.message || "Graph API error");
  return j;
}

// follow paging.next up to `cap` extra pages
async function pageAll(path: string, token: string, params: Record<string, string>, cap = 20) {
  let out: any[] = [];
  const first = await gget(path, token, params);
  out = out.concat(first.data || []);
  let next = first.paging && first.paging.next;
  let n = 0;
  while (next && n < cap) {
    const r = await fetch(next);
    const j: any = await r.json();
    if (j.error) break;
    out = out.concat(j.data || []);
    next = j.paging && j.paging.next;
    n++;
  }
  return out;
}

export async function GET(request: NextRequest) {
  try {
    // This endpoint spends OUR Page tokens and enumerates commenters, and it
    // lives on a public domain — so it's gated on an admin session rather than
    // left open. The draw page is same-origin, so the browser sends the session
    // cookie automatically; no change to the frontend was needed.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    let isAdmin = false;
    if (user) {
      const { data: prof } = await supabase
        .from("profiles").select("role").eq("id", user.id).maybeSingle();
      isAdmin = prof?.role === "admin";
    }
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Admins only — sign in at /login on this site first, then reload the draw page." },
        { status: 401 },
      );
    }

    const sp = new URL(request.url).searchParams;
    const page = (sp.get("page") || "guide").toString();
    const action = (sp.get("action") || "posts").toString();
    const postId = sp.get("postId");

    const token = TOKENS[page];
    if (!token) {
      return NextResponse.json(
        { error: `No token configured for page "${page}". Set FB_TOKEN_${page.toUpperCase()} in Vercel.` },
        { status: 400 },
      );
    }

    if (action === "posts") {
      const posts = await pageAll(
        "me/posts", token,
        { fields: "id,message,created_time,permalink_url", limit: "25" }, 1,
      );
      return NextResponse.json({
        posts: posts.map((p: any) => {
          const flat = (p.message || "(no text)").replace(/\s+/g, " ");
          return {
            id: p.id,
            message: flat.slice(0, 90),   // short label for the dropdown
            text: flat.slice(0, 400),     // more of it, so the tool can derive a title
            created_time: p.created_time,
            url: p.permalink_url,
          };
        }),
      });
    }

    if (action === "entrants") {
      if (!postId) return NextResponse.json({ error: "Missing postId." }, { status: 400 });

      // who reacted (liked / any reaction) to the post
      const reactions = await pageAll(`${postId}/reactions`, token, { fields: "id,name", limit: "100" });
      const reactorIds = new Set(reactions.map((r: any) => r.id).filter(Boolean));
      const reactorNames = new Set(
        reactions.map((r: any) => (r.name || "").toLowerCase()).filter(Boolean),
      );

      // Our own Page's replies are not entries. Ironically the Page is often the
      // ONLY identity Facebook returns (see the note below), so without this the
      // draw would be between us and nobody.
      let selfId: string | null = null;
      try {
        const me: any = await gget("me", token, { fields: "id" });
        selfId = me?.id ?? null;
      } catch { /* not fatal */ }

      // top-level comments = entrants
      const comments = await pageAll(
        `${postId}/comments`, token,
        { fields: "from,message,message_tags", filter: "stream", limit: "100" },
      );
      const map = new Map<string, any>();
      let hidden = 0;
      for (const c of comments) {
        const from = c.from || null;
        const id = from && from.id;
        const name = from && from.name;
        if (!name) { hidden++; continue; } // identity not available for this commenter
        if (selfId && id === selfId) continue; // the Page replying to its own post
        const key = id || name.toLowerCase();
        const tagged = Array.isArray(c.message_tags) && c.message_tags.length > 0;
        const liked = (id && reactorIds.has(id)) || reactorNames.has(name.toLowerCase());
        if (map.has(key)) {
          const e = map.get(key);
          e.tagged = e.tagged || tagged;
          e.liked = e.liked || liked;
        } else {
          map.set(key, { id: key, name, tagged, liked });
        }
      }
      const entrants = [...map.values()];
      // When Facebook withholds most identities the tool is not broken — the
      // app lacks advanced access (App Review + Business Verification) to read
      // who commented on a Page post. Say so, and point at the paste fallback,
      // rather than letting a "2 entrants" line look like a real entry count.
      const restricted = hidden > entrants.length;
      return NextResponse.json({
        entrants,
        restricted,
        note: restricted
          ? `Facebook returned identities for only ${entrants.length} of ${comments.length} comments — the rest are withheld. Reading commenters on a Page post needs advanced access (App Review + Business Verification); until then use "Paste comments".`
          : null,
        meta: { comments: comments.length, unique: entrants.length, reactors: reactorIds.size, hidden },
      });
    }

    return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: String((e && e.message) || e) }, { status: 500 });
  }
}
