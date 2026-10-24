// Run: node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createScorer } from "../public/scoring.js";

const profile = JSON.parse(await readFile(new URL("../public/profile.json", import.meta.url), "utf8"));
const score = createScorer(profile);

const event = (title, extra = {}) => ({
  title, calendar: null, calendarVerified: false, hosts: [], guests: 50,
  online: false, venueHidden: false, address: null, lat: profile.home.lat, lon: profile.home.lon,
  requireApproval: false, soldOut: false, waitlist: false, nearCapacity: false, ...extra,
});

test("approval events mentioning October are not treated as exclusive", () => {
  const s = score(event("Designers & Machines October 2026", { requireApproval: true }));
  assert.ok(s.acceptance >= 0.35, `acceptance ${s.acceptance}`);
});

test("executive-only events are long shots", () => {
  const s = score(event("CISO Executive Mixer", { requireApproval: true }));
  assert.ok(s.acceptance < 0.35, `acceptance ${s.acceptance}`);
});

test("design + hiring events from a target host land in Tier 1", () => {
  const s = score(event("Figma design hiring night", { calendar: "Figma" }));
  assert.equal(s.tier, 1);
});

test("off-topic events are flagged", () => {
  assert.equal(score(event("Crypto trading meetup")).offTopic, true);
});
