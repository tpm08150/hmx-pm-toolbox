import { useState, useEffect, useCallback } from "react";
import {
  searchCrews,
  fetchTimecards,
  setApproval,
  sendTimecardMessage,
  periodRange,
  periodForDate,
  PERIODS,
  MONTHS,
} from "../lib/timecards";
import { fetchRoster } from "../lib/roster";

/** Who gets copied on timecard questions, matched by name in the roster. */
const PAYROLL_NAME = "Katie Barnes";

export default function Timecards({ event, user, canEdit, onCrewChange }) {
  const meta = event.meta || {};
  const crew = event.shiftboardCrew || null;

  const initial = periodForDate(meta.plannedStart);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [period, setPeriod] = useState(initial.period);

  const [cards, setCards] = useState(null);
  const [totals, setTotals] = useState({ count: 0, hours: 0 });
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [picking, setPicking] = useState(!crew);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);

  const [messageFor, setMessageFor] = useState(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);

  const range = periodRange(year, month, period);

  const load = useCallback(async () => {
    if (!crew?.id) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const { timecards, count, totalHours } = await fetchTimecards({
        workgroup: crew.id,
        start: range.start,
        end: range.end,
      });
      setCards(timecards);
      setTotals({ count, hours: totalHours });
    } catch (e) {
      setError(e.message);
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, [crew?.id, range.start, range.end]);

  useEffect(() => {
    load();
  }, [load]);

  // Search runs on a short delay so typing doesn't fire a call per keystroke.
  useEffect(() => {
    if (search.trim().length < 2) {
      setResults(null);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const { crews } = await searchCrews(search.trim());
        setResults(crews);
      } catch (e) {
        setError(e.message);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  function chooseCrew(c) {
    onCrewChange({ id: c.id, name: c.name });
    setPicking(false);
    setSearch("");
    setResults(null);
  }

  function toggleRow(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (!cards) return;
    setSelected((prev) =>
      prev.size === cards.length ? new Set() : new Set(cards.map((c) => c.id))
    );
  }

  async function approve(ids, approved) {
    if (!ids.length) return;
    setWorking(true);
    setError(null);
    setNotice(null);
    try {
      await setApproval(ids, approved);
      setCards((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, approved } : c)));
      setSelected(new Set());
      setNotice(
        `${ids.length} timecard${ids.length === 1 ? "" : "s"} ${approved ? "approved" : "un-approved"}.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setWorking(false);
    }
  }

  /**
   * Opens a group DM with the technician, the PM, and payroll. Everyone's
   * Slack ID comes from their Shiftboard record, matched by name.
   */
  async function sendMessage() {
    if (!messageFor || !messageText.trim()) return;
    setSendingMessage(true);
    setError(null);
    try {
      const { people } = await fetchRoster();
      const byName = (n) =>
        people.find((p) => p.name.trim().toLowerCase() === (n || "").trim().toLowerCase());

      const tech = byName(messageFor.name);
      const pm = byName(meta.pmName);
      const payroll = byName(PAYROLL_NAME);

      const missing = [];
      if (!tech?.slackId) missing.push(messageFor.name);
      if (meta.pmName && meta.pmName !== "un-assigned" && !pm?.slackId) missing.push(meta.pmName);
      if (!payroll?.slackId) missing.push(PAYROLL_NAME);

      const result = await sendTimecardMessage({
        message: messageText.trim(),
        timecard: messageFor,
        eventName: meta.showName || "",
        fromName: user?.displayName || user?.email || "the PM",
        slackId: tech?.slackId || "",
        pmSlackId: pm?.slackId || "",
        copySlackIds: payroll?.slackId ? [payroll.slackId] : [],
        missingSlackIds: missing,
      });

      setNotice(
        `Message sent to a group with ${result.members} ${result.members === 1 ? "person" : "people"}.` +
          (missing.length
            ? ` Left out (no Slack ID on file): ${missing.join(", ")}.`
            : "")
      );
      setMessageFor(null);
      setMessageText("");
    } catch (e) {
      setError(
        e.needsSlackId
          ? "Nobody in this conversation has a Slack ID on file. Add their member IDs to the fax field in Shiftboard."
          : e.message
      );
    } finally {
      setSendingMessage(false);
    }
  }

  const years = [year - 1, year, year + 1];
  const allSelected = cards && cards.length > 0 && selected.size === cards.length;
  const unapprovedCount = (cards || []).filter((c) => !c.approved).length;

  // ── Crew picker ─────────────────────────────────────────────────────────
  if (picking) {
    return (
      <div>
        {error && (
          <div className="banner banner-error">
            {error}
            <div className="banner-spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        <div className="card card-pad">
          <h2>{crew ? "Change crew" : "Pick the Shiftboard crew"}</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
            {crew
              ? `Currently linked to ${crew.name}.`
              : "Search for this event's crew in Shiftboard. Once linked, timecards load automatically."}
          </p>

          <input
            className="input"
            style={{ maxWidth: 340 }}
            placeholder="Search crews by name"
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />

          {searching && <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>Searching…</div>}

          {results && !searching && (
            <div className="picker-list" style={{ marginTop: 12 }}>
              {!results.length ? (
                <div className="muted" style={{ padding: "10px 0" }}>No crews match that.</div>
              ) : (
                results.map((c) => (
                  <button key={c.id} className="picker-row" onClick={() => chooseCrew(c)}>
                    <span className="picker-name">{c.name}</span>
                    {c.code && <span className="muted mono" style={{ fontSize: 11 }}>{c.code}</span>}
                  </button>
                ))
              )}
            </div>
          )}

          {crew && (
            <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={() => setPicking(false)}>
              Cancel
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Timecard list ───────────────────────────────────────────────────────
  return (
    <div>
      {notice && (
        <div className="banner banner-info">
          {notice}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {error && (
        <div className="banner banner-error">
          {error}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="timecard-bar">
        <div>
          <div className="eyebrow">Crew</div>
          <div className="crew-name">{crew.name}</div>
        </div>

        <div className="timecard-filters">
          <select className="select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <select className="select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="timecard-actions">
          <button className="btn btn-sm" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          {canEdit && (
            <button className="btn btn-sm" onClick={() => setPicking(true)}>
              Change crew
            </button>
          )}
        </div>
      </div>

      {loading && !cards ? (
        <div className="loading">Reading timecards…</div>
      ) : !cards?.length ? (
        <div className="empty">
          <p>
            No timecards for {crew.name} between {range.start} and {range.end}.
          </p>
        </div>
      ) : (
        <>
          <div className="timecard-summary">
            <span>
              <b>{totals.count}</b> {totals.count === 1 ? "entry" : "entries"}
            </span>
            <span>
              <b className="mono">{totals.hours}</b> hours
            </span>
            {unapprovedCount > 0 && (
              <span className="unapproved-count">
                <b>{unapprovedCount}</b> not yet approved
              </span>
            )}
            <div style={{ flex: 1 }} />
            {canEdit && selected.size > 0 && (
              <>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => approve([...selected], true)}
                  disabled={working}
                >
                  Approve {selected.size}
                </button>
                <button
                  className="btn btn-sm"
                  onClick={() => approve([...selected], false)}
                  disabled={working}
                >
                  Un-approve {selected.size}
                </button>
              </>
            )}
          </div>

          <div className="card" style={{ overflow: "hidden" }}>
            <table className="event-table timecard-table">
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        aria-label="Select all"
                      />
                    )}
                  </th>
                  <th>Name</th>
                  <th style={{ width: 110 }}>Date</th>
                  <th style={{ width: 130 }}>Times</th>
                  <th style={{ width: 70 }}>Hours</th>
                  <th style={{ width: 100 }}>Status</th>
                  <th style={{ width: 150 }} />
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} className={selected.has(c.id) ? "row-selected" : ""}>
                    <td>
                      {canEdit && (
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleRow(c.id)}
                          aria-label={`Select ${c.name}`}
                        />
                      )}
                    </td>
                    <td className="event-name">{c.name}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{fmtDate(c.date)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {c.startTime ? `${fmtTime(c.startTime)}–${fmtTime(c.endTime)}` : "—"}
                    </td>
                    <td className="mono">{c.hours}</td>
                    <td>
                      <span className={`pill ${c.approved ? "pill-closed" : "pill-planning"}`}>
                        {c.approved ? "Approved" : "Pending"}
                      </span>
                    </td>
                    <td>
                      {canEdit && (
                        <div className="row-actions">
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => approve([c.id], !c.approved)}
                            disabled={working}
                          >
                            {c.approved ? "Un-approve" : "Approve"}
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setMessageFor(c);
                              setMessageText("");
                            }}
                            title="Ask about this entry"
                          >
                            Ask
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {messageFor && (
        <div className="card card-pad" style={{ marginTop: 14 }}>
          <h2 style={{ marginBottom: 4 }}>Ask about {messageFor.name}'s entry</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 12 }}>
            {fmtDate(messageFor.date)} · {messageFor.hours} hours · opens a group message with{" "}
            {messageFor.name}, {meta.pmName || "the PM"}, and {PAYROLL_NAME}. The entry details go
            with it.
          </p>
          <textarea
            className="textarea"
            placeholder="What's the question?"
            value={messageText}
            autoFocus
            onChange={(e) => setMessageText(e.target.value)}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={sendingMessage || !messageText.trim()}
            >
              {sendingMessage ? "Sending…" : "Send"}
            </button>
            <button className="btn" onClick={() => setMessageFor(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

function fmtTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = String(hhmm).split(":");
  const hour = Number(h);
  if (Number.isNaN(hour)) return hhmm;
  const ampm = hour < 12 ? "a" : "p";
  const h12 = hour % 12 || 12;
  return `${h12}:${m}${ampm}`;
}
