/**
 * Temperature-aware bulk countdown driven by manually entered readings.
 *
 * The Home Assistant integration integrates the fermentation *rate* over time
 * from a live sensor. Here the "sensor" is a log of readings the baker typed
 * in: each reading holds from the moment it was entered until the next one
 * replaces it. Progress is the sum of rate × duration over those stretches,
 * so a warm afternoon followed by a cool evening is credited correctly, and
 * time remaining is re-forecast from the most recent reading.
 *
 * Everything is recomputed from (start time, readings, recipe) on demand, so
 * nothing drifts if the tab sleeps, and editing the log simply re-derives
 * the result.
 */

import { DEFAULT_PARAMS, readingRate, pace } from "./model.js";

const HOUR_MS = 3600 * 1000;

/** Readings sorted oldest first (does not mutate the input). */
export function sortReadings(readings) {
  return [...(readings || [])].sort((a, b) => a.at - b.at);
}

/** The latest reading at or before `t`, or null. */
export function readingAt(sorted, t) {
  let found = null;
  for (const r of sorted) {
    if (r.at <= t) found = r;
    else break;
  }
  return found;
}

/**
 * Estimate for a bake started right now, from the latest reading.
 * Returns null when no temperature has been entered yet.
 */
export function estimateNow({ readings, recipe, params = DEFAULT_PARAMS, useHumidity = true, now }) {
  const sorted = sortReadings(readings);
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  if (!last) return null;
  const rate = readingRate(last, recipe, params, useHumidity);
  const hours = rate > 0 ? 1 / rate : Infinity;
  return {
    hours,
    rate,
    pace: pace(hours),
    readyAt: now + hours * HOUR_MS,
    lastReading: last,
  };
}

/**
 * Progress of an active bake.
 *
 * @returns {{
 *   status: "idle"|"waiting"|"active"|"done",
 *   progress: number,              // 0..1
 *   rate: number|null,             // current fraction per hour
 *   remainingH: number|null,
 *   readyAt: number|null,          // epoch ms (active only)
 *   completedAt: number|null,      // epoch ms (done only)
 *   lastReading: object|null,
 *   elapsedH: number,
 * }}
 */
export function computeBake({ startedAt, readings, recipe, params = DEFAULT_PARAMS, useHumidity = true, now }) {
  const sorted = sortReadings(readings);
  const lastReading = sorted.length ? sorted[sorted.length - 1] : null;
  const base = {
    progress: 0,
    rate: null,
    remainingH: null,
    readyAt: null,
    completedAt: null,
    lastReading,
    elapsedH: startedAt ? Math.max(0, (now - startedAt) / HOUR_MS) : 0,
  };

  if (!startedAt) return { ...base, status: "idle" };
  if (!lastReading) return { ...base, status: "waiting" };

  // Stretch boundaries: the start, every reading entered during the bake,
  // and now. Before the first in-bake reading, the latest reading from
  // before the start applies; if there is none, the first reading is
  // assumed to have held since the start (the baker just entered it late).
  const end = Math.max(now, startedAt);
  const cuts = [startedAt];
  for (const r of sorted) if (r.at > startedAt && r.at < end) cuts.push(r.at);
  cuts.push(end);

  let progress = 0;
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    const reading = readingAt(sorted, from) || sorted[0];
    const rate = readingRate(reading, recipe, params, useHumidity);
    const dtH = (to - from) / HOUR_MS;
    if (rate > 0 && progress + rate * dtH >= 1) {
      const completedAt = from + ((1 - progress) / rate) * HOUR_MS;
      return {
        ...base,
        status: "done",
        progress: 1,
        rate,
        remainingH: 0,
        completedAt,
        elapsedH: (completedAt - startedAt) / HOUR_MS,
      };
    }
    progress += rate * dtH;
  }

  const rate = readingRate(lastReading, recipe, params, useHumidity);
  const remainingH = rate > 0 ? (1 - progress) / rate : Infinity;
  return {
    ...base,
    status: "active",
    progress,
    rate,
    remainingH,
    readyAt: Number.isFinite(remainingH) ? now + remainingH * HOUR_MS : null,
  };
}

/**
 * Decide whether to send the "nearly done" alert, mirroring the
 * integration's rules:
 *  - at most one per bake;
 *  - none if the bake began with less than the lead time to go;
 *  - none inside the last few minutes, when the completion alert is imminent.
 *
 * Returns the updated flags and whether to notify now.
 */
export const HEADS_UP_FLOOR_MIN = 3;

export function headsUpDecision({ remainingH, leadMin, flags }) {
  const out = { ...flags, notify: false };
  if (!leadMin || leadMin <= 0 || flags.headsUpSent || !Number.isFinite(remainingH)) return out;
  const remainingMin = remainingH * 60;
  if (!flags.headsUpChecked) {
    out.headsUpChecked = true;
    if (remainingMin <= leadMin) {
      out.headsUpSent = true;
      return out;
    }
  }
  if (remainingMin > leadMin) return out;
  out.headsUpSent = true;
  out.notify = remainingMin >= HEADS_UP_FLOOR_MIN;
  return out;
}
