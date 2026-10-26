// Loads the static events + profile, scores each event (scoring.js) and renders the goal panel, this week's
// slots, the top 5 and the full ranked list. Markup and class names follow the Claude Design port in styles.css.
import { createScorer, inNextDays, topPicks } from "./scoring.js";

const TOP_COUNT = 5;
const PAGE_SIZE = 20;
const KM_PER_MI = 1.609;
const CONTROLS_KEY = "events-ticker:controls:v2";
const PLANNED_KEY = "events-ticker:planned";
const THEME_KEY = "events-ticker:theme";

const $ = (id) => document.getElementById(id);
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };

// motion.js is optional polish: fetched alongside the data so its intro runs before first paint. The page works without it.
const motionReady = import("./motion.js").catch(() => null);
let motion = null;
const after = (reason, detail) => { try { motion?.afterRender?.(reason, detail); } catch {} };

// ---- theme: follows the system until the toggle is used, then the choice sticks ----
const root = document.documentElement;
const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (root.dataset.theme ? root.dataset.theme === "dark" : systemDark.matches);
const syncTheme = () => $("themeToggle").setAttribute("aria-pressed", isDark());
const savedTheme = load(THEME_KEY, null);
if (savedTheme === "light" || savedTheme === "dark") root.dataset.theme = savedTheme;
syncTheme();
systemDark.addEventListener("change", syncTheme);
$("themeToggle").addEventListener("click", () => {
  root.dataset.theme = isDark() ? "light" : "dark";
  save(THEME_KEY, root.dataset.theme);
  syncTheme();
});

// ---- filter panel: open on wide screens, folded away on phones ----
const panel = $("filter-panel"), ftoggle = $("filterToggle");
const showFilters = (open) => { panel.hidden = !open; ftoggle.setAttribute("aria-expanded", open); };
showFilters(window.matchMedia("(min-width: 900px)").matches);
ftoggle.addEventListener("click", () => {
  showFilters(panel.hidden);
  document.dispatchEvent(new CustomEvent("et:filters", { detail: { open: !panel.hidden } }));
});

const [data, profile] = await Promise.all([
  fetch("events.json").then((r) => r.json()),
  fetch("profile.json").then((r) => r.json()),
]).catch((err) => { $("meta").textContent = "Couldn't load events. Refresh to try again."; throw err; });
const score = createScorer(profile);

// ---- controls ----
const els = {
  q: $("q"), tier: $("tier"), maxMi: $("maxMi"),
  freeOnly: $("freeOnly"), hideLongShots: $("hideLongShots"), hideOffTopic: $("hideOffTopic"),
};
const dayBtns = [...document.querySelectorAll("#days button")];
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

let page = 1;
const filtersChanged = () => { page = 1; save(CONTROLS_KEY, state); renderList(); after("filter", {}); };
for (const [key, el] of Object.entries(els)) {
  if (el.type === "checkbox") el.checked = state[key];
  else el.value = state[key];
  el.addEventListener("input", () => {
    state[key] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) : el.value;
    filtersChanged();
  });
}
for (const b of dayBtns) b.addEventListener("click", () => { state.days = b.dataset.days; filtersChanged(); });

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

// "This week" is the next 7 days from today, the same window as Best bets, so anything planned from them fills a slot.
// Calendar days, not 24h steps, so the window still ends at midnight across a DST change.
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekStart = new Date(new Date().setHours(0, 0, 0, 0));
const weekEnd = addDays(weekStart, 7);
const nextWeekEnd = addDays(weekEnd, 7);
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

// Odds chip for the list, read straight from the event flags (same order the scorer checks them).
function oddsOf(e) {
  if (e.soldOut && !e.waitlist) return ["soldout", "Sold out"];
  if (e.waitlist) return ["waitlist", "Waitlist"];
  if (e.requireApproval) return ["approval", "Approval"];
  if (e.nearCapacity) return ["filling", "Filling up"];
  return ["open", "Open"];
}

// The scorer's reasons as plain facts; they make up "Why this fits you".
function facts({ e, s }) {
  const find = (prefix) => s.reasons.find((r) => r.startsWith(prefix));
  const host = find("Host: ")?.slice(6).replace(" (target org)", ", a target org").replace(" (notable org)", ", a notable org") ?? "Unknown host";
  const venueReason = find("Venue") ?? (e.online ? "Online" : "Venue not listed");
  const venue = venueReason.replace(/^Venue: /, "").replace(" (host's own space)", ", the host's own space");
  const odds = s.reasons.find((r) => /^(Sold out|Waitlist|Approval|Open)/.test(r)) ?? "Unknown";
  const fit = offTopic(s) ? "Off-topic for your search" : s.hits.length ? `Mentions ${s.hits.join(", ")}` : "No keywords from your search";
  return [["Host", host], ["Venue", venue], ["Fit", fit], ["Odds", odds]];
}

// ---- templates (every event-derived value goes through escapeHtml) ----
const svg = (size, d, width = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHECK = "M5 12.5l4.5 4.5L19 7.5", PLUS = "M12 5v14M5 12h14", CLOSE = "M6 6l12 12M18 6L6 18";
const planLabel = (on) => (on ? "Planned" : "Plan to go");

// Luma's CDN resizes on request: a 1.2 MB poster becomes a ~60 KB square thumbnail.
const coverUrl = (url, px) => url.replace(/^https:\/\/images\.lumacdn\.com\/(?!cdn-cgi\/)/, `https://images.lumacdn.com/cdn-cgi/image/format=auto,fit=cover,dpr=2,width=${px},height=${px}/`);
const cover = (e, px, cls) => e.cover
  ? `<img class="${cls}" src="${escapeHtml(coverUrl(e.cover, px))}" alt="" width="${px}" height="${px}" loading="lazy" decoding="async">`
  : `<span class="${cls}" aria-hidden="true"></span>`;
const openWhy = new Set(); // score breakdowns the viewer opened, kept open across re-renders

function planButton(e, on) {
  return `<button type="button" class="plan" data-id="${escapeHtml(e.id)}" aria-pressed="${on}" aria-label="${planLabel(on)}: ${escapeHtml(e.title)}">${svg(16, on ? CHECK : PLUS)}${planLabel(on)}</button>`;
}
function iconButton(e, on) {
  const label = escapeHtml(on ? `Planned: ${e.title}. Remove from plan` : `Plan to go: ${e.title}`);
  return `<button type="button" class="iconbtn" data-id="${escapeHtml(e.id)}" aria-pressed="${on}" aria-label="${label}" title="${label}">${svg(18, on ? CHECK : PLUS)}</button>`;
}

function pickCard(x, rank) {
  const { e, s } = x;
  const on = planned.has(e.id);
  const nextWeek = inRange(e, weekEnd, nextWeekEnd);
  const scores = { Host: s.host, Venue: s.venue, Fit: s.relevance, Odds: s.acceptance };
  return `
    <li class="card${on ? " sel" : ""}">
      <div class="rank" aria-hidden="true">${String(rank).padStart(2, "0")}</div>
      ${cover(e, 176, "cover")}
      <div class="card-body">
        <div class="meta">
          <strong>${escapeHtml(dayName(e))}, ${escapeHtml(dayNum(e))} · ${escapeHtml(timeOf(e))}</strong>
          <span class="tier t${s.tier}">${TIER_NAME[s.tier]}</span>
          ${on ? `<span class="planned-tag">${svg(14, CHECK)}Planned</span>` : ""}
          ${nextWeek ? `<span class="tag">Counts toward next week</span>` : ""}
          ${e.free === false ? `<span>Paid</span>` : ""}
          ${e.guests ? `<span>${escapeHtml(e.guests)} going</span>` : ""}
        </div>
        <h3 class="card-t serif"><span class="sr">Rank ${rank}: </span><a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a></h3>
        <p class="where"><b>${escapeHtml(hostLabel(e))}</b> · ${escapeHtml(whereLabel(e))} · ${escapeHtml(distanceLabel(s))}</p>
        <details class="why" data-id="${escapeHtml(e.id)}"${openWhy.has(e.id) ? " open" : ""}>
          <summary>
            <span class="total"><b>${pct(s.tierScore)}</b> / 100 overall · ${oddsOf(e)[1]}</span>
            <span class="why-l">Host, venue, fit and odds${svg(14, "M6 9l6 6 6-6", 1.8).replace("<svg", '<svg class="chev"')}</span>
          </summary>
          <dl class="factors">
            ${facts(x).map(([k, v]) => `<div class="factor"><dt>${k}</dt><dd class="track" aria-hidden="true"><span class="fill" style="width:${pct(scores[k])}%"></span></dd><dd class="f-score">${pct(scores[k])}<span class="sr"> out of 100</span></dd><dd class="f-text">${escapeHtml(v)}</dd></div>`).join("")}
          </dl>
        </details>
        <div class="actions no-print">
          ${planButton(e, on)}
          <a class="luma" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">Open on Luma<span class="sr"> (opens in a new tab)</span></a>
        </div>
      </div>
    </li>`;
}

function row({ e, s }) {
  const on = planned.has(e.id);
  const [oddsCls, oddsText] = oddsOf(e);
  const tags = [
    s.tier === 1 && `<span class="tier t1">Strong match</span>`,
    ["approval", "waitlist", "soldout"].includes(oddsCls) && `<span class="chip odds"><span class="dot ${oddsCls}" aria-hidden="true"></span>${oddsCls === "approval" ? "Needs approval" : oddsText}</span>`,
    e.free === false && `<span class="chip">Paid</span>`,
    isLongShot(s) && `<span class="chip">Long shot</span>`,
    offTopic(s) && `<span class="chip">Off-topic</span>`,
  ].filter(Boolean);
  const dist = s.km == null ? "" : ` · ${miles(s.km).toFixed(1)} mi`;
  return `
    <li class="row${on ? " sel" : ""}${isLongShot(s) || offTopic(s) ? " dim" : ""}">
      ${cover(e, 64, "thumb")}
      <div class="c-main">
        <div class="r-title"><a href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a></div>
        <div class="r-when">${escapeHtml(dayName(e))}, ${escapeHtml(dayNum(e))} · ${escapeHtml(timeOf(e))}</div>
        <div class="r-where">${escapeHtml(whereLabel(e))}${dist}</div>
      </div>
      <div class="r-tags">${tags.join("")}</div>
      <div class="c-act">${iconButton(e, on)}</div>
    </li>`;
}

// Numbered pages with the first, last and neighbours of the current one; gaps become "…".
function pager(pages) {
  if (pages < 2) return "";
  const btn = (p, label, attrs = "") => `<button type="button" class="pg" data-page="${p}" ${attrs}>${label}</button>`;
  const nums = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(btn(p, p, p === page ? `aria-current="page" aria-label="Page ${p}, current"` : `aria-label="Page ${p}"`));
    else if (nums.at(-1) !== "…") nums.push("…");
  }
  return btn(page - 1, "Previous", page === 1 ? "disabled" : "")
    + nums.map((n) => (n === "…" ? `<span class="pg-gap" aria-hidden="true">…</span>` : n)).join("")
    + btn(page + 1, "Next", page === pages ? "disabled" : "");
}

// ---- render ----
// The goal text and footer do not depend on plans or filters, so they are drawn once.
function renderGoal() {
  $("goal-h").textContent = profile.goal.text;
  $("slotsTitle").textContent = `Your ${profile.goal.eventsPerWeek} events this week`;
  $("homeLabel").textContent = profile.home.label;
  $("footHome").textContent = `Distances measured from ${profile.home.label}.`;
  $("footGoal").textContent = `Aim for ${profile.goal.eventsPerWeek} a week. Quality over volume.`;
}

function renderSlots() {
  const target = profile.goal.eventsPerWeek;
  const mine = [...planned.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  const thisWeek = mine.filter((e) => inRange(e, weekStart, weekEnd));
  const nextWeek = mine.filter((e) => inRange(e, weekEnd, nextWeekEnd));

  $("slots").innerHTML = Array.from({ length: Math.max(target, thisWeek.length) }, (_, i) => {
    const e = thisWeek[i];
    const n = `<span class="slot-n" aria-hidden="true">${i + 1}</span>`;
    return e
      ? `<li class="slot filled">${n}
          <div class="slot-body">
            <div class="slot-when">${escapeHtml(dayName(e))}, ${escapeHtml(dayNum(e))} · ${escapeHtml(timeOf(e))}</div>
            <a class="slot-title" href="${escapeHtml(e.url)}" target="_blank" rel="noopener">${escapeHtml(e.title)}</a>
          </div>
          <button type="button" class="plan slot-x no-print" data-id="${escapeHtml(e.id)}" aria-label="Remove ${escapeHtml(e.title)} from this week">${svg(16, CLOSE, 1.7)}</button>
        </li>`
      : `<li class="slot empty">${n}<span>Open slot · pick one from Best bets</span></li>`;
  }).join("");

  const n = thisWeek.length;
  $("weekStatus").textContent = `${n} of ${target} planned${n >= target ? " · week is set" : ""}`;
  $("nextWeek").textContent = nextWeek.length ? `Already lined up for next week: ${nextWeek.length} of ${target}.` : "";

  // The 7-day strip: a dot per strong match (up to 3), and the day turns orange once something is planned.
  const strong = scored.filter(({ s }) => s.tier === 1 && !isLongShot(s) && !offTopic(s)).map(({ e }) => e);
  $("days7").innerHTML = Array.from({ length: 7 }, (_, i) => {
    const a = addDays(weekStart, i), b = addDays(a, 1);
    const hits = strong.filter((e) => inRange(e, a, b)).length;
    const mineToday = thisWeek.filter((e) => inRange(e, a, b)).length;
    const said = `${fmt(a, undefined, { weekday: "long", month: "long", day: "numeric" })}: ${hits || "no"} strong ${hits === 1 ? "match" : "matches"}${mineToday ? `, ${mineToday} planned` : ""}`;
    return `<li class="day${mineToday ? " planned" : ""}${i === 0 ? " today" : ""}">
        <span class="day-w" aria-hidden="true">${i === 0 ? "Today" : fmt(a, undefined, { weekday: "short" })}</span>
        <span class="day-n serif" aria-hidden="true">${fmt(a, undefined, { day: "numeric" })}</span>
        <span class="day-dots" aria-hidden="true">${"<i></i>".repeat(Math.min(hits, 3))}</span>
        <span class="sr">${said}</span>
      </li>`;
  }).join("");
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
  els.maxMi.setAttribute("aria-valuetext", `${state.maxMi} miles`);
  for (const b of dayBtns) b.setAttribute("aria-pressed", b.dataset.days === String(state.days));
  $("filterSummary").textContent = filterSummary();
  // The badge counts settings that differ from the defaults.
  const changed = Object.keys(defaults).filter((k) => String(k === "q" ? state.q.trim() : state[k]) !== String(defaults[k])).length;
  $("filterCount").hidden = !changed;
  $("filterCountN").textContent = changed;

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
    .sort((a, b) => Date.parse(a.e.start) - Date.parse(b.e.start));
  // Strong matches first, then everything else; each part stays in date order.
  const strong = rows.filter(({ s }) => s.tier === 1), rest = rows.filter(({ s }) => s.tier !== 1);
  const all = [...strong, ...rest];
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  page = Math.min(page, pages);
  const shown = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const group = (title, total, items) => items.length
    ? `<h3 class="group-h">${title} <span>${total}</span></h3><ol class="list" role="list" aria-label="${title}">${items.map(row).join("")}</ol>`
    : "";

  $("allCount").textContent = `${rows.length} ${rows.length === 1 ? "event" : "events"} in the next ${state.days} days · strong matches first, then by date`;
  $("list").innerHTML = all.length
    ? group("Strong matches", strong.length, shown.filter(({ s }) => s.tier === 1)) + group("Everything else", rest.length, shown.filter(({ s }) => s.tier !== 1))
    : `<p class="empty-list"><strong>No events match these filters.</strong> Try a longer window, a bigger distance or a shorter search.</p>`;
  $("pager").innerHTML = pager(pages);
}

function render() {
  renderSlots();
  renderTop();
  renderList();
}

document.addEventListener("click", (ev) => {
  const btn = ev.target.closest(".plan, .iconbtn");
  if (!btn) return;
  const id = btn.dataset.id;
  const source = btn.closest("#slots, #top, #list")?.id;
  if (planned.has(id)) planned.delete(id);
  else if (byId.has(id)) planned.set(id, snapshot(byId.get(id)));
  savePlanned();
  render();
  // Re-rendering replaces the button; put keyboard focus back where it was.
  const find = (scope) => document.querySelector(`#${scope} button[data-id="${CSS.escape(id)}"]`);
  (find(source) ?? find("top") ?? $("picks")).focus({ preventScroll: true });
  after("plan", { id, on: planned.has(id), source });
});

$("pager").addEventListener("click", (ev) => {
  const btn = ev.target.closest(".pg");
  if (!btn || btn.disabled) return;
  page = Number(btn.dataset.page);
  renderList();
  $("all-h").scrollIntoView({ block: "start" });
  $("all-h").focus({ preventScroll: true });
  after("filter", {});
});

// toggle does not bubble, so listen in the capture phase.
document.addEventListener("toggle", (ev) => {
  const d = ev.target;
  if (d.matches?.("details.why")) d.open ? openWhy.add(d.dataset.id) : openWhy.delete(d.dataset.id);
}, true);

// The PDF shows every score breakdown; the ones opened only for printing close again afterwards.
let openedForPrint = [];
addEventListener("beforeprint", () => { openedForPrint = [...document.querySelectorAll("#top details:not([open])")]; openedForPrint.forEach((d) => { d.open = true; }); });
addEventListener("afterprint", () => openedForPrint.forEach((d) => { d.open = false; }));

$("meta").textContent = `Updated ${fmt(new Date(data.fetchedAt), undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · ${data.count} events`;
$("export").addEventListener("click", () => window.print());
renderGoal();
render();

// Motion loads after the first render and never blocks it; if the file or its CDN is unavailable, nothing changes.
motionReady.then((m) => { if (!m) return; motion = m; motion.init?.(); }).catch(() => {});
