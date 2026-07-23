/**
 * Overtime rules.
 *
 * These compute *billable* hours, not a separate OT bucket: an overtime hour
 * bills at 1.5x, so a ten-hour call can be worth anywhere from 10 to 15 hours
 * depending on when it lands. A shift is walked in fifteen-minute slices and
 * each slice is judged once — a slice that is both after midnight and past the
 * eighth hour is still just overtime, never double.
 */

/** Fifteen minutes. Fine enough for real call times, coarse enough to stay quick. */
const SLICE_MINUTES = 15;
const SLICES_PER_HOUR = 60 / SLICE_MINUTES;

export const OT_MULTIPLIER = 1.5;

/**
 * The four ways labor bills. IATSE covers both hands and riggers — same union
 * rules, different rates.
 */
export const LABOR_CATEGORIES = [
  { id: "hands", label: "Hands", union: "iatse" },
  { id: "riggers", label: "Riggers", union: "iatse" },
  { id: "contractors", label: "Contractors", union: "contractor" },
  { id: "harvest", label: "Harvest", union: "harvest" },
];

export const CATEGORY_IDS = LABOR_CATEGORIES.map((c) => c.id);

/**
 * Default rules, overridable in settings.
 *
 *   dailyAfter    hours in one call before overtime starts
 *   nightBefore   hour of the morning that overtime runs until (8 = 8am)
 *   weeklyAfter   hours per person across the whole show before overtime
 */
export const DEFAULT_OT_RULES = {
  hands: { dailyAfter: 8, nightBefore: 8, weeklyAfter: null },
  riggers: { dailyAfter: 8, nightBefore: 8, weeklyAfter: null },
  contractors: { dailyAfter: 10, nightBefore: null, weeklyAfter: null },
  harvest: { dailyAfter: null, nightBefore: null, weeklyAfter: 40 },
};

/** Holidays that bill as overtime for everyone, by month and day. */
export const DEFAULT_HOLIDAYS = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 7, day: 4, name: "Independence Day" },
  { month: 12, day: 25, name: "Christmas Day" },
  { month: 5, day: -1, name: "Memorial Day", rule: "lastMonday" },
  { month: 9, day: 1, name: "Labor Day", rule: "firstMonday" },
  { month: 11, day: 4, name: "Thanksgiving", rule: "fourthThursday" },
];

/** The floating holidays land on a different date each year. */
export function holidayDates(year, holidays = DEFAULT_HOLIDAYS) {
  const out = [];

  for (const h of holidays) {
    let date;
    if (h.rule === "lastMonday") {
      date = new Date(year, h.month, 0); // last day of the month
      while (date.getDay() !== 1) date.setDate(date.getDate() - 1);
    } else if (h.rule === "firstMonday") {
      date = new Date(year, h.month - 1, 1);
      while (date.getDay() !== 1) date.setDate(date.getDate() + 1);
    } else if (h.rule === "fourthThursday") {
      date = new Date(year, h.month - 1, 1);
      let count = 0;
      while (count < 4) {
        if (date.getDay() === 4) count += 1;
        if (count < 4) date.setDate(date.getDate() + 1);
      }
    } else {
      date = new Date(year, h.month - 1, h.day);
    }
    out.push({ iso: isoOf(date), name: h.name });
  }

  return out;
}

function isoOf(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every holiday ISO date across the years a show touches. */
export function holidaySet(dates, holidays = DEFAULT_HOLIDAYS) {
  const years = new Set(
    dates.filter(Boolean).map((d) => Number(String(d).slice(0, 4))).filter(Boolean)
  );
  const set = new Set();
  for (const year of years) {
    for (const h of holidayDates(year, holidays)) set.add(h.iso);
  }
  return set;
}

/**
 * Split one shift into straight and overtime hours for a single person.
 *
 * Returns hours per person; multiply by how many people were called to get the
 * shift's total. `priorWeekly` carries hours already worked on this show, for
 * the categories with a weekly threshold.
 */
export function splitShift({ date, start, end, rules, holidays, priorWeekly = 0 }) {
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  if (startMin == null || endMin == null) {
    return { straight: 0, overtime: 0, total: 0 };
  }

  // A call that ends before it starts ran past midnight.
  let span = endMin - startMin;
  if (span <= 0) span += 24 * 60;

  const slices = Math.round((span / 60) * SLICES_PER_HOUR);
  const isHoliday = date && holidays?.has(date);

  let straightSlices = 0;
  let otSlices = 0;
  let weeklySoFar = priorWeekly;

  for (let i = 0; i < slices; i++) {
    const minuteOfShift = i * SLICE_MINUTES;
    const clockMinute = (startMin + minuteOfShift) % (24 * 60);
    const hoursWorkedSoFar = minuteOfShift / 60;

    // Each condition is checked once and the slice is either overtime or it
    // isn't — a slice that is both after midnight and past the eighth hour is
    // still a single overtime slice.
    const nightOt =
      rules.nightBefore != null && clockMinute < rules.nightBefore * 60;
    const dailyOt =
      rules.dailyAfter != null && hoursWorkedSoFar >= rules.dailyAfter;
    const weeklyOt =
      rules.weeklyAfter != null && weeklySoFar >= rules.weeklyAfter;

    if (isHoliday || nightOt || dailyOt || weeklyOt) {
      otSlices += 1;
    } else {
      straightSlices += 1;
    }

    weeklySoFar += 1 / SLICES_PER_HOUR;
  }

  const straight = straightSlices / SLICES_PER_HOUR;
  const overtime = otSlices / SLICES_PER_HOUR;

  return { straight, overtime, total: straight + overtime };
}

function toMinutes(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Roll a set of shifts up into straight and overtime hours per category.
 *
 * Weekly thresholds are tracked per person, and a person is identified by
 * category, role, and location — the same lead audio at the same venue is one
 * person across the run, while two rows of hands at different venues are not.
 * Each row's quantity is that many distinct people working the same hours, so
 * the split is computed once per person and multiplied.
 */
export function summarizeShifts(shifts, { rules = DEFAULT_OT_RULES, holidays } = {}) {
  const dates = (shifts || []).map((s) => s.date);
  const holidaySet_ = holidays || holidaySet(dates);

  const totals = {};
  for (const id of CATEGORY_IDS) {
    totals[id] = { straight: 0, overtime: 0, billable: 0 };
  }
  let uncategorized = 0;

  // Shifts have to be walked in order for a weekly threshold to mean anything.
  const ordered = [...(shifts || [])].sort((a, b) => {
    const byDate = String(a.date || "").localeCompare(String(b.date || ""));
    if (byDate !== 0) return byDate;
    return String(a.start || "").localeCompare(String(b.start || ""));
  });

  const weeklyByPerson = {};

  for (const shift of ordered) {
    const category = shift.category;
    const rule = rules[category];

    if (!category || !totals[category]) {
      const span = splitShift({
        date: shift.date,
        start: shift.start,
        end: shift.end,
        rules: { dailyAfter: null, nightBefore: null, weeklyAfter: null },
        holidays: new Set(),
      });
      uncategorized += span.total * (Number(shift.quantity) || 1);
      continue;
    }

    const key = `${category}|${(shift.role || "").trim().toLowerCase()}|${(shift.location || "").trim().toLowerCase()}`;
    const prior = weeklyByPerson[key] || 0;

    const split = splitShift({
      date: shift.date,
      start: shift.start,
      end: shift.end,
      rules: rule || {},
      holidays: holidaySet_,
      priorWeekly: prior,
    });

    // The threshold is per person, so a row of six hands adds one person's
    // hours to the running total, not six.
    weeklyByPerson[key] = prior + split.total;

    const people = Number(shift.quantity) || 1;
    totals[category].straight += split.straight * people;
    totals[category].overtime += split.overtime * people;
  }

  for (const id of CATEGORY_IDS) {
    const t = totals[id];
    t.billable = t.straight + t.overtime * OT_MULTIPLIER;
  }

  return { byCategory: totals, uncategorizedHours: uncategorized };
}

/** Cost of a summary, given hourly rates keyed by category. */
export function costOf(summary, rates) {
  const out = {};
  let total = 0;

  for (const id of CATEGORY_IDS) {
    const t = summary.byCategory[id];
    const rate = Number(rates?.[id]) || 0;
    const cost = t.billable * rate;
    out[id] = { ...t, rate, cost };
    total += cost;
  }

  return { byCategory: out, total };
}
