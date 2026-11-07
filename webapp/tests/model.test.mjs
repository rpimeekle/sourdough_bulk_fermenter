import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PARAMS,
  DEFAULT_RECIPE,
  bulkHours,
  ratePerHour,
  recipeFigures,
  readingRate,
  cToF,
  fToC,
} from "../public/js/model.js";

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures.json", import.meta.url)), "utf8"));

test("matches the Python integration's calc.py on every fixture", () => {
  assert.ok(fixtures.rows.length > 1000);
  for (const row of fixtures.rows) {
    const [paramSet, tempC, starterRatio, humidityPct, hydrationPct, proteinPct, hours] = row;
    const p = { ...DEFAULT_PARAMS, ...fixtures.paramSets[paramSet] };
    const mods = {
      humidityPct: humidityPct ?? undefined,
      hydrationPct: hydrationPct ?? undefined,
      proteinPct: proteinPct ?? undefined,
    };
    const got = bulkHours(tempC, starterRatio, p, mods);
    assert.ok(Math.abs(got - hours) < 1e-8, `row ${JSON.stringify(row)} gave ${got}`);
  }
});

test("rate is the reciprocal of bulk time", () => {
  const h = bulkHours(22, 0.1, DEFAULT_PARAMS);
  assert.ok(Math.abs(ratePerHour(22, 0.1, DEFAULT_PARAMS) - 1 / h) < 1e-12);
});

test("reference conditions give the base time", () => {
  assert.equal(bulkHours(24, 0.2, DEFAULT_PARAMS), 5);
});

test("+10 °C halves bulk time at Q10 = 2", () => {
  const a = bulkHours(20, 0.1, DEFAULT_PARAMS);
  const b = bulkHours(30, 0.1, DEFAULT_PARAMS);
  assert.ok(Math.abs(a / b - 2) < 1e-12);
});

test("recipe figures for the default recipe", () => {
  const f = recipeFigures(DEFAULT_RECIPE);
  assert.equal(f.starterRatio, 0.1);
  // 375 g water + 25 g starter water over 500 g flour + 25 g starter flour.
  assert.ok(Math.abs(f.trueHydrationPct - (400 / 525) * 100) < 1e-12);
});

test("humidity is ignored for dough-probe readings and when disabled", () => {
  const room = readingRate({ tempC: 22, kind: "room", humidityPct: 90 }, DEFAULT_RECIPE);
  const roomNoHum = readingRate({ tempC: 22, kind: "room", humidityPct: null }, DEFAULT_RECIPE);
  const dough = readingRate({ tempC: 22, kind: "dough", humidityPct: 90 }, DEFAULT_RECIPE);
  const disabled = readingRate({ tempC: 22, kind: "room", humidityPct: 90 }, DEFAULT_RECIPE, DEFAULT_PARAMS, false);
  assert.ok(room > roomNoHum, "humid air should speed things up");
  assert.equal(dough, roomNoHum);
  assert.equal(disabled, roomNoHum);
});

test("temperature conversion round-trips", () => {
  assert.equal(cToF(100), 212);
  assert.equal(fToC(32), 0);
  assert.ok(Math.abs(fToC(cToF(23.7)) - 23.7) < 1e-12);
});
