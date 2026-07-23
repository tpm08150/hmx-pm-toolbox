/**
 * Production report export: one PDF covering a date range, with a page per
 * event and then a section per technician summarizing their reviews.
 *
 * Built in the browser with jsPDF. The data is already in Firestore, so this
 * needs no server round trip.
 */
import { jsPDF } from "jspdf";

const MARGIN = 54; // points, ~0.75in
const PAGE_W = 612;
const PAGE_H = 792;
const BODY_W = PAGE_W - MARGIN * 2;

const RATING_FIELDS = [
  ["attitude", "Attitude"],
  ["technical", "Technical"],
  ["prep", "Prep"],
  ["customerService", "Cust. Service"],
];

/**
 * Events in range that have a submitted production report, sorted by date.
 * Range bounds are YYYY-MM-DD, inclusive, matched against the Flex event date.
 */
export function reportsInRange(events, start, end) {
  return events
    .filter((e) => {
      const d = (e.meta?.plannedStart || "").slice(0, 10);
      if (!d) return false;
      if (start && d < start) return false;
      if (end && d > end) return false;
      return !!e.productionReport?.submittedAt;
    })
    .sort((a, b) =>
      (a.meta?.plannedStart || "").localeCompare(b.meta?.plannedStart || "")
    );
}

/**
 * Roll every review up by technician. A tech who worked four shows in the
 * range gets one section with all four sets of notes and one average.
 */
export function summarizeTechs(events) {
  const byTech = new Map();

  for (const evt of events) {
    const reviews = evt.productionReport?.techReviews || [];
    for (const r of reviews) {
      const name = (r.name || "").trim();
      if (!name) continue;

      const key = name.toLowerCase();
      if (!byTech.has(key)) byTech.set(key, { name, entries: [] });

      byTech.get(key).entries.push({
        showName: evt.meta?.showName || "Untitled",
        date: evt.meta?.plannedStart || "",
        role: r.role || "",
        scores: Object.fromEntries(
          RATING_FIELDS.map(([f]) => [f, Number(r[f]) || null])
        ),
        notes: (r.notes || "").trim(),
      });
    }
  }

  const techs = [...byTech.values()];

  for (const tech of techs) {
    // Overall average across every score the tech received in the range.
    const all = tech.entries.flatMap((e) =>
      Object.values(e.scores).filter((v) => v != null)
    );
    tech.average = all.length
      ? all.reduce((a, b) => a + b, 0) / all.length
      : null;

    // Per-category averages, so a strong tech with a prep problem shows it.
    tech.categoryAverages = {};
    for (const [field, label] of RATING_FIELDS) {
      const vals = tech.entries.map((e) => e.scores[field]).filter((v) => v != null);
      tech.categoryAverages[label] = vals.length
        ? vals.reduce((a, b) => a + b, 0) / vals.length
        : null;
    }
    tech.showCount = tech.entries.length;
  }

  techs.sort((a, b) => a.name.localeCompare(b.name));
  return techs;
}

export function buildProductionReportPdf(events, start, end) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let first = true;

  // ── One page per event ────────────────────────────────────────────────
  for (const evt of events) {
    if (!first) doc.addPage();
    first = false;
    renderEventPage(doc, evt);
  }

  // ── Then a technician summary ─────────────────────────────────────────
  const techs = summarizeTechs(events);
  if (techs.length) {
    doc.addPage();
    renderTechSummary(doc, techs, start, end);
  }

  if (first) {
    // Nothing at all in range — still produce a page saying so.
    doc.setFont("helvetica", "normal").setFontSize(11);
    doc.text("No production reports were submitted in this range.", MARGIN, MARGIN + 20);
  }

  addFooters(doc, start, end);
  return doc;
}

function renderEventPage(doc, evt) {
  const meta = evt.meta || {};
  const report = evt.productionReport || {};
  let y = MARGIN;

  doc.setFont("helvetica", "bold").setFontSize(16);
  y = writeWrapped(doc, meta.showName || "Untitled event", MARGIN, y, BODY_W, 19);
  y += 4;

  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(107, 118, 131);
  const facts = [
    dateRange(meta.plannedStart, meta.plannedEnd),
    meta.venue,
    meta.pmName && meta.pmName !== "un-assigned" ? `PM: ${meta.pmName}` : null,
    meta.docNumber,
  ].filter(Boolean);
  y = writeWrapped(doc, facts.join("   ·   "), MARGIN, y + 10, BODY_W, 13);
  doc.setTextColor(20, 24, 29);

  y += 8;
  doc.setDrawColor(214, 218, 224).line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 18;

  for (const [key, heading] of [
    ["wentWell", "What went well"],
    ["wentWrong", "What didn't go well"],
    ["nextYear", "What we can improve next year"],
  ]) {
    const text = (report[key] || "").trim();
    y = section(doc, heading, text || "—", y);
    if (y > PAGE_H - MARGIN - 60) {
      doc.addPage();
      y = MARGIN;
    }
  }

  const reviews = (report.techReviews || []).filter((r) => (r.name || "").trim());
  if (reviews.length) {
    y += 6;
    doc.setFont("helvetica", "bold").setFontSize(11);
    doc.text("Crew", MARGIN, y);
    y += 14;

    doc.setFont("helvetica", "normal").setFontSize(9);
    for (const r of reviews) {
      if (y > PAGE_H - MARGIN - 30) {
        doc.addPage();
        y = MARGIN;
      }
      const scores = RATING_FIELDS
        .map(([f, label]) => `${label} ${r[f] || "—"}`)
        .join("   ");
      const line = `${r.name}${r.role ? ` (${r.role})` : ""}    ${scores}`;
      y = writeWrapped(doc, line, MARGIN, y, BODY_W, 12);

      if ((r.notes || "").trim()) {
        doc.setTextColor(107, 118, 131);
        y = writeWrapped(doc, r.notes.trim(), MARGIN + 12, y + 2, BODY_W - 12, 11);
        doc.setTextColor(20, 24, 29);
      }
      y += 6;
    }
  }
}

function renderTechSummary(doc, techs, start, end) {
  let y = MARGIN;

  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text("Technician summary", MARGIN, y);
  y += 18;

  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(107, 118, 131);
  doc.text(`${fmtDay(start)} to ${fmtDay(end)}`, MARGIN, y);
  doc.setTextColor(20, 24, 29);
  y += 16;

  doc.setDrawColor(214, 218, 224).line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 20;

  for (const tech of techs) {
    // Keep a name with at least its averages line.
    if (y > PAGE_H - MARGIN - 70) {
      doc.addPage();
      y = MARGIN;
    }

    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text(tech.name, MARGIN, y);

    if (tech.average != null) {
      const avg = tech.average.toFixed(2);
      doc.setFont("helvetica", "bold").setFontSize(12);
      doc.text(`${avg}`, PAGE_W - MARGIN, y, { align: "right" });
    }
    y += 13;

    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(107, 118, 131);
    const cats = Object.entries(tech.categoryAverages)
      .filter(([, v]) => v != null)
      .map(([label, v]) => `${label} ${v.toFixed(1)}`)
      .join("   ");
    const showWord = tech.showCount === 1 ? "show" : "shows";
    doc.text(`${tech.showCount} ${showWord}   ·   ${cats}`, MARGIN, y);
    doc.setTextColor(20, 24, 29);
    y += 14;

    doc.setFontSize(9);
    for (const e of tech.entries) {
      if (y > PAGE_H - MARGIN - 24) {
        doc.addPage();
        y = MARGIN;
      }
      const scores = RATING_FIELDS
        .map(([f, label]) => `${label} ${e.scores[f] ?? "—"}`)
        .join("  ");
      doc.setFont("helvetica", "bold");
      y = writeWrapped(
        doc,
        `${fmtDay(e.date)}  ${e.showName}${e.role ? ` — ${e.role}` : ""}`,
        MARGIN + 10,
        y,
        BODY_W - 10,
        11
      );
      doc.setFont("helvetica", "normal").setTextColor(107, 118, 131);
      y = writeWrapped(doc, scores, MARGIN + 10, y, BODY_W - 10, 11);
      if (e.notes) {
        y = writeWrapped(doc, e.notes, MARGIN + 10, y, BODY_W - 10, 11);
      }
      doc.setTextColor(20, 24, 29);
      y += 5;
    }

    y += 10;
  }
}

function section(doc, heading, text, y) {
  doc.setFont("helvetica", "bold").setFontSize(11);
  doc.text(heading, MARGIN, y);
  y += 14;
  doc.setFont("helvetica", "normal").setFontSize(10);
  y = writeWrapped(doc, text, MARGIN, y, BODY_W, 13);
  return y + 14;
}

/** Write text with wrapping, paging when it runs off the bottom. */
function writeWrapped(doc, text, x, y, width, lineHeight) {
  const lines = doc.splitTextToSize(String(text || ""), width);
  for (const line of lines) {
    if (y > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
    doc.text(line, x, y);
    y += lineHeight;
  }
  return y;
}

function addFooters(doc, start, end) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(107, 118, 131);
    doc.text(`HMX Production Reports  ·  ${fmtDay(start)} – ${fmtDay(end)}`, MARGIN, PAGE_H - 32);
    doc.text(`${i} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 32, { align: "right" });
    doc.setTextColor(20, 24, 29);
  }
}

function dateRange(start, end) {
  if (!start) return "";
  if (!end || start === end) return fmtDay(start);
  return `${fmtDay(start)} – ${fmtDay(end)}`;
}

function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function downloadProductionReportPdf(events, start, end) {
  const doc = buildProductionReportPdf(events, start, end);
  doc.save(`HMX_Production_Reports_${start}_to_${end}.pdf`);
}
