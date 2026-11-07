/**
 * Fermentation maths, ported from custom_components/sourdough_ferment/calc.py.
 *
 * Pure functions with no DOM access so they can be unit-tested in Node and
 * checked for parity against the Python integration (see webapp/tests).
 *
 * Model
 * -----
 * Q10 biological rate law: fermentation rate multiplies by `q10` per +10 °C.
 * Starter ratio scales time by sqrt(refRatio / ratio): more inoculant is
 * faster, with diminishing returns.
 *
 * Optional modifiers:
 *  - Humidity: humid air transfers heat to the dough faster. Only applied
 *    when the temperature is the room's (a dough probe already measures the
 *    dough itself).
 *  - Hydration: wetter doughs ferment faster.
 *  - Protein: stronger flour tolerates a longer bulk, so the target is a
 *    little longer. Changes the target, not the microbes' speed.
 */

export const DEFAULT_PARAMS = Object.freeze({
  q10: 2.0,
  refTemp: 24.0,
  refRatio: 0.2,
  baseHours: 5.0,
  humidityNeutral: 60.0,
  humidityCoeff: 0.003,
  hydrationRef: 75.0,
  hydrationCoeff: 0.008,
  proteinRef: 12.5,
  proteinCoeff: 0.02,
});

export const DEFAULT_RECIPE = Object.freeze({
  starterG: 50,
  flourG: 500,
  waterG: 375,
  proteinPct: 12.5,
  starterHydrationPct: 100,
});

/** Bulk-time thresholds (hours) used to describe the pace. */
export const FAST_THRESHOLD_H = 3.0;
export const SLOW_THRESHOLD_H = 10.0;

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function tempFactor(tempC, p) {
  return p.q10 ** ((p.refTemp - tempC) / 10.0);
}

export function ratioFactor(starterRatio, p) {
  const ratio = Math.max(starterRatio, 0.001);
  return (p.refRatio / ratio) ** 0.5;
}

export function humidityFactor(humidityPct, p) {
  return clamp(1.0 + (p.humidityNeutral - humidityPct) * p.humidityCoeff, 0.8, 1.2);
}

export function hydrationFactor(hydrationPct, p) {
  return clamp(1.0 - (hydrationPct - p.hydrationRef) * p.hydrationCoeff, 0.75, 1.3);
}

export function proteinFactor(proteinPct, p) {
  return clamp(1.0 + (proteinPct - p.proteinRef) * p.proteinCoeff, 0.85, 1.2);
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Estimated total bulk fermentation time in hours.
 * `starterRatio` is a fraction (0.10 == 10%). Modifiers apply only when given.
 */
export function bulkHours(tempC, starterRatio, p = DEFAULT_PARAMS, mods = {}) {
  const { humidityPct, hydrationPct, proteinPct } = mods;
  let hours = p.baseHours * tempFactor(tempC, p) * ratioFactor(starterRatio, p);
  if (isNum(humidityPct)) hours *= humidityFactor(humidityPct, p);
  if (isNum(hydrationPct)) hours *= hydrationFactor(hydrationPct, p);
  if (isNum(proteinPct)) hours *= proteinFactor(proteinPct, p);
  return Math.max(hours, 0.0);
}

/** Fraction of bulk completed per hour under the given conditions. */
export function ratePerHour(tempC, starterRatio, p = DEFAULT_PARAMS, mods = {}) {
  const hours = bulkHours(tempC, starterRatio, p, mods);
  return hours <= 0 ? 0.0 : 1.0 / hours;
}

/** Derived recipe figures (baker's percentages). */
export function recipeFigures(recipe) {
  const { starterG, flourG, waterG, starterHydrationPct: sh } = recipe;
  const starterFlour = (starterG * 100.0) / (100.0 + sh);
  const starterWater = (starterG * sh) / (100.0 + sh);
  const totalFlour = flourG + starterFlour;
  const totalWater = waterG + starterWater;
  return {
    starterRatio: flourG > 0 ? starterG / flourG : 0.0,
    trueHydrationPct: totalFlour > 0 ? (totalWater / totalFlour) * 100.0 : 0.0,
    starterFlourG: starterFlour,
    starterWaterG: starterWater,
    totalFlourG: totalFlour,
    totalWaterG: totalWater,
  };
}

/**
 * Rate for one temperature reading, applying the integration's source rules:
 * humidity only counts for room readings, and only when enabled.
 */
export function readingRate(reading, recipe, p = DEFAULT_PARAMS, useHumidity = true) {
  const fig = recipeFigures(recipe);
  const humidity =
    useHumidity && reading.kind !== "dough" && isNum(reading.humidityPct)
      ? reading.humidityPct
      : undefined;
  return ratePerHour(reading.tempC, fig.starterRatio, p, {
    humidityPct: humidity,
    hydrationPct: fig.trueHydrationPct,
    proteinPct: recipe.proteinPct,
  });
}

export function pace(hours) {
  if (hours < FAST_THRESHOLD_H) return "fast";
  if (hours > SLOW_THRESHOLD_H) return "slow";
  return "normal";
}

export const cToF = (c) => (c * 9) / 5 + 32;
export const fToC = (f) => ((f - 32) * 5) / 9;
