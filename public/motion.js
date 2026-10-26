// Motion layer (GSAP from a pinned CDN). app.js loads it after the first render, calls init() once and
// afterRender(reason, detail) after later renders. The page works without it, and it does nothing under
// prefers-reduced-motion. Animates transform/opacity, meter width and the filter panel height only.
import { gsap } from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/index.js";
import { ScrollTrigger } from "https://cdn.jsdelivr.net/npm/gsap@3.12.5/ScrollTrigger.js";

gsap.registerPlugin(ScrollTrigger);
gsap.config({ nullTargetWarn: false }); // targets come and go with every re-render

const EASE = "power3.out";
const CLEAR = "opacity,transform";
const PANEL = "height,opacity,overflow,paddingTop,paddingBottom";
// Everything the intro or a scroll reveal can hide; print and the safety timer settle these.
const HIDEABLE = ".hdr, .goal, .goal-h span, .day, .slot, #top .card, #list .row, .sec-t, .fbar";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const guard = (fn) => (...args) => { try { return fn(...args); } catch {} };

let ctx = null; // the matchMedia context; only set while motion is allowed
let lifts = new WeakMap(); // hover quickTo per element
let slotKeys = []; // what each slot showed last render, to spot the ones that changed
let listTween;
let unsplit = () => {};
let started = false;

// ---- intro ----
// No SplitText: words become spans, and aria-label keeps the heading one phrase for screen readers.
function splitWords(h) {
  const text = h.textContent.trim().replace(/\s+/g, " ");
  h.setAttribute("aria-label", text);
  h.replaceChildren(...text.split(" ").flatMap((word, i) => {
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    span.style.display = "inline-block";
    span.textContent = word;
    return i ? [" ", span] : [span];
  }));
  unsplit = () => { h.textContent = text; h.removeAttribute("aria-label"); };
  return $$("span", h);
}

const keysOf = () => $$("#slots .slot").map((slot, i) => i + slot.textContent);

function intro() {
  const h = $(".goal-h");
  const words = h && !h.children.length && h.textContent.trim() ? splitWords(h) : [];
  slotKeys = keysOf();
  gsap.timeline({ defaults: { ease: EASE, clearProps: CLEAR } })
    .from(".hdr", { y: -12, opacity: 0, duration: 0.6 }, 0)
    .from(".goal", { y: 24, opacity: 0, duration: 0.8 }, 0.1)
    .from(words, { y: 16, opacity: 0, duration: 0.7, stagger: 0.04 }, 0.35)
    .from("#days7 .day", { y: 10, opacity: 0, duration: 0.5, stagger: 0.05 }, 0.6)
    .from("#slots .slot", { y: 12, opacity: 0, duration: 0.55, stagger: 0.1 }, 0.85);
}

// ---- scroll reveals ----
// Triggers first, hidden state second: if ScrollTrigger throws, nothing is left invisible.
function onScroll(els, from, enter) {
  if (!els.length) return;
  try {
    ScrollTrigger.batch(els, { start: "top 92%", once: true, interval: 0.1, onEnter: enter });
    gsap.set(els, from);
  } catch {
    gsap.set(els, { clearProps: CLEAR });
  }
}

function cardsIn() {
  // yPercent, not y, so the reveal never fights the hover lift
  onScroll($$("#top .card"), { opacity: 0, yPercent: 6 }, (cards) => {
    gsap.to(cards, { opacity: 1, yPercent: 0, duration: 0.7, ease: EASE, stagger: 0.09, clearProps: "opacity" });
    cards.forEach(guard((card, i) => {
      const delay = 0.2 + i * 0.09;
      const total = $(".total b", card);
      if (parseInt(total?.textContent, 10) > 0) {
        gsap.from(total, { textContent: 0, duration: 1, delay, ease: "power2.out", snap: { textContent: 1 } });
      }
    }));
  });
}

const rowsIn = () => onScroll($$("#list .row"), { opacity: 0, y: 14 }, (rows) =>
  gsap.to(rows, { opacity: 1, y: 0, duration: 0.55, ease: EASE, stagger: { amount: 0.3 }, clearProps: CLEAR }));

const headsIn = () => onScroll($$(".sec-t, .fbar"), { opacity: 0, y: 12 }, (els) =>
  gsap.to(els, { opacity: 1, y: 0, duration: 0.6, ease: EASE, stagger: 0.08, clearProps: CLEAR }));

// ---- after a re-render ----
const prune = () => ScrollTrigger.getAll().forEach((t) => t.trigger && !t.trigger.isConnected && t.kill());

function planFx({ id, on }) {
  const key = CSS.escape(String(id));
  const buttons = $$(`.plan[data-id="${key}"], .iconbtn[data-id="${key}"]`);
  gsap.fromTo(buttons, { scale: 0.88 }, { scale: 1, duration: 0.6, ease: "expo.out" });
  if (on) {
    const rows = buttons.map((b) => b.closest(".card, .row")).filter(Boolean);
    gsap.fromTo(rows, { opacity: 0.4 }, { opacity: 1, duration: 0.7, ease: "power2.out", clearProps: "opacity" });
  }
  const keys = keysOf();
  gsap.from($$("#slots .slot").filter((_, i) => keys[i] !== slotKeys[i]), { y: 10, opacity: 0, duration: 0.5, ease: EASE, stagger: 0.06, clearProps: CLEAR });
  slotKeys = keys;
  gsap.fromTo($$(".status"), { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.4, ease: EASE, clearProps: CLEAR });
}

function listIn() {
  // app.js re-renders per keystroke and slider tick: let a burst play once instead of restarting
  if (listTween?.isActive()) return;
  listTween = gsap.from($$("#list .row").slice(0, 15), { y: 10, opacity: 0, duration: 0.45, ease: EASE, stagger: { amount: 0.3 }, clearProps: CLEAR });
}

// ---- filter panel ----
// app.js has already toggled [hidden] and derives its next state from it, so closing must not touch it:
// close just drops any half-open inline styles; opening animates height and padding together.
function filters(open) {
  const panel = $("#filter-panel");
  if (!panel) return;
  gsap.killTweensOf(panel);
  gsap.set(panel, { clearProps: PANEL });
  if (!open || !panel.offsetHeight) return ScrollTrigger.refresh();
  const { height, paddingTop, paddingBottom } = getComputedStyle(panel);
  gsap.fromTo(panel,
    { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0, overflow: "hidden" },
    { height, paddingTop, paddingBottom, opacity: 1, duration: 0.5, ease: EASE, clearProps: PANEL, onComplete: () => ScrollTrigger.refresh() });
}

// Score bars grow when a breakdown is opened (they sit closed inside <details> until then).
function factorsIn(e) {
  const d = e.target;
  if (!d.open || !d.matches?.("#top details.why")) return;
  $$(".fill", d).forEach((fill, i) => {
    const width = fill.style.width; // app.js writes the final width inline
    if (width) gsap.fromTo(fill, { width: "0%" }, { width, duration: 0.7, delay: i * 0.05, ease: EASE });
  });
}

const themeSpin = (e) => {
  const button = e.target.closest?.("#themeToggle");
  if (button) gsap.fromTo($$("svg", button), { rotation: -90, scale: 0.6, opacity: 0 }, { rotation: 0, scale: 1, opacity: 1, duration: 0.55, ease: EASE, clearProps: CLEAR });
};

// ---- never leave content invisible ----
function settle(els) {
  const parts = els.flatMap((el) => $$(".fill, .total b", el));
  gsap.getTweensOf(parts).forEach((t) => t.progress(1)); // meters and counters jump to their end values
  gsap.killTweensOf(els);
  gsap.set(els, { clearProps: CLEAR });
  lifts = new WeakMap();
}

// Below-the-fold items keep waiting for their trigger; anything in view and idle after 3s is shown.
const rescue = () => settle($$(HIDEABLE).filter((el) => el.getBoundingClientRect().top < innerHeight && !gsap.isTweening(el)));

// ---- wiring ----
function start(context) {
  ctx = context;
  const off = new AbortController();
  const on = (target, type, fn) => target.addEventListener(type, guard(fn), { signal: off.signal });
  [intro, cardsIn, rowsIn, headsIn].forEach((feature) => guard(feature)());
  on(document, "et:filters", (e) => filters(e.detail?.open));
  on(document, "click", themeSpin);
  document.addEventListener("toggle", guard(factorsIn), { capture: true, signal: off.signal }); // toggle does not bubble
  on(window, "beforeprint", () => { ScrollTrigger.getAll().forEach((t) => t.kill()); settle($$(HIDEABLE)); });
  document.fonts?.ready.then(() => ctx && ScrollTrigger.refresh()); // web fonts move the triggers
  const timer = setTimeout(guard(rescue), 3000);
  return () => { ctx = null; off.abort(); clearTimeout(timer); unsplit(); };
}

// Pointer devices only, and a separate context so a pointer change never replays the intro.
function hover() {
  const off = new AbortController();
  const to = { ".card": -3, ".plan:not(.slot-x)": -2 };
  const lift = (up) => guard((e) => {
    if (e.pointerType === "touch") return;
    for (const sel in to) {
      const el = e.target.closest?.(sel);
      if (!el || el.disabled || el.contains(e.relatedTarget)) continue;
      if (!lifts.has(el)) lifts.set(el, gsap.quickTo(el, "y", { duration: 0.35, ease: EASE }));
      lifts.get(el)(up ? to[sel] : 0);
    }
  });
  document.addEventListener("pointerover", lift(true), { signal: off.signal });
  document.addEventListener("pointerout", lift(false), { signal: off.signal });
  return () => off.abort();
}

export function init() {
  if (started) return;
  started = true;
  try {
    const calm = "(prefers-reduced-motion: no-preference)";
    const mm = gsap.matchMedia();
    mm.add(calm, start);
    mm.add(`${calm} and (pointer: fine)`, hover);
  } catch {}
}

export function afterRender(reason, detail = {}) {
  if (!ctx) return;
  ctx.add(guard(() => {
    prune();
    if (reason === "plan") planFx(detail);
    if (reason === "filter") listIn();
  }));
}
