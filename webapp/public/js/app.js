import { DEFAULT_PARAMS, DEFAULT_RECIPE, recipeFigures, fToC } from "./model.js";
import { computeBake, estimateNow, headsUpDecision, sortReadings } from "./bake.js";
import { formatAgo, formatClock, formatDuration, formatTemp, round, toUnit } from "./format.js";
import { clearAll, loadConsent, loadState, saveConsent, saveState } from "./storage.js";
import { describeGeoError, fetchOutdoor, geolocationAvailable, getPosition } from "./weather.js";

const HOUR_MS = 3600 * 1000;
const STALE_AFTER_MS = 3 * HOUR_MS;
const MAX_READINGS = 500;
const LOG_VISIBLE = 8;
const TICK_MS = 30 * 1000;
const MIN_TEMP_C = 0;
const MAX_TEMP_C = 50;

const DEFAULT_SETTINGS = Object.freeze({
  q10: DEFAULT_PARAMS.q10,
  refTemp: DEFAULT_PARAMS.refTemp,
  baseHours: DEFAULT_PARAMS.baseHours,
});
const DEFAULT_HEADS_UP_MIN = 30;

const KIND_LABEL = { room: "room air", dough: "dough" };

// --------------------------------------------------------------------------
// State
// --------------------------------------------------------------------------

/** Countries that conventionally use Fahrenheit. */
const FAHRENHEIT_REGIONS = new Set(["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"]);

function defaultUnit() {
  try {
    const region = new Intl.Locale(navigator.language || "en").maximize().region;
    return FAHRENHEIT_REGIONS.has(region) ? "F" : "C";
  } catch {
    return "C";
  }
}

function freshState() {
  return {
    v: 1,
    unit: defaultUnit(),
    recipe: { ...DEFAULT_RECIPE },
    settings: { ...DEFAULT_SETTINGS },
    useHumidity: true,
    headsUpMin: DEFAULT_HEADS_UP_MIN,
    notify: false,
    readings: [],
    bake: null,
  };
}

const num = (v) => typeof v === "number" && Number.isFinite(v);

/** Merge stored state over defaults, dropping anything malformed. */
function sanitize(stored) {
  const s = freshState();
  if (!stored || typeof stored !== "object" || stored.v !== 1) return s;
  if (stored.unit === "C" || stored.unit === "F") s.unit = stored.unit;
  for (const k of Object.keys(s.recipe)) if (num(stored.recipe?.[k])) s.recipe[k] = stored.recipe[k];
  for (const k of Object.keys(s.settings)) if (num(stored.settings?.[k])) s.settings[k] = stored.settings[k];
  if (typeof stored.useHumidity === "boolean") s.useHumidity = stored.useHumidity;
  if (num(stored.headsUpMin)) s.headsUpMin = stored.headsUpMin;
  s.notify = stored.notify === true;
  if (Array.isArray(stored.readings)) {
    s.readings = stored.readings
      .filter((r) => r && num(r.at) && num(r.tempC))
      .map((r) => ({
        id: String(r.id || r.at),
        at: r.at,
        tempC: r.tempC,
        kind: r.kind === "dough" ? "dough" : "room",
        humidityPct: num(r.humidityPct) ? r.humidityPct : null,
        source: r.source === "outdoor" ? "outdoor" : "manual",
      }))
      .slice(-MAX_READINGS);
  }
  if (stored.bake && num(stored.bake.startedAt)) {
    s.bake = {
      startedAt: stored.bake.startedAt,
      headsUpSent: !!stored.bake.headsUpSent,
      headsUpChecked: !!stored.bake.headsUpChecked,
      doneNotified: !!stored.bake.doneNotified,
    };
  }
  return s;
}

let state = sanitize(loadState());
let consent = loadConsent();
/** Outdoor suggestion, in memory only: null | {loading} | {error} | {tempC, humidityPct, fetchedAt}. */
let outdoor = null;

const persist = () => saveState(state);
const params = () => ({ ...DEFAULT_PARAMS, ...state.settings });
const lastReading = () => {
  const sorted = sortReadings(state.readings);
  return sorted.length ? sorted[sorted.length - 1] : null;
};

function newId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/** Keep only the most recent reading (what "current conditions" means between bakes). */
function keepLatestReadingOnly() {
  const last = lastReading();
  state.readings = last ? [last] : [];
}

// --------------------------------------------------------------------------
// DOM
// --------------------------------------------------------------------------

const ref = {};
for (const el of document.querySelectorAll("[data-ref]")) ref[el.dataset.ref] = el;

const show = (el, visible) => {
  el.hidden = !visible;
};

function describeReading(r) {
  const parts = [r.source === "outdoor" ? "outdoor, near you" : KIND_LABEL[r.kind]];
  if (r.kind !== "dough" && num(r.humidityPct)) parts.push(`${Math.round(r.humidityPct)}% humidity`);
  return parts.join(", ");
}

function lastKnownSentence(r, now) {
  return (
    `Based on the last known temperature of ${formatTemp(r.tempC, state.unit)} (${describeReading(r)}), ` +
    `updated ${formatAgo(r.at, now)} at ${formatClock(r.at, now)}.`
  );
}

// Jar geometry (see index.html): dough starts at the band, target is the dashed line.
const JAR_START_Y = 113;
const JAR_TARGET_Y = 62;

function drawJar(progress, status) {
  const p = Math.max(0, Math.min(1, progress));
  const level = JAR_START_Y - p * (JAR_START_Y - JAR_TARGET_Y);
  const dome = level - 4 - 8 * p;
  ref.dough.setAttribute("d", `M20 150 L20 ${level + 5} Q60 ${dome} 100 ${level + 5} L100 150 Z`);
  for (const c of ref.bubbles.querySelectorAll("circle")) {
    c.classList.toggle("on", Number(c.getAttribute("cy")) > level + 6);
  }
  ref.bubbles.style.opacity = String(0.3 + 0.6 * p);
  document.querySelector(".jar").classList.toggle("done", status === "done");
}

function renderStatus(now) {
  const recipe = state.recipe;
  const common = { readings: state.readings, recipe, params: params(), useHumidity: state.useHumidity, now };
  const result = computeBake({ ...common, startedAt: state.bake?.startedAt });
  const est = estimateNow(common);
  const last = result.lastReading;

  show(ref.complete, result.status === "done");
  show(ref.startBtn, result.status === "idle");
  show(ref.resetBtn, result.status === "active" || result.status === "waiting");
  show(ref.startAdjust, result.status === "active" || result.status === "waiting");
  show(ref.progressWrap, result.status === "active" || result.status === "waiting");
  show(ref.stale, false);

  const pct = Math.floor(result.progress * 100);
  ref.progressFill.style.width = `${(result.progress * 100).toFixed(1)}%`;
  ref.progressBar.setAttribute("aria-valuenow", String(pct));

  switch (result.status) {
    case "idle":
      ref.caption.textContent = "Not started";
      if (est) {
        ref.eyebrow.textContent = "If you start now";
        ref.headline.textContent = `About ${formatDuration(est.hours)} of bulk`;
        ref.note.textContent = `Ready around ${formatClock(est.readyAt, now)}. ${lastKnownSentence(last, now)}`;
      } else {
        ref.eyebrow.textContent = "Ready when you are";
        ref.headline.textContent = "Enter a temperature to get an estimate";
        ref.note.textContent = "";
      }
      break;
    case "waiting":
      ref.caption.textContent = "0% of bulk";
      ref.eyebrow.textContent = `Bulk started ${formatClock(state.bake.startedAt, now)}`;
      ref.headline.textContent = "Enter the temperature to start the countdown";
      ref.note.textContent = "";
      break;
    case "active": {
      ref.caption.textContent = `${pct}% of bulk`;
      ref.eyebrow.textContent = `Started ${formatClock(state.bake.startedAt, now)}, ${formatDuration(result.elapsedH)} ago`;
      ref.headline.textContent = Number.isFinite(result.remainingH)
        ? `${formatDuration(result.remainingH)} left`
        : "Too cold to make progress";
      ref.note.textContent =
        (result.readyAt ? `Ready around ${formatClock(result.readyAt, now)}. ` : "") + lastKnownSentence(last, now);
      if (now - last.at > STALE_AFTER_MS) {
        ref.stale.textContent =
          "That reading is over 3 hours old. If the temperature has changed, enter a new one for a better estimate.";
        show(ref.stale, true);
      }
      break;
    }
    case "done":
      ref.caption.textContent = "100% of bulk";
      ref.eyebrow.textContent = `Started ${formatClock(state.bake.startedAt, now)}`;
      ref.headline.textContent = "Ready to shape";
      ref.note.textContent = "";
      ref.completeDetail.textContent =
        `Estimated to have finished around ${formatClock(result.completedAt, now)}, ` +
        `after ${formatDuration(result.elapsedH)}.`;
      break;
  }

  drawJar(result.status === "idle" ? 0 : result.progress, result.status);
  maybeNotify(result, now);
  return { result, est };
}

function renderUnit() {
  for (const b of document.querySelectorAll(".unit-toggle button")) {
    b.setAttribute("aria-pressed", String(b.dataset.unit === state.unit));
  }
  ref.tempSuffix.textContent = `°${state.unit}`;
}

function renderHumidityField() {
  show(ref.humidityField, ref.tempKind.value === "room");
}

function renderLog(now) {
  const sorted = sortReadings(state.readings).reverse();
  show(ref.logWrap, sorted.length > 0);
  ref.logList.replaceChildren();
  for (const r of sorted.slice(0, LOG_VISIBLE)) {
    const li = document.createElement("li");
    const time = document.createElement("time");
    time.dateTime = new Date(r.at).toISOString();
    time.textContent = formatClock(r.at, now);
    const temp = document.createElement("strong");
    temp.textContent = formatTemp(r.tempC, state.unit);
    const desc = document.createElement("span");
    desc.className = "muted";
    desc.textContent = describeReading(r);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon-btn";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete the reading from ${formatClock(r.at, now)}`);
    del.addEventListener("click", () => {
      state.readings = state.readings.filter((x) => x.id !== r.id);
      persist();
      render();
    });
    li.append(time, temp, desc, del);
    ref.logList.append(li);
  }
  if (sorted.length > LOG_VISIBLE) {
    const li = document.createElement("li");
    li.className = "muted more";
    li.textContent = `…and ${sorted.length - LOG_VISIBLE} earlier`;
    ref.logList.append(li);
  }
}

function renderFigures(est) {
  const fig = recipeFigures(state.recipe);
  ref.figInoc.textContent = `${(fig.starterRatio * 100).toFixed(1)}%`;
  ref.figHyd.textContent = `${fig.trueHydrationPct.toFixed(1)}%`;
  ref.figBulk.textContent = est ? formatDuration(est.hours) : "enter a temperature";
}

function renderOutdoor(now) {
  const on = !!consent?.location;
  show(ref.outdoorOff, !on);
  show(ref.outdoorOn, on);
  if (!on) return;
  show(ref.outdoorUse, false);
  if (!geolocationAvailable()) {
    ref.outdoorLine.textContent =
      "Your browser only shares location over a secure (https) connection, so the outdoor temperature isn't available here.";
    show(ref.outdoorRefresh, false);
    return;
  }
  show(ref.outdoorRefresh, true);
  if (!outdoor || outdoor.loading) {
    ref.outdoorLine.textContent = "Checking the temperature outside…";
  } else if (outdoor.error) {
    ref.outdoorLine.textContent = outdoor.error;
  } else {
    const hum = num(outdoor.humidityPct) ? `, ${Math.round(outdoor.humidityPct)}% humidity` : "";
    ref.outdoorLine.textContent =
      `Outside near you: ${formatTemp(outdoor.tempC, state.unit)}${hum} (checked ${formatClock(outdoor.fetchedAt, now)}).`;
    show(ref.outdoorUse, true);
  }
}

function renderNotifyButton() {
  if (!("Notification" in window)) {
    ref.notifyBtn.disabled = true;
    ref.notifyHint.textContent = "This browser doesn't support notifications.";
    return;
  }
  const on = state.notify && Notification.permission === "granted";
  ref.notifyBtn.textContent = on ? "Turn off notifications" : "Turn on notifications";
  if (Notification.permission === "denied") {
    ref.notifyHint.textContent = "Notifications are blocked for this site in your browser settings.";
  } else {
    ref.notifyHint.textContent = `You'll get a heads-up ${state.headsUpMin} min before the end, and a note when bulk is done. These only arrive while this page is open in a tab.`;
  }
}

function render() {
  const now = Date.now();
  renderUnit();
  renderHumidityField();
  const { est } = renderStatus(now);
  renderLog(now);
  renderFigures(est);
  renderOutdoor(now);
  renderNotifyButton();
  show(ref.consent, consent === null);
}

// --------------------------------------------------------------------------
// Forms
// --------------------------------------------------------------------------

function fillTempInput() {
  const last = lastReading();
  if (last) {
    ref.tempInput.value = String(round(toUnit(last.tempC, state.unit), 1));
    ref.tempKind.value = last.source === "outdoor" ? "room" : last.kind;
    ref.humidityInput.value = num(last.humidityPct) ? String(Math.round(last.humidityPct)) : "";
  }
}

function fillRecipeForm() {
  for (const [k, v] of Object.entries(state.recipe)) {
    const input = ref.recipeForm.elements.namedItem(k);
    if (input) input.value = String(v);
  }
}

function fillSettingsForm() {
  const f = ref.settingsForm.elements;
  for (const [k, v] of Object.entries(state.settings)) f.namedItem(k).value = String(v);
  f.namedItem("headsUpMin").value = String(state.headsUpMin);
  f.namedItem("useHumidity").checked = state.useHumidity;
}

function toLocalInputValue(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function showTempError(msg) {
  ref.tempError.textContent = msg || "";
  show(ref.tempError, !!msg);
}

function addReading({ tempC, kind, humidityPct, source }) {
  state.readings.push({ id: newId(), at: Date.now(), tempC, kind, humidityPct, source });
  if (state.readings.length > MAX_READINGS) state.readings = state.readings.slice(-MAX_READINGS);
  persist();
  render();
}

ref.tempForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = parseFloat(ref.tempInput.value);
  if (!Number.isFinite(raw)) return showTempError("Enter a temperature first.");
  const tempC = state.unit === "F" ? fToC(raw) : raw;
  if (tempC < MIN_TEMP_C || tempC > MAX_TEMP_C) {
    return showTempError(`That doesn't look like a fermentation temperature. Check the unit (°${state.unit}).`);
  }
  const kind = ref.tempKind.value === "dough" ? "dough" : "room";
  let humidityPct = null;
  if (kind === "room" && ref.humidityInput.value !== "") {
    const h = parseFloat(ref.humidityInput.value);
    if (!Number.isFinite(h) || h < 0 || h > 100) return showTempError("Humidity should be between 0 and 100%.");
    humidityPct = h;
  }
  showTempError("");
  addReading({ tempC, kind, humidityPct, source: "manual" });
});

ref.tempKind.addEventListener("change", renderHumidityField);

for (const b of document.querySelectorAll(".unit-toggle button")) {
  b.addEventListener("click", () => {
    if (state.unit === b.dataset.unit) return;
    const raw = parseFloat(ref.tempInput.value);
    if (Number.isFinite(raw)) {
      const c = state.unit === "F" ? fToC(raw) : raw;
      ref.tempInput.value = String(round(toUnit(c, b.dataset.unit), 1));
    }
    state.unit = b.dataset.unit;
    persist();
    render();
  });
}

ref.recipeForm.addEventListener("input", (e) => {
  const { name, value } = e.target;
  if (!(name in state.recipe)) return;
  const v = parseFloat(value);
  if (!Number.isFinite(v) || v < 0) return;
  if (name === "flourG" && v <= 0) return;
  state.recipe[name] = v;
  persist();
  render();
});

ref.recipeReset.addEventListener("click", () => {
  state.recipe = { ...DEFAULT_RECIPE };
  fillRecipeForm();
  persist();
  render();
});

ref.settingsForm.addEventListener("input", (e) => {
  const { name, value, checked } = e.target;
  if (name === "useHumidity") state.useHumidity = checked;
  else {
    const v = parseFloat(value);
    if (!Number.isFinite(v) || v < 0) return;
    if (name === "headsUpMin") state.headsUpMin = v;
    else if (name in state.settings && v > 0) state.settings[name] = v;
    else return;
  }
  persist();
  render();
});

ref.settingsReset.addEventListener("click", () => {
  state.settings = { ...DEFAULT_SETTINGS };
  state.useHumidity = true;
  state.headsUpMin = DEFAULT_HEADS_UP_MIN;
  fillSettingsForm();
  persist();
  render();
});

// --------------------------------------------------------------------------
// Bake controls
// --------------------------------------------------------------------------

function startBake(startedAt) {
  // Readings from before the start only matter up to the one in force at the start.
  const sorted = sortReadings(state.readings);
  const inForce = sorted.filter((r) => r.at <= startedAt).pop();
  state.readings = sorted.filter((r) => r.at >= startedAt || r === inForce);
  state.bake = { startedAt, headsUpSent: false, headsUpChecked: false, doneNotified: false };
  ref.startAt.value = toLocalInputValue(startedAt);
  persist();
  render();
}

ref.startBtn.addEventListener("click", () => startBake(Date.now()));

ref.resetBtn.addEventListener("click", () => {
  if (!window.confirm("Reset this bake? The countdown and its progress will be cleared.")) return;
  state.bake = null;
  keepLatestReadingOnly();
  persist();
  render();
});

ref.newBakeBtn.addEventListener("click", () => {
  state.bake = null;
  keepLatestReadingOnly();
  persist();
  render();
});

ref.startForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const t = new Date(ref.startAt.value).getTime();
  const now = Date.now();
  if (!Number.isFinite(t) || t > now || now - t > 48 * HOUR_MS) {
    ref.startAt.setCustomValidity("Pick a time in the last 48 hours.");
    ref.startAt.reportValidity();
    return;
  }
  ref.startAt.setCustomValidity("");
  state.bake = { ...state.bake, startedAt: t, headsUpSent: false, headsUpChecked: false, doneNotified: false };
  persist();
  render();
});
ref.startAt.addEventListener("input", () => ref.startAt.setCustomValidity(""));

// --------------------------------------------------------------------------
// Notifications (only while the page is open: there is no server to push from)
// --------------------------------------------------------------------------

let swRegistration = null;
if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker
    .register("sw.js")
    .then((reg) => {
      swRegistration = reg;
    })
    .catch(() => {});
}

function notify(title, body) {
  if (!state.notify || !("Notification" in window) || Notification.permission !== "granted") return;
  const options = { body, tag: "sourdough-bulk", icon: "icons/icon-192.png", badge: "icons/icon-192.png" };
  try {
    if (swRegistration) swRegistration.showNotification(title, options);
    else new Notification(title, options);
  } catch {
    /* Some mobile browsers only allow service-worker notifications. */
  }
}

function maybeNotify(result, now) {
  const bake = state.bake;
  if (!bake) return;
  let changed = false;
  if (result.status === "active") {
    const d = headsUpDecision({ remainingH: result.remainingH, leadMin: state.headsUpMin, flags: bake });
    if (d.headsUpSent !== bake.headsUpSent || d.headsUpChecked !== bake.headsUpChecked) {
      bake.headsUpSent = d.headsUpSent;
      bake.headsUpChecked = d.headsUpChecked;
      changed = true;
    }
    if (d.notify) {
      notify(
        "Bulk nearly done",
        `About ${formatDuration(result.remainingH)} left. Ready around ${formatClock(result.readyAt, now)}.`,
      );
    }
  } else if (result.status === "done" && !bake.doneNotified) {
    bake.doneNotified = true;
    changed = true;
    // Only alert if it finished recently; don't announce a bake that ended hours ago.
    if (now - result.completedAt < 15 * 60 * 1000) {
      notify("Bulk ferment complete", `Finished around ${formatClock(result.completedAt, now)}. Time to check the dough.`);
    }
  }
  if (changed) persist();
}

ref.notifyBtn.addEventListener("click", async () => {
  if (state.notify && Notification.permission === "granted") {
    state.notify = false;
  } else {
    const permission = await Notification.requestPermission();
    state.notify = permission === "granted";
  }
  persist();
  render();
});

// --------------------------------------------------------------------------
// Consent & outdoor temperature
// --------------------------------------------------------------------------

async function refreshOutdoor() {
  if (!consent?.location || !geolocationAvailable()) return render();
  outdoor = { loading: true };
  render();
  try {
    const pos = await getPosition();
    outdoor = await fetchOutdoor(pos);
  } catch (err) {
    outdoor = { error: describeGeoError(err) };
  }
  render();
}

function setConsent(location) {
  consent = { location, decidedAt: Date.now() };
  saveConsent(consent);
  if (!location) outdoor = null;
  render();
  if (location) refreshOutdoor();
}

ref.consentAllow.addEventListener("click", () => setConsent(true));
ref.consentDeny.addEventListener("click", () => setConsent(false));
ref.outdoorEnable.addEventListener("click", () => setConsent(true));
ref.outdoorRefresh.addEventListener("click", refreshOutdoor);
ref.privacyBtn.addEventListener("click", () => {
  show(ref.consent, true);
  ref.consentAllow.focus();
});
ref.consentForget.addEventListener("click", () => {
  if (!window.confirm("Forget everything this calculator saved in this browser, including the current bake?")) return;
  clearAll();
  state = freshState();
  consent = null;
  outdoor = null;
  ref.tempInput.value = "";
  ref.humidityInput.value = "";
  fillRecipeForm();
  fillSettingsForm();
  render();
});

ref.outdoorUse.addEventListener("click", () => {
  if (!outdoor || !num(outdoor.tempC)) return;
  ref.tempKind.value = "room";
  ref.tempInput.value = String(round(toUnit(outdoor.tempC, state.unit), 1));
  ref.humidityInput.value = num(outdoor.humidityPct) ? String(Math.round(outdoor.humidityPct)) : "";
  addReading({ tempC: outdoor.tempC, kind: "room", humidityPct: outdoor.humidityPct, source: "outdoor" });
});

// --------------------------------------------------------------------------
// Boot
// --------------------------------------------------------------------------

fillTempInput();
fillRecipeForm();
fillSettingsForm();
if (state.bake) ref.startAt.value = toLocalInputValue(state.bake.startedAt);
render();
if (consent?.location) refreshOutdoor();

setInterval(render, TICK_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") render();
});
