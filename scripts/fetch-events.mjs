// Pulls upcoming events from Luma's public Discover feed and writes public/events.json.
// Same endpoint the luma-mcp server uses (api.lu.ma, no API key). It is undocumented,
// so on any failure we exit non-zero and leave the previous events.json untouched.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const PAGE_SIZE = 50;
const MAX_PAGES = 8;
const HEADERS = {
  accept: "application/json",
  origin: "https://lu.ma",
  referer: "https://lu.ma/",
};

const profile = JSON.parse(await readFile(new URL("public/profile.json", ROOT), "utf8"));
const now = Date.now();
const until = now + profile.daysAhead * 24 * 60 * 60 * 1000;

// feed is { category } (centred on home) or { place } (Luma's city feed).
async function fetchFeed(feed) {
  const label = feed.category ?? feed.place;
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ pagination_limit: String(PAGE_SIZE) });
    if (feed.category) {
      params.set("discover_category_api_id", feed.category);
      params.set("latitude", String(profile.home.lat));
      params.set("longitude", String(profile.home.lon));
    } else {
      params.set("discover_place_api_id", feed.place);
    }
    if (cursor) params.set("pagination_cursor", cursor);

    const res = await fetch(`https://api.lu.ma/discover/get-paginated-events?${params}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Luma ${label} page ${page}: HTTP ${res.status}`);
    const data = await res.json();

    let pastWindow = false;
    for (const entry of data.entries ?? []) {
      const ev = toEvent(entry, label);
      if (!ev) continue;
      if (Date.parse(ev.start) > until) { pastWindow = true; break; }
      out.push(ev);
    }
    if (pastWindow || !data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

function toEvent(entry, feedLabel) {
  const ev = entry.event;
  if (!ev?.api_id || !ev.start_at) return null;
  const geo = ev.geo_address_info ?? {};
  const ticket = entry.ticket_info ?? {};
  const calendar = entry.calendar ?? {};
  return {
    id: ev.api_id,
    title: ev.name ?? "",
    url: `https://lu.ma/${ev.url}`,
    start: ev.start_at,
    end: ev.end_at ?? null,
    timezone: ev.timezone ?? null,
    online: ev.location_type === "online",
    city: geo.city ?? null,
    // Approval-only events hide the exact venue ("obfuscated") until you are accepted.
    venueHidden: geo.mode === "obfuscated",
    address: geo.address ?? geo.description ?? null,
    lat: ev.coordinate?.latitude ?? null,
    lon: ev.coordinate?.longitude ?? null,
    guests: entry.guest_count ?? 0,
    calendar: calendar.is_personal ? null : calendar.name ?? null,
    calendarVerified: Boolean(calendar.is_verified),
    hosts: (entry.hosts ?? []).map((h) => ({ name: h.name, verified: Boolean(h.is_verified), bio: h.bio_short ?? null })).filter((h) => h.name),
    free: ticket.is_free ?? null,
    requireApproval: Boolean(ticket.require_approval),
    soldOut: Boolean(ticket.is_sold_out) || entry.registration_availability === "sold-out",
    waitlist: Boolean(entry.waitlist_active) || entry.registration_availability === "waitlist",
    nearCapacity: Boolean(ticket.is_near_capacity),
    spotsRemaining: ticket.spots_remaining ?? null,
    cover: ev.cover_url ?? null,
    feeds: [feedLabel],
  };
}

const feeds = [
  ...profile.categories.map((category) => ({ category })),
  ...(profile.places ?? []).map((place) => ({ place })),
];
const byId = new Map();
for (const feed of feeds) {
  for (const ev of await fetchFeed(feed)) {
    const seen = byId.get(ev.id);
    if (seen) seen.feeds.push(...ev.feeds);
    else byId.set(ev.id, ev);
  }
}

const events = [...byId.values()]
  .filter((e) => Date.parse(e.end ?? e.start) >= now)
  .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));

if (events.length === 0) throw new Error("Luma returned no events; keeping the previous events.json");

await writeFile(
  new URL("public/events.json", ROOT),
  JSON.stringify({ fetchedAt: new Date().toISOString(), count: events.length, events }, null, 1) + "\n",
);
console.log(`Wrote ${events.length} events`);
