import { useState, useEffect } from "react";
import { fetchRoster, clearRosterCache } from "../lib/roster";

export default function Roster({ onBack }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    load();
  }, [showAll]);

  async function load(force = false) {
    setLoading(true);
    setError(null);
    try {
      if (force) clearRosterCache();
      setData(await fetchRoster({ force, all: showAll }));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const people = (data?.people || []).filter((p) => {
    if (!search) return true;
    const hay = `${p.name} ${p.email}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  const missingMobile = (data?.people || []).filter((p) => !p.mobile).length;
  const missingSlack = (data?.people || []).filter((p) => !p.slackId).length;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 14 }}>
        ← All events
      </button>

      <div className="list-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Crew roster</h1>
        </div>
        <div className="list-head-spacer" />
        <button className="btn btn-primary" onClick={() => load(true)} disabled={loading}>
          {loading ? "Loading…" : "Refresh from Shiftboard"}
        </button>
      </div>

      {error && (
        <div className="banner banner-error">
          {error}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {data && (missingMobile > 0 || missingSlack > 0) && (
        <div className="banner banner-warn">
          <span>
            {missingMobile > 0 && (
              <>
                <b>{missingMobile}</b> {missingMobile === 1 ? "person has" : "people have"} no
                mobile number.{" "}
              </>
            )}
            {missingSlack > 0 && (
              <>
                <b>{missingSlack}</b> {missingSlack === 1 ? "has" : "have"} no Slack ID — add it
                to the fax field in Shiftboard to include them in channel invites.
              </>
            )}
          </span>
        </div>
      )}

      <div className="filters">
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Include other departments
        </label>
        <div style={{ flex: 1 }} />
        <span className="muted mono" style={{ fontSize: 12 }}>
          {people.length} of {data?.activeTotal ?? 0} active
        </span>
      </div>

      {loading && !data ? (
        <div className="loading">Reading Shiftboard…</div>
      ) : !people.length ? (
        <div className="empty">
          <p>{search ? "Nobody matches that." : "No crew found."}</p>
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden" }}>
          <table className="event-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 250 }}>Email</th>
                <th style={{ width: 140 }}>Mobile</th>
                <th style={{ width: 140 }}>Slack ID</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td className="event-name">{p.name}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {p.email || <span className="gap">—</span>}
                    {p.badEmail && <span className="gap"> (unverified)</span>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {p.mobile || <span className="gap">—</span>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {p.slackId || <span className="gap">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
        This list comes from Shiftboard — active accounts in the part time, full time, illusions
        hourly, and contractor profile types. Edit anyone's details in Shiftboard, then refresh
        here. Slack member IDs are read from the fax field.
      </p>
    </div>
  );
}
