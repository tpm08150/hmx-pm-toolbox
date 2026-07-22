import { useState, useEffect } from "react";
import { listEvents, upsertEventFromFlex } from "../lib/firebase";
import { fetchEvents, isRealEvent } from "../lib/anvil";
import { deriveStatus, overallProgress } from "../lib/checklist";

export default function EventList({ onOpen }) {
  const [events, setEvents] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [showClosed, setShowClosed] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [search, setSearch] = useState("");

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
    try {
      const { events: flexEvents } = await fetchEvents();
      const real = flexEvents.filter((e) => isRealEvent(e));

      let created = 0;
      for (const evt of real) {
        const result = await upsertEventFromFlex(evt);
        if (result === "created") created += 1;
      }

      const skipped = flexEvents.length - real.length;
      setMessage(
        `Synced ${real.length} events. ${created} new.` +
          (skipped ? ` ${skipped} filtered out.` : "")
      );
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  if (error && events === null) {
    return <div className="banner banner-error">{error}</div>;
  }

  if (events === null) {
    return <div className="loading">Loading events…</div>;
  }

  const rows = events
    .map((evt) => ({
      ...evt,
      status: deriveStatus(evt),
      progress: overallProgress(evt),
    }))
    .filter((evt) => {
      if (!showClosed && evt.status.id === "closed") return false;
      if (mineOnly && evt.meta?.pmName === "un-assigned") return false;
      if (search) {
        const hay = `${evt.meta?.showName} ${evt.meta?.docNumber} ${evt.meta?.venue}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    });

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
          style={{ maxWidth: 260 }}
          placeholder="Search show, doc number, venue"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          Show closed
        </label>
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Hide unassigned
        </label>
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
                <th style={{ width: 92 }}>Doc</th>
                <th>Show</th>
                <th style={{ width: 148 }}>Dates</th>
                <th style={{ width: 130 }}>PM</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 108 }}>Checklist</th>
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

function formatRange(start, end) {
  if (!start) return "—";
  const s = new Date(`${start}T12:00:00`);
  const e = end ? new Date(`${end}T12:00:00`) : null;
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  if (!e || start === end) return `${fmt(s)}/${String(s.getFullYear()).slice(2)}`;
  return `${fmt(s)} – ${fmt(e)}/${String(e.getFullYear()).slice(2)}`;
}
