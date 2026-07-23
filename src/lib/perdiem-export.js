/**
 * Monthly per diem export. On the 1st, payroll needs every traveler departing
 * that month, in the columns their process already expects.
 *
 * The month is decided by each traveler's departure date, not the Flex event
 * date — those differ (a July trip for a show Flex dates in June), and the
 * payout follows when people actually travel. This also splits correctly when
 * one event's travelers leave in different months.
 *
 * Built in the browser with SheetJS (bundled), reading straight from the
 * events already loaded — no Anvil round trip.
 */
import * as XLSX from "xlsx";
import { perDiemTotal } from "./travel";

const COLUMNS = [
  "event_name",
  "name",
  "departure_city",
  "return_city",
  "final_number",
  "departure_date",
  "return_date",
  "notes",
];

export function buildPerDiemRows(events, year, month, rate) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const rows = [];

  for (const evt of events) {
    const requests = evt.travelRequests || [];

    // If several per-diem requests exist for one event, the latest is the
    // payable truth; earlier drafts were superseded.
    const latestPerDiem = requests
      .filter((r) => r.types?.perDiem)
      .sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))[0];

    if (!latestPerDiem) continue;

    for (const t of latestPerDiem.travelers || []) {
      if (!t.name?.trim()) continue;

      // The traveler's own departure month decides where they land.
      if ((t.departureDate || "").slice(0, 7) !== prefix) continue;

      const total = perDiemTotal(t.departureDate, t.returnDate, rate);
      rows.push({
        event_name: evt.meta?.showName || "",
        name: t.name.trim(),
        departure_city: t.departureCity || "",
        return_city: t.destinationCity || "",
        final_number: total != null ? Number(total.toFixed(2)) : "",
        departure_date: t.departureDate || "",
        return_date: t.returnDate || "",
        notes: latestPerDiem.notes || "",
      });
    }
  }

  rows.sort((a, b) =>
    a.event_name.localeCompare(b.event_name) || a.name.localeCompare(b.name)
  );
  return rows;
}

export function downloadPerDiemWorkbook(rows, year, month) {
  const monthName = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
  });
  const sheetName = `${monthName} Per Diems`.slice(0, 31);

  const data = [COLUMNS, ...rows.map((r) => COLUMNS.map((c) => r[c]))];
  const ws = XLSX.utils.aoa_to_sheet(data);

  ws["!cols"] = [
    { wch: 42 },
    { wch: 20 },
    { wch: 16 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 50 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${monthName}_${year}_Per_Diems.xlsx`);
}

export function perDiemSum(rows) {
  return rows.reduce((sum, r) => sum + (Number(r.final_number) || 0), 0);
}
