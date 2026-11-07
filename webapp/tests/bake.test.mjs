import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PARAMS, DEFAULT_RECIPE, readingRate } from "../public/js/model.js";
import { computeBake, estimateNow, headsUpDecision } from "../public/js/bake.js";
import { formatDuration, formatAgo } from "../public/js/format.js";

const H = 3600 * 1000;
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const recipe = DEFAULT_RECIPE;
const reading = (at, tempC, extra = {}) => ({ id: String(at), at, tempC, kind: "room", humidityPct: null, ...extra });
const hoursAt = (tempC) => 1 / readingRate({ tempC, kind: "room" }, recipe);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test("idle with no readings has no estimate", () => {
  const r = computeBake({ startedAt: null, readings: [], recipe, now: T0 });
  assert.equal(r.status, "idle");
  assert.equal(estimateNow({ readings: [], recipe, now: T0 }), null);
});

test("estimate if started now uses the latest reading", () => {
  const est = estimateNow({ readings: [reading(T0 - H, 20), reading(T0 - 1000, 26)], recipe, now: T0 });
  close(est.hours, hoursAt(26));
  close(est.readyAt, T0 + hoursAt(26) * H, 1);
});

test("started with no temperature waits for one", () => {
  const r = computeBake({ startedAt: T0, readings: [], recipe, now: T0 + H });
  assert.equal(r.status, "waiting");
});

test("constant temperature: progress is elapsed / bulk time", () => {
  const total = hoursAt(24);
  const r = computeBake({ startedAt: T0, readings: [reading(T0 - H, 24)], recipe, now: T0 + 2 * H });
  assert.equal(r.status, "active");
  close(r.progress, 2 / total);
  close(r.remainingH, total - 2);
  close(r.readyAt, T0 + total * H, 1);
});

test("a new reading changes the remaining time immediately", () => {
  const readings = [reading(T0, 20)];
  const before = computeBake({ startedAt: T0, readings, recipe, now: T0 + H });
  const after = computeBake({ startedAt: T0, readings: [...readings, reading(T0 + H, 28)], recipe, now: T0 + H });
  // Same progress so far (the new reading counts from now), but faster from here on.
  close(before.progress, after.progress);
  assert.ok(after.remainingH < before.remainingH);
  close(after.remainingH, (1 - after.progress) * hoursAt(28));
});

test("each reading counts from when it was entered until the next", () => {
  const readings = [reading(T0, 20), reading(T0 + 2 * H, 26), reading(T0 + 3 * H, 22)];
  const r = computeBake({ startedAt: T0, readings, recipe, now: T0 + 4 * H });
  close(r.progress, 2 / hoursAt(20) + 1 / hoursAt(26) + 1 / hoursAt(22));
});

test("a reading from before the start applies from the start", () => {
  const r = computeBake({ startedAt: T0, readings: [reading(T0 - 5 * H, 23)], recipe, now: T0 + H });
  close(r.progress, 1 / hoursAt(23));
});

test("a first reading entered late is assumed to have held since the start", () => {
  const r = computeBake({ startedAt: T0, readings: [reading(T0 + H, 23)], recipe, now: T0 + 2 * H });
  close(r.progress, 2 / hoursAt(23));
});

test("completion time is found inside the stretch where progress crosses 100%", () => {
  const total = hoursAt(25);
  const r = computeBake({ startedAt: T0, readings: [reading(T0, 25)], recipe, now: T0 + (total + 3) * H });
  assert.equal(r.status, "done");
  assert.equal(r.progress, 1);
  close(r.completedAt, T0 + total * H, 1);
  close(r.elapsedH, total, 1e-6);
});

test("model settings are honoured", () => {
  const params = { ...DEFAULT_PARAMS, baseHours: 10 };
  const a = estimateNow({ readings: [reading(T0, 24)], recipe, now: T0 });
  const b = estimateNow({ readings: [reading(T0, 24)], recipe, params, now: T0 });
  close(b.hours, a.hours * 2);
});

test("heads-up fires once when the lead time is reached", () => {
  let flags = { headsUpSent: false, headsUpChecked: false };
  let d = headsUpDecision({ remainingH: 3, leadMin: 30, flags });
  assert.equal(d.notify, false);
  flags = d;
  d = headsUpDecision({ remainingH: 0.45, leadMin: 30, flags });
  assert.equal(d.notify, true);
  flags = d;
  d = headsUpDecision({ remainingH: 0.2, leadMin: 30, flags });
  assert.equal(d.notify, false);
});

test("heads-up is skipped for a bake that starts inside the lead time", () => {
  const d = headsUpDecision({ remainingH: 0.3, leadMin: 30, flags: { headsUpSent: false, headsUpChecked: false } });
  assert.equal(d.notify, false);
  assert.equal(d.headsUpSent, true);
});

test("heads-up is skipped when completion is imminent", () => {
  const d = headsUpDecision({ remainingH: 0.02, leadMin: 30, flags: { headsUpSent: false, headsUpChecked: true } });
  assert.equal(d.notify, false);
  assert.equal(d.headsUpSent, true);
});

test("durations and ages read naturally", () => {
  assert.equal(formatDuration(2 + 35 / 60), "2 h 35 m");
  assert.equal(formatDuration(0.75), "45 m");
  assert.equal(formatDuration(3), "3 h");
  assert.equal(formatDuration(0.001), "under a minute");
  assert.equal(formatAgo(T0 - 20 * 1000, T0), "just now");
  assert.equal(formatAgo(T0 - 12 * 60 * 1000, T0), "12 min ago");
  assert.equal(formatAgo(T0 - (72 * 60 * 1000), T0), "1 h 12 m ago");
});
