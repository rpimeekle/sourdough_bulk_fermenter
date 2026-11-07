/**
 * Outdoor temperature near the visitor, used only as a suggestion.
 *
 * Location comes from the browser's Geolocation API (which asks the visitor
 * itself) and is rounded to ~1 km before being sent straight from the
 * browser to Open-Meteo (free, no API key). The hosting server never sees it,
 * and the coordinates are not stored.
 */

const ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export function geolocationAvailable() {
  return typeof navigator !== "undefined" && "geolocation" in navigator && window.isSecureContext;
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 30 * 60 * 1000 },
    );
  });
}

export async function fetchOutdoor({ lat, lon }) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("latitude", lat.toFixed(2));
  url.searchParams.set("longitude", lon.toFixed(2));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("timezone", "auto");
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
  const data = await res.json();
  const cur = data && data.current;
  if (!cur || typeof cur.temperature_2m !== "number") throw new Error("No current temperature in response");
  return {
    tempC: cur.temperature_2m,
    humidityPct: typeof cur.relative_humidity_2m === "number" ? cur.relative_humidity_2m : null,
    fetchedAt: Date.now(),
  };
}

/** Human-readable reason for a geolocation failure. */
export function describeGeoError(err) {
  if (!err) return "Couldn't get your location.";
  if (err.code === 1) return "Location permission was declined in your browser.";
  if (err.code === 2) return "Your location isn't available right now.";
  if (err.code === 3) return "Timed out waiting for your location.";
  return err.message || "Couldn't get the outdoor temperature.";
}
