/**
 * Client for the Anvil proxy, which holds the Flex API key server-side.
 * Both values come from Netlify environment variables at build time.
 */

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

async function call(path) {
  if (!BASE || !KEY) {
    throw new Error(
      "Flex connection isn't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY."
    );
  }

  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Toolbox-Key": KEY },
  });

  if (res.status === 401) {
    throw new Error("Flex connection rejected the toolbox key.");
  }
  if (!res.ok) {
    throw new Error(`Flex request failed (${res.status}).`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function health() {
  return call("/health");
}

/** Dates as YYYY-MM-DD. Defaults on the server: 30 days back, 24 months out. */
export function fetchEvents({ start, end } = {}) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const qs = params.toString();
  return call(`/flex/events${qs ? `?${qs}` : ""}`);
}

export function fetchEvent(flexId) {
  return call(`/flex/event/${flexId}`);
}

/**
 * Flex carries records that aren't production jobs: time off, test documents,
 * and zero-dollar placeholders. Dry rentals ("OTD -") are real work and stay.
 */
export function isRealEvent(evt, filters = {}) {
  const {
    hideZeroDollar = true,
    excludeTerms = ["OOTO", "TEST"],
  } = filters;

  if (hideZeroDollar && !evt.totalPrice) return false;

  const name = (evt.showName || "").toUpperCase();
  return !excludeTerms.some((term) => name.includes(term.toUpperCase()));
}
