// Prints the top Tier events for the next N days (default 7) using the same scoring as the site.
// Usage: node scripts/top-picks.mjs [days] [count]
import { readFile } from "node:fs/promises";
import { createScorer, topPicks } from "../public/scoring.js";

const ROOT = new URL("../", import.meta.url);
const days = Number(process.argv[2] ?? 7);
const count = Number(process.argv[3] ?? 5);
const profile = JSON.parse(await readFile(new URL("public/profile.json", ROOT), "utf8"));
const { events } = JSON.parse(await readFile(new URL("public/events.json", ROOT), "utf8"));
const score = createScorer(profile);

const picks = topPicks(events.map((e) => ({ e, s: score(e) })), profile, { days, count });

const fmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" });
for (const [i, { e, s }] of picks.entries()) {
  const mi = s.km == null ? "online" : `${s.kmApprox ? "~" : ""}${(s.km * 0.621).toFixed(1)} mi`;
  console.log(`${i + 1}. [Tier ${s.tier} · ${Math.round(s.tierScore * 100)}] ${e.title}`);
  console.log(`   ${fmt.format(new Date(e.start))} · ${e.city ?? ""} · ${mi} from ${profile.home.label} · ${e.guests} going`);
  console.log(`   host ${Math.round(s.host * 100)} · venue ${Math.round(s.venue * 100)} · fit ${Math.round(s.relevance * 100)} · get-in ${Math.round(s.acceptance * 100)}`);
  console.log(`   ${s.reasons.join(" | ")}`);
  console.log(`   ${e.url}`);
}
