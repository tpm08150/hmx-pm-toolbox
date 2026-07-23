/**
 * The budget dashboard: every show being tracked, grouped by period.
 *
 * A budget starts being watched once its labor request goes out — that's the
 * point where a PM has committed real money and the numbers stop being
 * hypothetical. Small shows are left out entirely; below the threshold nobody
 * builds a sheet.
 */
import { derive, calculate } from "./expense";

export const PERIODS = [
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Is this event being tracked?
 *
 * The labor request is the trigger — before that a show is still a quote, and
 * a budget sheet with no labor in it would read as wildly profitable.
 */
export function isTracked(event, threshold = 10000) {
  if (!(event.laborRequests || []).length) return false;
  return (Number(event.meta?.totalPrice) || 0) >= Number(threshold || 0);
}

/**
 * Which period an event belongs to, by end date — a show that loads in on the
 * 28th and strikes on the 3rd belongs to the month it finished in, since
 * that's when its costs land.
 */
export function periodKeyFor(event, period) {
  const iso = (event.meta?.plannedEnd || event.meta?.plannedStart || "").slice(0, 10);
  if (!iso) return null;

  const [year, month] = iso.split("-").map(Number);
  if (!year || !month) return null;

  if (period === "year") return { key: String(year), label: String(year), year, sort: year * 100 };

  if (period === "quarter") {
    const q = Math.ceil(month / 3);
    return {
      key: `${year}-Q${q}`,
      label: `Q${q} ${year}`,
      year,
      quarter: q,
      sort: year * 100 + q,
    };
  }

  return {
    key: `${year}-${String(month).padStart(2, "0")}`,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    year,
    month,
    sort: year * 100 + month,
  };
}

/**
 * Cost out every tracked event and group it.
 *
 * Returns groups newest first, each with its events and a rollup. Percentages
 * in the rollup are revenue-weighted rather than averaged — a $200k show and a
 * $12k show shouldn't count equally toward the month's margin.
 */
export function buildDashboard({ events, settings, period = "month" }) {
  const threshold = settings?.expense?.budgetThreshold ?? 10000;

  const rows = [];
  for (const event of events || []) {
    if (!isTracked(event, threshold)) continue;

    const sheet = derive({ event, settings });
    const totals = calculate({ sheet, settings });
    const bucket = periodKeyFor(event, period);
    if (!bucket) continue;

    rows.push({
      id: event.id,
      name: event.meta?.showName || "Untitled",
      docNumber: event.meta?.docNumber || "",
      pmName: event.meta?.pmName || "",
      start: event.meta?.plannedStart || "",
      end: event.meta?.plannedEnd || "",
      venue: event.meta?.venue || "",
      bucket,
      totals,
      sheet,
    });
  }

  const groups = new Map();
  for (const row of rows) {
    const { key } = row.bucket;
    if (!groups.has(key)) {
      groups.set(key, { ...row.bucket, events: [] });
    }
    groups.get(key).events.push(row);
  }

  const out = [...groups.values()].map((g) => ({
    ...g,
    events: g.events.sort((a, b) => (a.end || "").localeCompare(b.end || "")),
    rollup: rollup(g.events, settings),
  }));

  out.sort((a, b) => b.sort - a.sort);
  return { groups: out, trackedCount: rows.length };
}

/**
 * Add a set of events together.
 *
 * Dollars sum; percentages are recomputed from the summed dollars, because an
 * average of percentages weights a small show the same as a large one and
 * quietly misstates the month.
 */
export function rollup(events, settings) {
  const goals = settings?.expense?.hardCostGoals || {};

  const t = {
    revenue: 0,
    contractTotal: 0,
    rentalServicesTotal: 0,
    equipmentTotal: 0,
    laborTotal: 0,
    laborEstimateTotal: 0,
    laborActualTotal: 0,
    truckingTotal: 0,
    hardCost: 0,
    commission: 0,
    count: events.length,
    onActual: 0,
  };

  for (const e of events) {
    const x = e.totals;
    t.revenue += x.revenue;
    t.contractTotal += x.contractTotal;
    t.rentalServicesTotal += x.rentalServicesTotal;
    t.equipmentTotal += x.equipmentTotal;
    t.laborTotal += x.laborTotal;
    t.laborEstimateTotal += x.laborEstimateTotal;
    t.laborActualTotal += x.laborActualTotal;
    t.truckingTotal += x.truckingTotal;
    t.hardCost += x.hardCost;
    t.commission += x.commission;
    if (x.usingActual) t.onActual += 1;
  }

  const rev = t.revenue;
  t.hardCostPct = rev ? t.hardCost / rev : 0;
  t.commissionPct = rev ? t.commission / rev : 0;

  const overheadPct = Number(goals.overhead) || 0;
  const equipPurchasePct = Number(goals.equipmentPurchases) || 0;
  t.profitPct = 1 - t.hardCostPct - overheadPct - equipPurchasePct - t.commissionPct;
  t.profitDollars = rev * t.profitPct;

  t.vsGoal = {
    equipment: pctOf(t.equipmentTotal, rev, goals.equipment),
    labor: pctOf(t.laborTotal, rev, goals.labor),
    trucking: pctOf(t.truckingTotal, rev, goals.trucking),
  };

  return t;
}

function pctOf(amount, revenue, goal) {
  const actual = revenue ? amount / revenue : 0;
  const target = Number(goal) || 0;
  return { actual, goal: target, delta: actual - target };
}

/** Short date range for a row. */
export function dateRange(start, end) {
  if (!start) return "";
  const fmt = (iso) => {
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  };
  const year = String(end || start).slice(2, 4);
  if (!end || end === start) return `${fmt(start)}/${year}`;
  return `${fmt(start)} – ${fmt(end)}/${year}`;
}
