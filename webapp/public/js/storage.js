/**
 * Browser storage. Everything stays on this device: the app never sends a
 * bake, recipe or location to the server it is hosted on.
 *
 * Storage can be unavailable (private windows, blocked site data), so every
 * access is guarded and the app keeps working in memory without it.
 */

const STATE_KEY = "sourdough-webapp:v1:state";
const CONSENT_KEY = "sourdough-webapp:v1:consent";

function read(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadState = () => read(STATE_KEY);
export const saveState = (state) => write(STATE_KEY, state);

/**
 * Consent record: { location: boolean, decidedAt: epoch ms } or null when
 * the visitor hasn't chosen yet.
 */
export const loadConsent = () => read(CONSENT_KEY);
export const saveConsent = (consent) => write(CONSENT_KEY, consent);

/** Forget everything this app stored on this device. */
export function clearAll() {
  write(STATE_KEY, null);
  write(CONSENT_KEY, null);
}
