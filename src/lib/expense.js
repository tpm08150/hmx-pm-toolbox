/**
 * The expense sheet: what a show costs against what it brings in.
 *
 * Every figure here is derived from the event's own data — contracts from
 * Flex, labor from the latest request, subrentals and rental services from
 * sent POs — with room for the PM to correct anything by hand. Percentages
 * are compared against the company's hard cost goals so a show that's
 * drifting shows it early rather than at closeout.
 */
import { summarizeShifts, costOf, CATEGORY_IDS } from "./overtime";
import { perDiemTotal } from "./travel";

/** Which expense block a PO lands in, by account code. */
export const PO_ACCOUNT_ROUTING = {
  // Subrentals, purchases, maintenance
  "4782": "equipment",
  "4500": "equipment",
  "4510": "equipment",
  "4520": "equipment",
  "4570": "equipment",
  "4580": "equipment",
  "4590": "equipment",
  // Services billed through the show and taken off revenue
  "4787": "rentalServices",
  "4785": "rentalServices",
  "5547": "rentalServices",
  "4729": "rentalServices",
  "4795": "rentalServices",
  // Trucking, whether it's a hired truck or a quoted haul
  "4730": "trucking",
  // Labor that isn't ours
  "4640": "labor",
  "4650": "labor",
};

export function routeForAccount(code) {
  return PO_ACCOUNT_ROUTING[String(code || "").trim()] || null;
}

/** A blank sheet, for an event that hasn't been costed yet. */
export function blankExpense() {
  return {
    equipment: [],       // manual lines only; PO lines are derived
    rentalServices: [],
    contracts: [],
    // Corrections to derived PO lines, keyed by PO id.
    poAdjustments: {},   // { [poId]: { cost, dismissed } }
    // A corrected contract value, for when Flex doesn't match what was signed.
    contractOverride: null,
    labor: {
      // Non-Harvest labor invoiced to us, added as needed at closeout.
      invoices: [],      // { id, label, amount }
      actualHours: {},
      overrideEstimate: false,
    },
    // The formula covers our own trucks; a quoted haul goes in `lines`.
    trucking: { trucks: 0, days: 0, miles: 0, lines: [] },
    venue: "",
    notes: "",
  };
}

/**
 * Draw what we can from the rest of the event, leaving anything the PM has
 * edited alone.
 *
 * Only sent POs count — a draft isn't a commitment. A PO line can be given a
 * corrected cost or dismissed outright, since what was ordered and what was
 * invoiced aren't always the same, but the request itself stays in the PO tab
 * either way.
 */
export function derive({ event, settings }) {
  const meta = event.meta || {};
  const stored = { ...blankExpense(), ...(event.expense || {}) };
  const adjustments = stored.poAdjustments || {};

  // ── Contracts ─────────────────────────────────────────────────────────
  // Flex holds the signed value; change orders get added by hand beneath it.
  const manualContracts = (stored.contracts || []).filter((c) => c.source !== "flex");
  const contracts = [];
  const flexAmount = Number(meta.totalPrice) || 0;
  const override = stored.contractOverride;
  if (flexAmount || override != null) {
    contracts.push({
      id: "flex-contract",
      name: meta.showName || "Contract",
      // Flex is the source, but a change order or a correction can land in the
      // contract before it lands in Flex.
      amount: override != null ? Number(override) : flexAmount,
      flexAmount,
      overridden: override != null && Number(override) !== flexAmount,
      source: "flex",
    });
  }
  contracts.push(...manualContracts);

  // ── PO-sourced lines ──────────────────────────────────────────────────
  const sent = event.poRequests || [];
  const poEquipment = [];
  const poServices = [];
  const poTrucking = [];
  const dismissed = [];

  for (const po of sent) {
    const route = routeForAccount(po.accountCode);
    if (route !== "equipment" && route !== "rentalServices" && route !== "trucking") continue;

    const adj = adjustments[po.id] || {};
    const line = {
      id: `po-${po.id}`,
      poId: po.id,
      vendor: po.vendor || "",
      cost: adj.cost != null ? Number(adj.cost) : parseMoney(po.cost),
      originalCost: parseMoney(po.cost),
      adjusted: adj.cost != null && Number(adj.cost) !== parseMoney(po.cost),
      source: "po",
      code: po.code || "",
      block: route,
    };

    if (adj.dismissed) {
      dismissed.push(line);
      continue;
    }
    if (route === "equipment") poEquipment.push(line);
    else if (route === "trucking") poTrucking.push(line);
    else poServices.push(line);
  }

  const keepManual = (list) => (list || []).filter((l) => l.source !== "po");

  // ── Per diem ──────────────────────────────────────────────────────────
  // Requests add up rather than superseding — a second one usually means a
  // traveler was added, not that the first was wrong. Flights and hotels stay
  // out of it; their cost isn't known until someone books them.
  const perDiemLines = [];
  const rate = Number(settings?.perDiemRate) || 59.5;

  for (const request of event.travelRequests || []) {
    if (!request.types?.perDiem) continue;

    let amount = 0;
    let people = 0;
    for (const t of request.travelers || []) {
      if (!t.name?.trim()) continue;
      const total = perDiemTotal(t.departureDate, t.returnDate, rate);
      if (total == null) continue;
      amount += total;
      people += 1;
    }

    if (!amount) continue;
    perDiemLines.push({
      id: `perdiem-${request.id}`,
      vendor: `Per diem — ${people} ${people === 1 ? "traveler" : "travelers"}`,
      cost: amount,
      source: "perdiem",
      sentAt: request.sentAt,
    });
  }

  // ── Labor estimate ────────────────────────────────────────────────────
  // The latest request is the current plan; earlier ones were superseded.
  const requests = event.laborRequests || [];
  const latest = requests.length ? requests[0] : null;

  let estimate = null;
  if (latest && !stored.labor.overrideEstimate) {
    const summary = summarizeShifts(latest.shifts || [], {
      rules: settings?.labor?.otRules,
    });
    estimate = costOf(summary, settings?.labor?.rates || {});
    estimate.sentAt = latest.sentAt;
    estimate.uncategorizedHours = summary.uncategorizedHours;
  }

  const truckingLines = [
    ...((stored.trucking?.lines || []).filter((l) => l.source !== "po")),
    ...poTrucking,
  ];

  return {
    ...stored,
    trucking: { ...blankExpense().trucking, ...stored.trucking, lines: truckingLines },
    contracts,
    equipment: [...keepManual(stored.equipment), ...poEquipment],
    rentalServices: [
      ...(stored.rentalServices || []).filter(
        (l) => l.source !== "po" && l.source !== "perdiem"
      ),
      ...poServices,
      ...perDiemLines,
    ],
    dismissedPoLines: dismissed,
    laborEstimate: estimate,
  };
}

/**
 * Every number the sheet shows.
 *
 * Actual labor replaces the estimate once it's been entered — the estimate is
 * what we thought it would cost, and after the show what it cost is the only
 * figure that matters.
 */
export function calculate({ sheet, settings }) {
  const goals = settings?.expense?.hardCostGoals || {};
  const rates = settings?.labor?.rates || {};
  const truckingConst = settings?.expense?.trucking || {};
  const commissionVenues = settings?.expense?.commissionVenues || [];

  const contractTotal = sum(sheet.contracts, "amount");
  const rentalServicesTotal = sum(sheet.rentalServices, "cost");

  // Rental services are billed through us but aren't ours to keep.
  const revenue = contractTotal - rentalServicesTotal;

  const equipmentTotal = sum(sheet.equipment, "cost");

  // ── Labor ─────────────────────────────────────────────────────────────
  const estimate = sheet.laborEstimate;
  const estimateTotal = estimate?.total || 0;

  const actual = actualLaborCost(sheet.labor, rates);
  const invoiceTotal = sum(sheet.labor?.invoices || [], "amount");
  const actualTotal = actual.total + invoiceTotal;

  const usingActual = actualTotal > 0;
  const laborTotal = usingActual ? actualTotal : estimateTotal;

  // ── Trucking ──────────────────────────────────────────────────────────
  const t = sheet.trucking || {};
  const dayRate = Number(truckingConst.dayRate) || 125;
  const fuelPerMile = Number(truckingConst.fuelPerMile) || 0.17;
  const mpg = Number(truckingConst.mpg) || 6;
  const fuelPrice = Number(truckingConst.fuelPrice) || 4;

  const truckDays = (Number(t.trucks) || 0) * (Number(t.days) || 0) * dayRate;
  const miles = Number(t.miles) || 0;
  const mileage = miles * fuelPerMile + (miles / mpg) * fuelPrice;
  // A quoted haul sits alongside our own trucks rather than replacing them —
  // a show often has both.
  const truckingQuoted = sum(t.lines, "cost");
  const truckingTotal = truckDays + mileage + truckingQuoted;

  // ── Commission ────────────────────────────────────────────────────────
  const venue = commissionVenues.find(
    (v) => v.name && v.name.toLowerCase() === String(sheet.venue || "").toLowerCase()
  );

  let commissionable = 0;
  let commission = 0;
  if (venue) {
    commissionable =
      venue.basis === "net" ? revenue - equipmentTotal - invoiceTotal : revenue;
    commission = commissionable * (Number(venue.rate) || 0);
  }

  // ── Totals ────────────────────────────────────────────────────────────
  const hardCost = equipmentTotal + laborTotal + truckingTotal;
  const hardCostPct = revenue ? hardCost / revenue : 0;
  const commissionPct = revenue ? commission / revenue : 0;

  const overheadPct = Number(goals.overhead) || 0;
  const equipPurchasePct = Number(goals.equipmentPurchases) || 0;
  const profitPct = 1 - hardCostPct - overheadPct - equipPurchasePct - commissionPct;

  const equipPurchaseGoal = revenue * equipPurchasePct;
  // A show running behind on profit eats into the purchase allocation first.
  const equipPurchaseActual =
    profitPct < 0 ? equipPurchaseGoal + profitPct * revenue : equipPurchaseGoal;

  return {
    revenue,
    contractTotal,
    rentalServicesTotal,
    equipmentTotal,
    laborTotal,
    laborEstimateTotal: estimateTotal,
    laborActualTotal: actualTotal,
    usingActual,
    invoiceTotal,
    actualByCategory: actual.byCategory,
    truckingTotal,
    truckDays,
    mileage,
    truckingQuoted,
    hardCost,
    hardCostPct,
    commissionable,
    commission,
    commissionPct,
    commissionVenue: venue || null,
    profitPct,
    profitDollars: revenue * profitPct,
    equipPurchaseGoal,
    equipPurchaseActual,
    // Each block against its goal, so drift shows where it's happening.
    vsGoal: {
      equipment: pctOf(equipmentTotal, revenue, goals.equipment),
      labor: pctOf(laborTotal, revenue, goals.labor),
      trucking: pctOf(truckingTotal, revenue, goals.trucking),
    },
  };
}

/** Actual labor cost from hours worked, using the same OT-aware billing. */
function actualLaborCost(labor, rates) {
  const byCategory = {};
  let total = 0;

  for (const id of CATEGORY_IDS) {
    const entry = labor?.actualHours?.[id] || {};
    const straight = Number(entry.straight) || 0;
    const overtime = Number(entry.overtime) || 0;
    const rate = Number(rates[id]) || 0;
    const billable = straight + overtime * 1.5;
    const cost = billable * rate;

    byCategory[id] = { straight, overtime, billable, rate, cost };
    total += cost;
  }

  return { byCategory, total };
}

function pctOf(amount, revenue, goal) {
  const actual = revenue ? amount / revenue : 0;
  const target = Number(goal) || 0;
  return { actual, goal: target, delta: actual - target };
}

function sum(list, key) {
  return (list || []).reduce((s, item) => s + (Number(item[key]) || 0), 0);
}

/** "$1,234.56" and "1234.56" both mean the same thing on a PO. */
export function parseMoney(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "").replace(/[^0-9.-]/g, "");
  return Number(cleaned) || 0;
}

export function money(n) {
  return `$${(Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function percent(n, digits = 1) {
  return `${((Number(n) || 0) * 100).toFixed(digits)}%`;
}
