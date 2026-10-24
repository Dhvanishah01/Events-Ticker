// Loads the static events + profile, scores each event in the browser, renders the ranked list.
const SHOW_TOP = 60;
const STORE_KEY = "events-ticker:controls";

const [data, profile] = await Promise.all([
  fetch("events.json").then((r) => r.json()),
  fetch("profile.json").then((r) => r.json()),
]);

const $ = (id) => document.getElementById(id);
const els = {
  q: $("q"), wMatch: $("wMatch"), wReach: $("wReach"), wDistance: $("wDistance"),
  maxKm: $("maxKm"), freeOnly: $("freeOnly"), matchOnly: $("matchOnly"),
};

const defaults = {
  q: "", wMatch: profile.weights.match, wReach: profile.weights.reach,
  wDistance: profile.weights.distance, maxKm: profile.maxDistanceKm,
  freeOnly: false, matchOnly: false,
};
let saved = {};
try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) ?? {}; } catch {}
const state = { ...defaults, ...saved };

for (const [key, el] of Object.entries(els)) {
  if (el.type === "checkbox") el.checked = state[key];
  else el.value = state[key];
  el.addEventListener("input", () => {
    state[key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
    render();
  });
}

const interestRes = profile.interests.map(({ term, weight }) => ({
  // Whole word, allowing a plural "s": "agent" matches "agents" but "product" skips "production".
  term, weight, re: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i"),
}));
const maxInterest = interestRes.reduce((s, i) => s + i.weight, 0) / 3;
const maxGuestsLog = Math.log10(Math.max(...data.events.map((e) => e.guests), 1) + 1);

function distanceKm(lat, lon) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat - profile.home.lat), dLon = toRad(lon - profile.home.lon);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(profile.home.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function score(e) {
  const text = [e.title, e.calendar, ...e.hosts].filter(Boolean).join(" ");
  const hits = interestRes.filter((i) => i.re.test(text));
  const match = Math.min(1, hits.reduce((s, i) => s + i.weight, 0) / maxInterest);
  const reach = Math.log10(e.guests + 1) / maxGuestsLog;
  const km = e.lat != null ? distanceKm(e.lat, e.lon) : null;
  const distance = e.online ? 0.5 : km == null ? 0.3 : Math.max(0, 1 - km / state.maxKm);
  const wSum = state.wMatch + state.wReach + state.wDistance || 1;
  const total = (match * state.wMatch + reach * state.wReach + distance * state.wDistance) / wSum;
  return { total, match, reach, distance, km, hits: hits.map((h) => h.term) };
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function render() {
  for (const k of ["wMatch", "wReach", "wDistance"]) $(`${k}V`).textContent = state[k];
  $("maxKmV").textContent = `${state.maxKm} km`;

  const q = state.q.trim().toLowerCase();
  const now = Date.now();
  const ranked = data.events
    .filter((e) => Date.parse(e.end ?? e.start) >= now)
    .filter((e) => !state.freeOnly || e.free)
    .filter((e) => !q || [e.title, e.calendar, e.city, ...e.hosts].join(" ").toLowerCase().includes(q))
    .map((e) => ({ e, s: score(e) }))
    .filter(({ e, s }) => e.online || s.km == null || s.km <= state.maxKm)
    .filter(({ s }) => !state.matchOnly || s.hits.length > 0)
    .sort((a, b) => b.s.total - a.s.total)
    .slice(0, SHOW_TOP);

  $("list").innerHTML = ranked.length ? ranked.map(({ e, s }) => `
    <li class="card">
      <div class="score" title="Overall score">${Math.round(s.total * 100)}</div>
      <div>
        <h2><a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a></h2>
        <p class="muted">${dateFmt.format(new Date(e.start))} · ${escapeHtml(e.online ? "Online" : e.city ?? "Location TBA")}${s.km != null ? ` · ${s.km.toFixed(1)} km` : ""} · ${e.guests} going${e.free === false ? " · Paid" : ""}</p>
        ${e.calendar || e.hosts.length ? `<p class="muted">${escapeHtml([e.calendar, e.hosts.slice(0, 3).join(", ")].filter(Boolean).join(" · "))}</p>` : ""}
        <div class="chips">
          <span class="chip ${s.hits.length ? "hit" : ""}">Match ${Math.round(s.match * 100)}</span>
          <span class="chip">Reach ${Math.round(s.reach * 100)}</span>
          <span class="chip">Distance ${Math.round(s.distance * 100)}</span>
          ${s.hits.map((h) => `<span class="chip hit">${escapeHtml(h)}</span>`).join("")}
        </div>
      </div>
    </li>`).join("") : `<li class="empty">No events match these filters.</li>`;
}

$("meta").textContent =
  `${data.count} upcoming Luma events near ${profile.home.label} · updated ${new Date(data.fetchedAt).toLocaleString()}`;
$("export").addEventListener("click", () => window.print());
render();
