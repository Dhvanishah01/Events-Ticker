// Pulls upcoming events from Luma's public Discover feed and writes public/events.json.
// Same endpoint the luma-mcp server uses (api.lu.ma, no API key). It is undocumented,
// so on any failure we exit non-zero and leave the previous events.json untouched.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const HEADERS = {
  accept: "application/json",
  origin: "https://lu.ma",
  referer: "https://lu.ma/",
};

const profile = JSON.parse(await readFile(new URL("public/profile.json", ROOT), "utf8"));
const now = Date.now();
const until = now + profile.daysAhead * 24 * 60 * 60 * 1000;

async function fetchCategory(categoryId) {
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      discover_category_api_id: categoryId,
      latitude: String(profile.home.lat),
      longitude: String(profile.home.lon),
      pagination_limit: String(PAGE_SIZE),
    });
    if (cursor) params.set("pagination_cursor", cursor);

    const res = await fetch(`https://api.lu.ma/discover/get-paginated-events?${params}`, { headers: HEADERS });
    if (!res.ok) throw new Error(`Luma ${categoryId} page ${page}: HTTP ${res.status}`);
    const data = await res.json();

    let pastWindow = false;
    for (const entry of data.entries ?? []) {
      const ev = toEvent(entry, categoryId);
      if (!ev) continue;
      if (Date.parse(ev.start) > until) { pastWindow = true; break; }
      out.push(ev);
    }
    if (pastWindow || !data.has_more || !data.next_cursor) break;
    cursor = data.next_cursor;
  }
  return out;
}

function toEvent(entry, categoryId) {
  const ev = entry.event;
  if (!ev?.api_id || !ev.start_at) return null;
  const geo = ev.geo_address_info ?? {};
  return {
    id: ev.api_id,
    title: ev.name ?? "",
    url: `https://lu.ma/${ev.url}`,
    start: ev.start_at,
    end: ev.end_at ?? null,
    timezone: ev.timezone ?? null,
    online: ev.location_type === "online",
    city: geo.city ?? null,
    address: geo.address ?? geo.description ?? null,
    lat: ev.coordinate?.latitude ?? null,
    lon: ev.coordinate?.longitude ?? null,
    guests: entry.guest_count ?? 0,
    calendar: entry.calendar?.is_personal ? null : entry.calendar?.name ?? null,
    hosts: (entry.hosts ?? []).map((h) => h.name).filter(Boolean),
    free: entry.ticket_info?.is_free ?? null,
    cover: ev.cover_url ?? null,
    categories: [categoryId],
  };
}

const byId = new Map();
for (const categoryId of profile.categories) {
  for (const ev of await fetchCategory(categoryId)) {
    const seen = byId.get(ev.id);
    if (seen) seen.categories.push(categoryId);
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
