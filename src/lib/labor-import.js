/**
 * Reading a labor request back out of a Shiftboard template.
 *
 * Most of a returning show's call is last year's call with new dates, so an
 * import that keeps the shape and moves the whole thing forward saves more
 * work than retyping thirty rows.
 */
import * as XLSX from "xlsx";

/**
 * Column order from Shiftboard's template. Data starts at row 7; rows 1-6 are
 * their header block.
 */
const COLUMNS = [
  "date", "start", "end", "hours", "minutes", "subject", "crew", "role",
  "quantity", "assigned", "department", "location", "roomFloor", "details",
  "publish", "eventCode", "trucks", "notify",
];

const FIRST_DATA_ROW = 7;

/**
 * What each role bills as.
 *
 * Hands and riggers are IATSE at different rates; the video positions we hire
 * out are contractors. Everything else is our own crew, so Harvest is the
 * default rather than a blank a PM has to fill in thirty times.
 */
const ROLE_CATEGORIES = [
  { match: /^(hands?|loaders?|fork\s*op)$/i, category: "hands" },
  { match: /^(up|down|lead)\s*rigger$/i, category: "riggers" },
  { match: /^riggers?$/i, category: "riggers" },
  {
    match: /^(v1|v2|switcher\s*op|camera\s*op|prompter\s*op|e2\s*\/?\s*spyder\s*op)$/i,
    category: "contractors",
  },
];

/** Where a role with no rule lands. */
export const DEFAULT_CATEGORY = "harvest";

export function categoryForRole(role) {
  const name = String(role || "").trim();
  if (!name) return "";
  for (const rule of ROLE_CATEGORIES) {
    if (rule.match.test(name)) return rule.category;
  }
  return DEFAULT_CATEGORY;
}

/**
 * Pull shifts out of a workbook.
 *
 * Excel stores dates and times as numbers, and a file that's been round-
 * tripped through Google Sheets or a text editor may have them as strings
 * instead — both shapes turn up in real files, so both are handled.
 */
export async function parseLaborFile(file) {
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });

  const sheet =
    wb.Sheets["Labor Request"] || wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("That file has no sheets in it.");

  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    dateNF: "yyyy-mm-dd",
    blankrows: false,
    defval: "",
  });

  const shifts = [];
  const seenHeader = looksLikeTemplate(rows);

  const startAt = seenHeader ? FIRST_DATA_ROW - 1 : 0;

  for (let i = startAt; i < rows.length; i++) {
    const row = rows[i] || [];
    const record = {};
    COLUMNS.forEach((key, idx) => {
      record[key] = clean(row[idx]);
    });

    // A row without a date isn't a shift.
    const date = toIsoDate(record.date);
    if (!date) continue;

    shifts.push({
      id: crypto.randomUUID(),
      date,
      start: toTime(record.start),
      end: toTime(record.end),
      subject: record.subject,
      role: record.role,
      quantity: Number(record.quantity) || 1,
      category: categoryForRole(record.role),
      department: record.department,
      location: record.location,
      roomFloor: record.roomFloor,
      details: record.details,
      trucks: record.trucks,
      publish: record.publish || "Yes",
      notify: record.notify || "Yes",
    });
  }

  if (!shifts.length) {
    throw new Error(
      "No shifts found. The sheet needs dates in column A, starting at row 7."
    );
  }

  return {
    shifts,
    crewName: firstNonEmpty(shifts.map((s) => s.crew)) || "",
    // Only a row with no role at all comes through uncategorized now.
    uncategorized: shifts.filter((s) => !s.category).length,
    earliest: shifts.reduce((a, s) => (!a || s.date < a ? s.date : a), null),
  };
}

/** Rows 1-6 are Shiftboard's; a file without them is probably a plain export. */
function looksLikeTemplate(rows) {
  const first = String(rows?.[0]?.[0] || "").toLowerCase();
  return first.includes("shift upload template");
}

/**
 * Move every shift so the earliest one lands on a new date, keeping the gaps
 * between days intact — a four-day load-in stays four days.
 */
export function shiftDates(shifts, newStart) {
  if (!newStart || !shifts.length) return shifts;

  const earliest = shifts.reduce((a, s) => (!a || s.date < a ? s.date : a), null);
  if (!earliest) return shifts;

  const offset = daysBetween(earliest, newStart);
  if (!offset) return shifts;

  return shifts.map((s) => ({ ...s, date: addDays(s.date, offset) }));
}

function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T12:00:00`);
  const b = new Date(`${toIso}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b - a) / 86400000);
}

function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Excel dates arrive as Date objects, serial numbers, or text. */
function toIsoDate(value) {
  if (!value) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }

  const text = String(value).trim();
  if (!text) return "";

  // Already ISO.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // m/d/yyyy or m/d/yy, which is what the template shows.
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    let [, m, d, y] = us;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  }
  return "";
}

/** Times come back as "2:00 PM", "14:00", or a fraction of a day. */
function toTime(value) {
  if (!value && value !== 0) return "";

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
  }

  const text = String(value).trim();
  if (!text) return "";

  const ampm = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp])\.?[Mm]\.?$/);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === "p") hour += 12;
    return `${pad(hour)}:${ampm[2]}`;
  }

  const plain = text.match(/^(\d{1,2}):(\d{2})/);
  if (plain) return `${pad(plain[1])}:${plain[2]}`;

  // A bare fraction is Excel's way of storing a time of day.
  const fraction = Number(text);
  if (!Number.isNaN(fraction) && fraction > 0 && fraction < 1) {
    const minutes = Math.round(fraction * 24 * 60);
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }

  return "";
}

function clean(value) {
  if (value == null) return "";
  if (value instanceof Date) return value;
  return String(value).trim();
}

function firstNonEmpty(list) {
  return (list || []).find((v) => v && String(v).trim()) || "";
}

function pad(n) {
  return String(n).padStart(2, "0");
}
