/**
 * Labor requests: shift rows, category estimates, and delivery.
 */
import { getSettings } from "./settings";
import { fetchRoster } from "./roster";

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

/** Where the sent request gets filed in FileCloud. */
export const LABOR_FOLDER = "Labor - Trucking";

/** Who receives labor requests, matched by name in the Shiftboard roster. */
export const PAYROLL_NAME = "Katie Barnes";

/**
 * The four rates a shift can bill at. One row is exactly one category — a
 * rigger call is riggers, so counting it as anything else would double the
 * hours in the estimate.
 */
export const LABOR_CATEGORIES = [
  { id: "riggers", label: "Riggers" },
  { id: "hands", label: "Hands" },
  { id: "contractors", label: "Contractors" },
  { id: "harvest", label: "Harvest" },
];

/** Hours for one row: the span times how many people are called. */
export function shiftHours(shift) {
  const { start, end, quantity } = shift;
  if (!start || !end) return 0;

  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some(Number.isNaN)) return 0;

  let minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes < 0) minutes += 24 * 60; // a call that runs past midnight

  const people = Number(quantity) || 1;
  return (minutes / 60) * people;
}

/**
 * Hours and cost per category, plus totals. Rates come from settings unless
 * the PM has overridden them for this request — crews in another city bill
 * differently, and the estimate should reflect what it will actually cost.
 */
export function estimate(shifts, rates) {
  const byCategory = {};
  for (const c of LABOR_CATEGORIES) {
    byCategory[c.id] = { label: c.label, hours: 0, rate: Number(rates?.[c.id]) || 0, cost: 0 };
  }

  let unassigned = 0;

  for (const shift of shifts || []) {
    const hours = shiftHours(shift);
    if (!hours) continue;

    const bucket = byCategory[shift.category];
    if (!bucket) {
      unassigned += hours;
      continue;
    }
    bucket.hours += hours;
  }

  for (const bucket of Object.values(byCategory)) {
    bucket.cost = bucket.hours * bucket.rate;
  }

  return {
    byCategory,
    unassignedHours: unassigned,
    totalHours: Object.values(byCategory).reduce((s, b) => s + b.hours, 0) + unassigned,
    totalCost: Object.values(byCategory).reduce((s, b) => s + b.cost, 0),
  };
}

export function formatHours(n) {
  if (!n) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function formatMoney(n) {
  return `$${(n || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Build the sheet, DM it to payroll, file it, and confirm to the PM. Slack IDs
 * come from the Shiftboard roster, matched by name.
 */
export async function sendLaborRequest({ event, shifts, note, user }) {
  if (!BASE || !KEY) {
    throw new Error("Labor requests aren't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const meta = event.meta || {};
  const crew = event.shiftboardCrew;
  if (!crew?.name) {
    throw new Error("Link a Shiftboard crew on the Timecards tab first — the sheet needs the exact team name.");
  }

  let payroll = null;
  let pm = null;
  try {
    const { people } = await fetchRoster();
    const byName = (n) =>
      people.find((p) => p.name.trim().toLowerCase() === (n || "").trim().toLowerCase());
    payroll = byName(PAYROLL_NAME);
    pm = byName(meta.pmName);
  } catch {
    // The server reports the missing ID more precisely than we can here.
  }

  const linked = event.fileCloudFolder;

  const res = await fetch(`${BASE}/labor/send`, {
    method: "POST",
    headers: { "X-Toolbox-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      showName: meta.showName || "",
      eventDates: dateRange(meta.plannedStart, meta.plannedEnd),
      eventCode: meta.docNumber || "",
      crewName: crew.name,
      pmName: meta.pmName || "",
      note: note || "",
      shifts,
      payrollSlackId: payroll?.slackId || "",
      pmSlackId: pm?.slackId || "",
      laborFolderPath: linked?.path ? `${linked.path}/${LABOR_FOLDER}` : "",
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    const err = new Error(data?.error || `Send failed (${res.status}).`);
    err.needsSlackId = data?.needsSlackId;
    throw err;
  }

  return data;
}

/**
 * Build the sheet and file it in FileCloud without sending anything.
 *
 * A request that went out before the event had a folder linked has nowhere to
 * live; this puts a copy where it belongs after the fact, and lets a PM keep
 * a snapshot of a call they're still working on.
 */
export async function saveLaborRequest({ event, shifts, note }) {
  if (!BASE || !KEY) {
    throw new Error("Labor requests aren't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const meta = event.meta || {};
  const crew = event.shiftboardCrew;
  const linked = event.fileCloudFolder;

  if (!linked?.path) {
    throw new Error("Link a FileCloud folder on the Files tab first.");
  }

  const res = await fetch(`${BASE}/labor/save`, {
    method: "POST",
    headers: { "X-Toolbox-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      showName: meta.showName || "",
      eventDates: dateRange(meta.plannedStart, meta.plannedEnd),
      eventCode: meta.docNumber || "",
      crewName: crew?.name || "",
      pmName: meta.pmName || "",
      note: note || "",
      shifts,
      laborFolderPath: `${linked.path}/${LABOR_FOLDER}`,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Save failed (${res.status}).`);
  }
  return data;
}

function dateRange(start, end) {
  if (!start) return "";
  const fmt = (iso) => {
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  if (!end || end === start) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Default rates from settings, for seeding the override fields. */
export async function defaultRates() {
  const settings = await getSettings();
  return { ...(settings.labor?.rates || {}) };
}
