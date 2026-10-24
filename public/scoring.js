// Tier scoring shared by the browser (app.js) and scripts/top-picks.mjs.
// Every event is judged against the job-search goal in profile.json:
//   tierScore = acceptance × (host 35% + venue 25% + relevance 40%), lightly discounted by distance.

const DAY = 24 * 60 * 60 * 1000;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (term, prefix = false) => new RegExp(`\\b${escapeRe(term)}${prefix ? "" : "s?\\b"}`, "i");

export function createScorer(profile) {
  const interests = profile.interests.map((i) => ({ ...i, re: wordRe(i.term, i.prefix) }));
  const tierA = profile.hosts.tierA.map((n) => ({ name: n, re: wordRe(n) }));
  const tierB = profile.hosts.tierB.map((n) => ({ name: n, re: wordRe(n) }));
  const greatVenues = profile.venues.great.map((n) => ({ name: n, re: wordRe(n) }));
  const goodVenues = profile.venues.good.map((n) => ({ name: n, re: wordRe(n) }));
  // Whole-word match: a plain substring check let "cto" hit "October" and "Director".
  const hardPhrases = profile.hardToGetInto.map((p) => wordRe(p.trim()));
  const avoid = (profile.avoid ?? []).map((t) => wordRe(t));

  function distanceKm(lat, lon) {
    const R = 6371, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat - profile.home.lat), dLon = rad(lon - profile.home.lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(profile.home.lat)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function relevanceOf(e) {
    // Host bios are left out: nearly every bio says "founder" or "product", which drowned out real fit.
    const text = [e.title, e.calendar, ...e.hosts.map((h) => h.name)].filter(Boolean).join(" ");
    const hits = interests.filter((i) => i.re.test(text));
    const offTopic = avoid.some((re) => re.test(text));
    const relevance = Math.min(1, hits.reduce((s, i) => s + i.weight, 0) / 6) * (offTopic ? 0.4 : 1);
    return { relevance, hits: hits.map((h) => h.term), offTopic };
  }

  function hostOf(e) {
    const names = [e.calendar, ...e.hosts.map((h) => h.name)].filter(Boolean);
    const a = tierA.find((t) => names.some((n) => t.re.test(n)));
    if (a) return { host: 1, reason: `Host: ${a.name} (target org)` };
    const b = tierB.find((t) => names.some((n) => t.re.test(n)));
    if (b) return { host: 0.75, reason: `Host: ${b.name} (notable org)` };
    let host = e.calendar ? 0.3 : 0.15;
    if (e.calendarVerified) host += 0.2;
    if (e.hosts.some((h) => h.verified)) host += 0.15;
    host += 0.2 * Math.min(1, Math.log10(e.guests + 1) / 2.5); // established hosts draw crowds
    return { host: Math.min(host, 0.7), reason: e.calendar ? `Host: ${e.calendar}` : null };
  }

  function venueOf(e) {
    if (e.online) return { venue: 0.1, reason: "Online" };
    if (e.venueHidden) return { venue: 0.45, reason: "Venue revealed after approval" };
    const addr = e.address ?? "";
    const great = greatVenues.find((v) => v.re.test(addr));
    if (great) return { venue: 1, reason: `Venue: ${great.name}` };
    const orgNames = [e.calendar, ...e.hosts.map((h) => h.name)].filter(Boolean);
    if (addr && orgNames.some((n) => n.length > 2 && addr.toLowerCase().includes(n.toLowerCase())))
      return { venue: 0.85, reason: `Venue: ${addr} (host's own space)` };
    const good = goodVenues.find((v) => v.re.test(addr));
    if (good) return { venue: 0.6, reason: `Venue: ${addr}` };
    return { venue: addr && !/^\d/.test(addr) ? 0.45 : 0.3, reason: addr ? `Venue: ${addr}` : null };
  }

  function acceptanceOf(e, relevance) {
    const exclusive = hardPhrases.some((re) => re.test(e.title));
    if (e.soldOut && !e.waitlist) return { acceptance: 0.05, reason: "Sold out" };
    if (e.waitlist) return { acceptance: 0.3, reason: "Waitlist only" };
    if (e.requireApproval) {
      if (exclusive) return { acceptance: 0.2, reason: "Approval + exclusive audience" };
      const acceptance = 0.55 + 0.35 * relevance;
      return { acceptance, reason: `Approval required (${acceptance >= 0.75 ? "strong" : "fair"} fit)` };
    }
    if (exclusive) return { acceptance: 0.5, reason: "Open, but aimed at a narrow audience" };
    if (e.nearCapacity) return { acceptance: 0.85, reason: "Open, filling up" };
    return { acceptance: 0.95, reason: "Open registration" };
  }

  return function score(e, { maxKm = profile.maxDistanceKm } = {}) {
    const { relevance, hits, offTopic } = relevanceOf(e);
    const h = hostOf(e), v = venueOf(e), a = acceptanceOf(e, relevance);
    const km = e.lat != null && !e.online ? distanceKm(e.lat, e.lon) : null;
    const distancePenalty = km == null ? 0 : 0.15 * Math.min(1, km / maxKm);
    const base = 0.35 * h.host + 0.25 * v.venue + 0.4 * relevance;
    const tierScore = a.acceptance * base * (1 - distancePenalty);
    const tier = tierScore >= 0.45 ? 1 : tierScore >= 0.28 ? 2 : 3;
    return {
      tierScore, tier, km, kmApprox: e.venueHidden, offTopic,
      host: h.host, venue: v.venue, relevance, acceptance: a.acceptance, hits,
      reasons: [h.reason, v.reason, a.reason, hits.length ? `Matches: ${hits.join(", ")}` : null, offTopic ? "Off-topic for your search" : null].filter(Boolean),
    };
  };
}

export function inNextDays(e, days, now = Date.now()) {
  const start = Date.parse(e.start);
  return Date.parse(e.end ?? e.start) >= now && start <= now + days * DAY;
}

// Top picks shared by the site and scripts/top-picks.mjs: skip long shots and off-topic events.
export function topPicks(scored, profile, { days = 7, count = 5, now = Date.now() } = {}) {
  return scored
    .filter(({ e }) => inNextDays(e, days, now))
    .filter(({ s }) => s.acceptance >= 0.35 && !s.offTopic)
    .filter(({ s }) => s.km == null || s.km <= profile.maxDistanceKm)
    .sort((a, b) => b.s.tierScore - a.s.tierScore)
    .slice(0, count);
}
