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

/** Confirms the proxy is reachable and the toolbox key is accepted. */
export function health() {
  return call("/health");
}

/**
 * Event list for one date window. Dates as YYYY-MM-DD.
 *
 * detail=true also pulls the assigned PM for each event, which the Flex
 * calendar view doesn't carry. The proxy runs those lookups in parallel, but
 * they still cost time — see fetchEventsChunked for how the range is split.
 */
export function fetchEvents({ start, end, detail = false } = {}) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (detail) params.set("detail", "1");
  const qs = params.toString();
  return call(`/flex/events${qs ? `?${qs}` : ""}`);
}

/** Full detail for one event: header fields plus client and venue addresses. */
export function fetchEvent(flexId) {
  return call(`/flex/event/${flexId}`);
}

/**
 * Walk the sync range in windows so no single request outlives Anvil's
 * 30-second ceiling.
 *
 * The range starts two weeks back — once an event has loaded out, nothing
 * moves in Flex, and the fortnight covers anything still in closeout.
 *
 * onProgress({ done, total, label, found }) fires after each window.
 */
export async function fetchEventsChunked({
  daysBack = 14,
  monthsForward = 24,
  chunkMonths = 4,
  detail = true,
  onProgress,
} = {}) {
  const windows = buildWindows(daysBack, monthsForward, chunkMonths);
  const seen = new Map();

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const { events } = await fetchEvents({ start: w.start, end: w.end, detail });

    // Events spanning a window boundary come back twice; keep one.
    for (const evt of events) seen.set(evt.flexId, evt);

    onProgress?.({
      done: i + 1,
      total: windows.length,
      label: w.label,
      found: seen.size,
    });
  }

  return [...seen.values()];
}

/**
 * Same walk, but detail is fetched only for windows that might contain an
 * event we don't already know about. Windows where every event is already in
 * Firestore with a PM run without the header lookups, which is most of them
 * after the first sync.
 *
 * knownIds is a Set of flexIds that already have a real PM name on file.
 */
export async function fetchEventsSmart({
  daysBack = 14,
  monthsForward = 24,
  chunkMonths = 4,
  knownIds = new Set(),
  onProgress,
} = {}) {
  const windows = buildWindows(daysBack, monthsForward, chunkMonths);
  const seen = new Map();

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];

    // First pass: cheap list, no header lookups.
    const { events } = await fetchEvents({ start: w.start, end: w.end, detail: false });

    const needsDetail = events.some((e) => !knownIds.has(e.flexId));

    if (needsDetail) {
      // Something here is new; pay for the headers on this window only.
      const detailed = await fetchEvents({ start: w.start, end: w.end, detail: true });
      for (const evt of detailed.events) seen.set(evt.flexId, evt);
    } else {
      for (const evt of events) seen.set(evt.flexId, evt);
    }

    onProgress?.({
      done: i + 1,
      total: windows.length,
      label: w.label,
      found: seen.size,
      detailed: needsDetail,
    });
  }

  return [...seen.values()];
}

function buildWindows(daysBack, monthsForward, chunkMonths) {
  const now = new Date();

  // Start exactly daysBack days ago, not the first of that month.
  const cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
  const stop = new Date(now.getFullYear(), now.getMonth() + monthsForward, 1);
  const windows = [];

  while (cursor < stop) {
    const start = new Date(cursor);
    cursor.setMonth(cursor.getMonth() + chunkMonths);
    const end = new Date(cursor.getTime() - 86400000); // day before next window

    windows.push({
      start: iso(start),
      end: iso(end),
      label: `${short(start)} – ${short(end)}`,
    });
  }

  return windows;
}

function iso(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function short(d) {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function pad(n) {
  return String(n).padStart(2, "0");
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
