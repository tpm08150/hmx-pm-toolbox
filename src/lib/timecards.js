/**
 * Timecards: crew lookup, timecard fetch, approval, and questions sent to the
 * employee. All Shiftboard and Slack calls go through Anvil so no keys reach
 * the browser.
 */

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

async function call(path, { method = "GET", body } = {}) {
  if (!BASE || !KEY) {
    throw new Error("Timecards aren't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const options = { method, headers: { "X-Toolbox-Key": KEY } };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, options);
  if (res.status === 401) throw new Error("Timecards rejected the toolbox key.");

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const err = new Error(data?.error || `Request failed (${res.status}).`);
    err.needsSlackId = data?.needsSlackId;
    throw err;
  }
  return data;
}

/** Crews matching a search. Shiftboard has thousands, so search is required. */
export function searchCrews(search) {
  return call(`/crews?search=${encodeURIComponent(search)}`);
}

export function fetchTimecards({ workgroup, start, end }) {
  const params = new URLSearchParams({ workgroup });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return call(`/timecards?${params}`);
}

export function setApproval(ids, approved) {
  return call("/timecards/approve", {
    method: "POST",
    body: { ids, approved },
  });
}

export function sendTimecardMessage(payload) {
  return call("/timecards/message", { method: "POST", body: payload });
}

/** One-off: every Slack member with their ID, for filling in Shiftboard. */
export function fetchSlackUsers() {
  return call("/slack/users");
}

// ── Pay periods ──────────────────────────────────────────────────────────────

export const PERIODS = [
  { id: "first", label: "1st – 15th" },
  { id: "second", label: "16th – end" },
];

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Start and end dates for a pay period, as YYYY-MM-DD. */
export function periodRange(year, month, period) {
  const pad = (n) => String(n).padStart(2, "0");
  if (period === "first") {
    return { start: `${year}-${pad(month)}-01`, end: `${year}-${pad(month)}-15` };
  }
  const lastDay = new Date(year, month, 0).getDate();
  return { start: `${year}-${pad(month)}-16`, end: `${year}-${pad(month)}-${lastDay}` };
}

/**
 * Which period an event falls in, so the tab opens on the right one instead of
 * making the PM find it. Uses the event's start date; if it has none, today.
 */
export function periodForDate(iso) {
  const source = iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00`) : new Date();
  const d = Number.isNaN(source.getTime()) ? new Date() : source;
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    period: d.getDate() <= 15 ? "first" : "second",
  };
}
