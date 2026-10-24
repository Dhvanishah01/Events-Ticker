// Loads the static events + profile, scores each event (scoring.js), and renders the goal tracker,
// the 3 weekly slots, this week's top 5 and the full ranked list.
import { createScorer, inNextDays, topPicks } from "./scoring.js";

const TOP_COUNT = 5;
const LIST_LIMIT = 80;
const KM_PER_MI = 1.609;
const CONTROLS_KEY = "events-ticker:controls:v2";
const PLANNED_KEY = "events-ticker:planned";
const DAY = 24 * 60 * 60 * 1000;

const [data, profile] = await Promise.all([
  fetch("events.json").then((r) => r.json()),
  fetch("profile.json").then((r) => r.json()),
]);
const score = createScorer(profile);

const $ = (id) => document.getElementById(id);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// ---- controls ----
const els = {
  q: $("q"), tier: $("tier"), days: $("days"), maxMi: $("maxMi"),
  freeOnly: $("freeOnly"), hideLongShots: $("hideLongShots"), hideOffTopic: $("hideOffTopic"),
};
const defaults = {
  q: "", tier: "all", days: "7", maxMi: Math.round(profile.maxDistanceKm / KM_PER_MI),
  freeOnly: false, hideLongShots: true, hideOffTopic: true,
};
const state = { ...defaults, ...load(CONTROLS_KEY, {}) };
// Plans keep a copy of the event: the daily refresh drops past events, and this week's count must not shrink.
const snapshot = ({ id, title, url, start, timezone }) => ({ id, title, url, start, timezone });
const byId = new Map(data.events.map((e) => [e.id, e]));
const stored = load(PLANNED_KEY, {});
const planned = new Map(
  (Array.isArray(stored) ? stored.map((id) => [id, byId.get(id) && snapshot(byId.get(id))]) : Object.entries(stored))
    .filter(([, e]) => e),
);
const savePlanned = () => save(PLANNED_KEY, Object.fromEntries(planned));

for (const [key, el] of Object.entries(els)) {
  if (el.type === "checkbox") el.checked = state[key];
  else el.value = state[key];
  el.addEventListener("input", () => {
    state[key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    save(CONTROLS_KEY, state);
    renderList();
  });
}
// Filters start open on wide screens, folded away on phones.
if (window.matchMedia("(min-width: 900px)").matches) $("filters").open = true;

// ---- helpers ----
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtCache = new Map();
function fmt(date, tz, opts) {
  const key = tz + JSON.stringify(opts);
  if (!fmtCache.has(key)) {
    try { fmtCache.set(key, new Intl.DateTimeFormat(undefined, { ...opts, timeZone: tz || undefined })); }
    catch { fmtCache.set(key, new Intl.DateTimeFormat(undefined, opts)); }
  }
  return fmtCache.get(key).format(date);
}
const dayName = (e) => fmt(new Date(e.start), e.timezone, { weekday: "short" });
const dayNum = (e) => fmt(new Date(e.start), e.timezone, { month: "short", day: "numeric" });
const timeOf = (e) => fmt(new Date(e.start), e.timezone, { hour: "numeric", minute: "2-digit" });
const longDate = (d) => fmt(d, undefined, { weekday: "long", month: "long", day: "numeric" });
const shortDate = (d) => fmt(d, undefined, { month: "short", day: "numeric" });

function startOfWeek(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}
const weekStart = startOfWeek();
const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
const nextWeekEnd = new Date(weekEnd.getTime() + 7 * DAY);
const inRange = (e, a, b) => { const t = new Date(e.start); return t >= a && t < b; };

const miles = (km) => km / KM_PER_MI;
function distanceLabel(s) {
  if (s.km == null) return "Online";
  return `${s.kmApprox ? "About " : ""}${miles(s.km).toFixed(1)} mi from ${profile.home.label}`;
}
function whereLabel(e) {
  if (e.online) return "Online";
  if (e.venueHidden) return `${e.city ?? "Location TBA"}, venue shared after approval`;
  return [e.address, e.city].filter(Boolean).join(", ") || "Location TBA";
}
const hostLabel = (e) => e.calendar || e.hosts.map((h) => h.name).slice(0, 2).join(" and ") || "Unknown host";
const TIER_NAME = { 1: "Strong match", 2: "Good match", 3: "Weak match" };

const scored = data.events.map((e) => ({ e, s: score(e, { maxKm: profile.maxDistanceKm }) }));
const isLongShot = (s) => s.acceptance < 0.35;
const offTopic = (s) => s.offTopic;
const pct = (n) => Math.round(n * 100);
const level = (v, hi = 0.75, lo = 0.4) => (v >= hi ? "hi" : v >= lo ? "mid" : "lo");

// Turn the scorer's reasons into five plain facts with a strength level each.
function facts({ e, s }) {
  const find = (prefix) => s.reasons.find((r) => r.startsWith(prefix));
  const host = find("Host: ")?.slice(6).replace(" (target org)", ", a target org").replace(" (notable org)", ", a notable org") ?? "Unknown host";
  const venueReason = find("Venue") ?? (e.online ? "Online" : "Venue not listed");
  const venue = venueReason.replace(/^Venue: /, "").replace(" (host's own space)", ", the host's own space");
  const odds = s.reasons.find((r) => /^(Sold out|Waitlist|Approval|Open)/.test(r)) ?? "Unknown";
  const fit = offTopic(s) ? "Off-topic for your search" : s.hits.length ? `Mentions ${s.hits.join(", ")}` : "No keywords from your search";
  const distLevel = s.km == null ? "mid" : level(1 - miles(s.km) / 30, 0.8, 0.5);
  return [
    ["Host", host, level(s.host)],
    ["Venue", venue, level(s.venue)],
    ["Fit", fit, level(s.relevance, 0.6, 0.3)],
    ["Odds", odds, level(s.acceptance)],
    ["Distance", distanceLabel(s), distLevel],
  ];
}

function planButton(e, compact = false) {
  const on = planned.has(e.id);
  const title = escapeHtml(e.title);
  return `<button type="button" class="plan${on ? " on" : ""}${compact ? " compact" : ""}" data-id="${escapeHtml(e.id)}" aria-pressed="${on}" aria-label="${on ? "Planned" : "Plan to go"}: ${title}">
    <span class="plan-box" aria-hidden="true"></span><span class="plan-text">${on ? "Going" : "Plan to go"}</span></button>`;
}

function pickCard(x, rank) {
  const { e, s } = x;
  const on = planned.has(e.id);
  const nextWeek = inRange(e, weekEnd, nextWeekEnd);
  return `
    <li class="pick${on ? " is-planned" : ""}">
      <span class="pick-rank" aria-hidden="true">${rank}</span>
      <div class="pick-main">
        <p class="pick-when"><span><strong>${escapeHtml(dayName(e))} ${escapeHtml(dayNum(e))}</strong>, ${escapeHtml(timeOf(e))}</span>${nextWeek ? `<span class="tag">Counts toward next week</span>` : ""}</p>
        <h3 class="pick-title"><span class="sr-only">Number ${rank}: </span><a href="${escapeHtml(e.url)}" target="_blank" rel="noopener"><span class="hl">${escapeHtml(e.title)}</span></a></h3>
        <p class="pick-where">${escapeHtml(whereLabel(e))}</p>
        <dl class="facts">
          ${facts(x).map(([k, v, lv]) => `<div class="fact lv-${lv}"><dt>${k}</dt><dd><span class="meter" aria-hidden="true"><i></i><i></i><i></i></span>${escapeHtml(v)}</dd></div>`).join("")}
        </dl>
      </div>
      <div class="pick-side">
        <p class="pick-score"><span class="score-num">${pct(s.tierScore)}</span><span class="score-label">${TIER_NAME[s.tier]}${e.guests ? `, ${e.guests} going` : ""}${e.free === false ? ", paid" : ""}</span></p>
        ${planButton(e)}
      </div>
    </li>`;
}

function row({ e, s }) {
  const on = planned.has(e.id);
  const flags = [TIER_NAME[s.tier], e.guests ? `${e.guests} going` : null, e.free === false ? "Paid" : null, isLongShot(s) ? "Long shot" : null, offTopic(s) ? "Off-topic" : null].filter(Boolean);
  return `
    <li class="row tier-${s.tier}${on ? " is-planned" : ""}">
      <p class="row-date"><span>${escapeHtml(dayName(e))}</span> ${escapeHtml(dayNum(e))}<span class="row-time">${escapeHtml(timeOf(e))}</span></p>
      <div class="row-main">
        <h3 class="row-title"><a href="${escapeHtml(e.url)}" target="_blank" rel="noopener"><span class="hl">${escapeHtml(e.title)}</span></a></h3>
        <p class="row-sub">${escapeHtml(hostLabel(e))}. ${escapeHtml(s.km == null ? "Online" : `${miles(s.km).toFixed(1)} mi away`)}.</p>
        <p class="row-flags">${flags.map((f) => `<span>${escapeHtml(f)}</span>`).join("")}</p>
      </div>
      <p class="row-score" title="Score out of 100"><span class="sr-only">Score </span>${pct(s.tierScore)}</p>
      ${planButton(e, true)}
    </li>`;
}

// ---- render ----
function renderGoal() {
  const start = new Date(`${profile.goal.start}T00:00:00`), deadline = new Date(`${profile.goal.deadline}T00:00:00`);
  const totalWeeks = Math.round((deadline - start) / (7 * DAY));
  const week = Math.min(totalWeeks, Math.max(1, Math.floor((Date.now() - start) / (7 * DAY)) + 1));
  const daysLeft = Math.max(0, Math.ceil((deadline - Date.now()) / DAY));
  const target = profile.goal.eventsPerWeek;
  const mine = [...planned.values()].map((e) => ({ e })).sort((a, b) => Date.parse(a.e.start) - Date.parse(b.e.start));
  const thisWeek = mine.filter(({ e }) => inRange(e, weekStart, weekEnd));
  const nextWeek = mine.filter(({ e }) => inRange(e, weekEnd, nextWeekEnd));

  $("goalWeek").textContent = `Week ${week} of ${totalWeeks}.`;
  $("goalDeadline").textContent = `${daysLeft} days until ${longDate(deadline)}.`;
  $("goalText").textContent = profile.goal.text;
  $("season").innerHTML = Array.from({ length: totalWeeks }, (_, i) =>
    `<span class="${i + 1 < week ? "past" : i + 1 === week ? "now" : ""}">${i + 1}</span>`).join("");

  $("slotsTitle").textContent = `Your ${target} for ${shortDate(weekStart)} to ${shortDate(new Date(weekEnd - DAY))}`;
  const slots = Array.from({ length: Math.max(target, thisWeek.length) }, (_, i) => thisWeek[i]);
  $("slots").innerHTML = slots.map((x, i) => x
    ? `<li class="slot filled">
        <p class="slot-when">${escapeHtml(dayName(x.e))} ${escapeHtml(dayNum(x.e))}, ${escapeHtml(timeOf(x.e))}</p>
        <a class="slot-title" href="${escapeHtml(x.e.url)}" target="_blank" rel="noopener">${escapeHtml(x.e.title)}</a>
        <button type="button" class="plan slot-remove on" data-id="${escapeHtml(x.e.id)}" aria-pressed="true" aria-label="Remove from plan: ${escapeHtml(x.e.title)}">Remove</button>
      </li>`
    : `<li class="slot open"><span class="slot-n" aria-hidden="true">${i + 1}</span><span>${i === thisWeek.length ? "Open. Pick one from the best bets." : "Open"}</span></li>`).join("");

  const n = thisWeek.length;
  $("weekCount").textContent = n === 0
    ? `Nothing planned this week yet.`
    : n < target
      ? `${n} of ${target} planned. ${target - n === 1 ? "One more" : `${target - n} more`} to go.`
      : `${n} planned. You're on track this week.`;
  $("nextWeek").textContent = nextWeek.length
    ? `Already lined up for next week: ${nextWeek.length} of ${target}.`
    : "";
}

function renderTop() {
  const top = topPicks(scored, profile, { days: 7, count: TOP_COUNT });
  $("top").innerHTML = top.length
    ? top.map((x, i) => pickCard(x, i + 1)).join("")
    : `<li class="empty"><strong>No strong events in the next 7 days yet.</strong> The feed refreshes every morning. Meanwhile, switch All upcoming events to the next 14 days.</li>`;
}

function filterSummary() {
  const parts = [state.days === "14" ? "Next 14 days" : "Next 7 days", `within ${state.maxMi} mi`];
  if (state.tier === "1") parts.push("strong only");
  if (state.tier === "2") parts.push("strong and good");
  if (state.freeOnly) parts.push("free");
  const hidden = [state.hideLongShots && "long shots", state.hideOffTopic && "off-topic"].filter(Boolean);
  if (hidden.length) parts.push(`hiding ${hidden.join(" and ")}`);
  if (state.q.trim()) parts.push(`matching "${state.q.trim()}"`);
  return parts.join(", ");
}

function renderList() {
  $("maxMiV").textContent = `${state.maxMi} mi`;
  $("filterSummary").textContent = filterSummary();
  const q = state.q.trim().toLowerCase();
  const maxKm = state.maxMi * KM_PER_MI;
  const tierMax = state.tier === "all" ? 3 : Number(state.tier);
  const rows = scored
    .filter(({ e }) => inNextDays(e, Number(state.days)))
    .filter(({ s }) => s.tier <= tierMax)
    .filter(({ e }) => !state.freeOnly || e.free)
    .filter(({ s }) => !state.hideLongShots || !isLongShot(s))
    .filter(({ s }) => !state.hideOffTopic || !offTopic(s))
    .filter(({ s }) => s.km == null || s.km <= maxKm)
    .filter(({ e }) => !q || [e.title, e.calendar, e.address, e.city, ...e.hosts.map((h) => h.name)].join(" ").toLowerCase().includes(q))
    .sort((a, b) => b.s.tierScore - a.s.tierScore);
  $("allCount").textContent = `${rows.length} ${rows.length === 1 ? "event" : "events"}, best first`;
  $("list").innerHTML = rows.length
    ? rows.slice(0, LIST_LIMIT).map(row).join("")
    : `<li class="empty"><strong>No events match these filters.</strong> Try a longer window, a bigger distance or a shorter search.</li>`;
  $("listMore").textContent = rows.length > LIST_LIMIT ? `Showing the top ${LIST_LIMIT} of ${rows.length}. Narrow the filters to see the rest.` : "";
}

function render() {
  renderGoal();
  renderTop();
  renderList();
}

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".plan");
  if (!btn) return;
  const id = btn.dataset.id;
  const where = btn.closest("#slots, #top, #list")?.id;
  if (planned.has(id)) planned.delete(id);
  else if (byId.has(id)) planned.set(id, snapshot(byId.get(id)));
  savePlanned();
  render();
  // Re-rendering replaces the button; put keyboard focus back where it was.
  const again = document.querySelector(`#${where} .plan[data-id="${CSS.escape(id)}"]`)
    ?? document.querySelector(`#top .plan[data-id="${CSS.escape(id)}"]`) ?? $("picks");
  again?.focus({ preventScroll: true });
});

$("meta").textContent = `${data.count} upcoming Luma events, updated ${fmt(new Date(data.fetchedAt), undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
$("export").addEventListener("click", () => window.print());
render();
