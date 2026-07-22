import { useState, useEffect, useMemo } from "react";
import { listEvents, upsertEventFromFlex } from "../lib/firebase";
import { fetchEventsSmart, isRealEvent } from "../lib/anvil";
import { deriveStatus, overallProgress } from "../lib/checklist";

/**
 * Status sorts by where an event sits in its lifecycle, not alphabetically —
 * "Not started" before "On site" before "Closed" is the order a PM thinks in.
 */
const STATUS_ORDER = {
  unscheduled: 0,
  "not-started": 1,
  planning: 2,
  ready: 3,
  onsite: 4,
  post: 5,
  closed: 6,
};

const COLUMNS = [
  { id: "docNumber", label: "Doc", width: 92, sortable: true },
  { id: "showName", label: "Show", sortable: true },
  { id: "dates", label: "Dates", width: 148, sortable: true },
  { id: "pmName", label: "PM", width: 130, sortable: true },
  { id: "status", label: "Status", width: 110, sortable: true },
  { id: "checklist", label: "Checklist", width: 118, sortable: true },
];

const RANGES = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past year" },
  { id: "all", label: "All events" },
];

export default function EventList({ onOpen, user }) {
  const [events, setEvents] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [range, setRange] = useState("upcoming");
  const [pmFilter, setPmFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "dates", dir: "asc" });

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setEvents(await listEvents());
    } catch (e) {
      setError(e.message);
    }
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    setMessage(null);
    setProgress({ done: 0, total: 0, label: "Starting" });

    try {
      // Events already carrying a real PM don't need their header re-read.
      // After the first sync that's most of them, so most windows run cheap.
      const known = new Set(
        (events || [])
          .filter((e) => e.meta?.pmName && e.meta.pmName !== "un-assigned")
          .map((e) => e.id)
      );

      const flexEvents = await fetchEventsSmart({
        knownIds: known,
        onProgress: setProgress,
      });

      const real = flexEvents.filter((e) => isRealEvent(e));
      setProgress({ done: 0, total: real.length, label: "Saving", saving: true });

      let created = 0;
      let updated = 0;
      for (let i = 0; i < real.length; i++) {
        const result = await upsertEventFromFlex(real[i]);
        if (result === "created") created += 1;
        else if (result === "touched") updated += 1;
        if (i % 5 === 0) {
          setProgress({ done: i + 1, total: real.length, label: "Saving", saving: true });
        }
      }

      const skipped = flexEvents.length - real.length;
      setMessage(
        `Synced ${real.length} events — ${created} new, ${updated} updated.` +
          (skipped ? ` ${skipped} filtered out.` : "")
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
      setProgress(null);
    }
  }

  // Every PM who owns at least one event, for the filter dropdown.
  const pmOptions = useMemo(() => {
    if (!events) return [];
    const counts = new Map();
    for (const evt of events) {
      const pm = evt.meta?.pmName || "un-assigned";
      counts.set(pm, (counts.get(pm) || 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => {
        if (a[0] === "un-assigned") return 1;
        if (b[0] === "un-assigned") return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, count]) => ({ name, count }));
  }, [events]);

  const rows = useMemo(() => {
    if (!events) return [];

    const decorated = events.map((evt) => ({
      ...evt,
      status: deriveStatus(evt),
      progress: overallProgress(evt),
    }));

    const filtered = decorated.filter((evt) => {
      if (!inRange(evt, range)) return false;
      if (pmFilter !== "all" && (evt.meta?.pmName || "un-assigned") !== pmFilter) {
        return false;
      }
      if (search) {
        const hay = `${evt.meta?.showName} ${evt.meta?.docNumber} ${evt.meta?.venue}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => compare(a, b, sort.key) * dir);
  }, [events, range, pmFilter, search, sort]);

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  // Looking backward, most recent first is the useful default.
  function changeRange(next) {
    setRange(next);
    if (next === "past" && sort.key === "dates" && sort.dir === "asc") {
      setSort({ key: "dates", dir: "desc" });
    }
    if (next === "upcoming" && sort.key === "dates" && sort.dir === "desc") {
      setSort({ key: "dates", dir: "asc" });
    }
  }

  if (error && events === null) {
    return <div className="banner banner-error">{error}</div>;
  }

  if (events === null) {
    return <div className="loading">Loading events…</div>;
  }

  return (
    <div>
      <div className="list-head">
        <div>
          <div className="eyebrow">Production management</div>
          <h1>Events</h1>
        </div>
        <div className="list-head-spacer" />
        <button className="btn btn-primary" onClick={sync} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync from Flex"}
        </button>
      </div>

      {progress && (
        <div className="banner banner-info">
          <span>
            {progress.saving
              ? `Saving ${progress.done} of ${progress.total}…`
              : `Reading Flex — ${progress.label}${progress.detailed ? " (new events, reading detail)" : ""} · ${progress.found ?? 0} found`}
          </span>
          <div className="banner-spacer" />
          <div className="bar" style={{ width: 120 }}>
            <div
              className="bar-fill"
              style={{
                width: progress.total
                  ? `${(progress.done / progress.total) * 100}%`
                  : "0%",
              }}
            />
          </div>
        </div>
      )}

      {message && (
        <div className="banner banner-info">
          {message}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {error && (
        <div className="banner banner-error">
          {error}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="filters">
        <input
          className="input"
          style={{ maxWidth: 230 }}
          placeholder="Search show, doc number, venue"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <select
          className="select"
          style={{ maxWidth: 150 }}
          value={range}
          onChange={(e) => changeRange(e.target.value)}
          aria-label="Filter by date range"
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          className="select"
          style={{ maxWidth: 190 }}
          value={pmFilter}
          onChange={(e) => setPmFilter(e.target.value)}
          aria-label="Filter by production manager"
        >
          <option value="all">All PMs</option>
          {pmOptions.map((pm) => (
            <option key={pm.name} value={pm.name}>
              {pm.name} ({pm.count})
            </option>
          ))}
        </select>

        <div style={{ flex: 1 }} />
        <span className="muted mono" style={{ fontSize: 12 }}>
          {rows.length} {rows.length === 1 ? "event" : "events"}
        </span>
      </div>

      {!rows.length ? (
        <div className="empty">
          <p>
            {events.length
              ? "No events match those filters."
              : "No events yet. Sync from Flex to pull in the calendar."}
          </p>
          {!events.length && (
            <button className="btn btn-primary" onClick={sync} disabled={syncing}>
              Sync from Flex
            </button>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="event-table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.id} style={col.width ? { width: col.width } : undefined}>
                    {col.sortable ? (
                      <button
                        className={`th-sort${sort.key === col.id ? " th-sort-active" : ""}`}
                        onClick={() => toggleSort(col.id)}
                        aria-label={`Sort by ${col.label}`}
                      >
                        {col.label}
                        <span className="th-caret">
                          {sort.key === col.id ? (sort.dir === "asc" ? "▲" : "▼") : "▾"}
                        </span>
                      </button>
                    ) : (
                      col.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((evt) => (
                <tr className="event-row" key={evt.id} onClick={() => onOpen(evt.id)}>
                  <td className="doc-num">{evt.meta?.docNumber || "—"}</td>
                  <td>
                    <div className="event-name">{evt.meta?.showName || "Untitled"}</div>
                    {evt.meta?.venue && <div className="muted" style={{ fontSize: 12 }}>{evt.meta.venue}</div>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {formatRange(evt.meta?.plannedStart, evt.meta?.plannedEnd)}
                  </td>
                  <td style={{ fontSize: 13 }}>
                    <span className={evt.meta?.pmName === "un-assigned" ? "unassigned" : ""}>
                      {evt.meta?.pmName || "—"}
                    </span>
                  </td>
                  <td>
                    <span className={`pill pill-${evt.status.id}`}>{evt.status.label}</span>
                  </td>
                  <td>
                    <div className="progress-cell">
                      <div className="bar">
                        <div
                          className="bar-fill"
                          style={{ width: `${(evt.progress.done / evt.progress.total) * 100}%` }}
                        />
                      </div>
                      <span className="mono" style={{ fontSize: 11 }}>
                        {evt.progress.done}/{evt.progress.total}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * An event that started yesterday and runs through Friday is still ahead of
 * you, so the boundary is the end date, not the start.
 */
function inRange(evt, range) {
  if (range === "all") return true;

  const today = isoToday();
  const end = (evt.meta?.plannedEnd || evt.meta?.plannedStart || "").slice(0, 10);

  // No dates at all: show it under Upcoming so it doesn't vanish unnoticed.
  if (!end) return range === "upcoming";

  if (range === "upcoming") return end >= today;

  if (range === "past") {
    const yearAgo = isoDaysAgo(365);
    return end < today && end >= yearAgo;
  }

  return true;
}

function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function compare(a, b, key) {
  switch (key) {
    case "docNumber":
      return str(a.meta?.docNumber).localeCompare(str(b.meta?.docNumber));

    case "showName":
      return str(a.meta?.showName).localeCompare(str(b.meta?.showName), undefined, {
        sensitivity: "base",
      });

    case "dates":
      // Events with no date sort last either way rather than clustering at the top.
      return str(a.meta?.plannedStart || "9999").localeCompare(
        str(b.meta?.plannedStart || "9999")
      );

    case "pmName": {
      const pa = str(a.meta?.pmName);
      const pb = str(b.meta?.pmName);
      // Unassigned goes to the bottom regardless of direction — it's a gap to
      // fill, not a name to alphabetize.
      if (pa === "un-assigned" && pb !== "un-assigned") return 1;
      if (pb === "un-assigned" && pa !== "un-assigned") return -1;
      return pa.localeCompare(pb, undefined, { sensitivity: "base" });
    }

    case "status":
      return (STATUS_ORDER[a.status.id] ?? 99) - (STATUS_ORDER[b.status.id] ?? 99);

    case "checklist":
      return a.progress.done / a.progress.total - b.progress.done / b.progress.total;

    default:
      return 0;
  }
}

function str(v) {
  return String(v ?? "");
}

function formatRange(start, end) {
  if (!start) return "—";
  const s = new Date(`${start}T12:00:00`);
  const e = end ? new Date(`${end}T12:00:00`) : null;
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  if (!e || start === end) return `${fmt(s)}/${String(s.getFullYear()).slice(2)}`;
  return `${fmt(s)} – ${fmt(e)}/${String(e.getFullYear()).slice(2)}`;
}
