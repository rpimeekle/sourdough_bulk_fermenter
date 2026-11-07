/** Display helpers. Locale-aware where the browser supports it. */

import { cToF } from "./model.js";

const MIN_MS = 60 * 1000;

/** "2 h 35 m", "45 m", "12 h", "under a minute". */
export function formatDuration(hours) {
  if (!Number.isFinite(hours)) return "—";
  const totalMin = Math.round(Math.max(0, hours) * 60);
  if (totalMin < 1) return "under a minute";
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (!h) return `${m} m`;
  if (!m) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")} m`;
}

function sameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Clock time, prefixed with the weekday when it isn't today. */
export function formatClock(ms, now = Date.now(), locale) {
  if (!Number.isFinite(ms)) return "—";
  const time = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(ms);
  if (sameDay(ms, now)) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(ms, tomorrow)) return `tomorrow ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(ms, yesterday)) return `yesterday ${time}`;
  const day = new Intl.DateTimeFormat(locale, { weekday: "short" }).format(ms);
  return `${day} ${time}`;
}

/** "just now", "12 min ago", "1 h 12 m ago". */
export function formatAgo(ms, now = Date.now()) {
  const diff = now - ms;
  if (diff < MIN_MS) return "just now";
  const mins = Math.round(diff / MIN_MS);
  if (mins < 60) return `${mins} min ago`;
  return `${formatDuration(mins / 60)} ago`;
}

export function toUnit(tempC, unit) {
  return unit === "F" ? cToF(tempC) : tempC;
}

export function formatTemp(tempC, unit, digits = 1) {
  return `${toUnit(tempC, unit).toFixed(digits)}\u00a0°${unit}`;
}

/** Round to a step-friendly number for prefilling inputs. */
export function round(x, digits = 1) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
