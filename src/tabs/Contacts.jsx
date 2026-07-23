import { useState, useEffect, useMemo } from "react";
import { fetchRoster, makeGuestContact, fromRoster } from "../lib/roster";
import { syncContactsFromShiftboard } from "../lib/contacts-sync";

export default function Contacts({ event, contacts = [], canEdit, onChange }) {
  const [roster, setRoster] = useState(null);
  const [rosterError, setRosterError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const crew = event?.shiftboardCrew || null;

  useEffect(() => {
    fetchRoster()
      .then((data) => setRoster(data.people))
      .catch((e) => setRosterError(e.message));
  }, []);

  const assignedRosterIds = useMemo(
    () => new Set(contacts.filter((c) => c.rosterId).map((c) => c.rosterId)),
    [contacts]
  );

  const available = useMemo(() => {
    if (!roster) return [];
    const term = search.trim().toLowerCase();
    return roster
      .filter((p) => !assignedRosterIds.has(p.id))
      .filter((p) => !term || p.name.toLowerCase().includes(term));
  }, [roster, assignedRosterIds, search]);

  function update(id, patch) {
    onChange(contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function remove(id) {
    onChange(contacts.filter((c) => c.id !== id));
  }

  function addFromRoster(person) {
    onChange([...contacts, fromRoster(person)]);
    setSearch("");
  }

  function addGuest() {
    onChange([...contacts, makeGuestContact()]);
    setPicking(false);
  }

  async function sync() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncContactsFromShiftboard({ event });
      onChange(result.contacts);

      const parts = [];
      if (result.added) parts.push(`${result.added} added`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.dropped) parts.push(`${result.dropped} no longer scheduled`);
      setNotice(parts.length ? `Synced — ${parts.join(", ")}.` : "Everyone is already up to date.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }

  const unassignedCount = contacts.filter((c) => c.unassigned).length;

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
      {rosterError && (
        <div className="banner banner-warn">
          {rosterError} You can still add contacts by hand.
        </div>
      )}

      <div className="contacts-head">
        <div className="muted" style={{ fontSize: 12 }}>
          {crew ? (
            <>Crew in Shiftboard: <b>{crew.name}</b></>
          ) : (
            "Link a Shiftboard crew on the Timecards tab to sync assignments."
          )}
        </div>
        <div style={{ flex: 1 }} />
        {canEdit && crew && (
          <button className="btn btn-sm" onClick={sync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync from Shiftboard"}
          </button>
        )}
      </div>

      {unassignedCount > 0 && (
        <div className="banner banner-warn">
          {unassignedCount} {unassignedCount === 1 ? "person is" : "people are"} no longer
          scheduled in Shiftboard, shown struck through. Remove them if they're off the show.
        </div>
      )}

      {!contacts.length ? (
        <div className="empty">
          <p>Nobody assigned yet. Sync from Shiftboard, or add the client and venue contacts by hand.</p>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {crew && (
                <button className="btn btn-primary" onClick={sync} disabled={syncing}>
                  {syncing ? "Syncing…" : "Sync from Shiftboard"}
                </button>
              )}
              <button className="btn" onClick={() => setPicking(true)}>Add from roster</button>
              <button className="btn" onClick={addGuest}>Add someone else</button>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden", marginBottom: 14 }}>
          <table className="event-table contacts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 150 }}>Role</th>
                <th style={{ width: 150 }}>Location</th>
                <th style={{ width: 200 }}>Email</th>
                <th style={{ width: 125 }}>Mobile</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className={c.unassigned ? "contact-dropped" : ""}>
                  <td>
                    {c.source === "manual" ? (
                      <input
                        className="cell-input"
                        value={c.name}
                        placeholder="Name"
                        disabled={!canEdit}
                        onChange={(e) => update(c.id, { name: e.target.value })}
                      />
                    ) : (
                      <div className="contact-name">
                        {c.name}
                        {c.slackId && <span className="slack-dot" title="On Slack" />}
                      </div>
                    )}
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      value={c.role || ""}
                      placeholder="Role"
                      disabled={!canEdit}
                      onChange={(e) => update(c.id, { role: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      value={c.location || ""}
                      placeholder="Room / venue"
                      disabled={!canEdit}
                      onChange={(e) => update(c.id, { location: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input mono"
                      style={{ fontSize: 12 }}
                      value={c.email || ""}
                      placeholder="Email"
                      disabled={!canEdit}
                      onChange={(e) => update(c.id, { email: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input mono"
                      style={{ fontSize: 12 }}
                      value={c.mobile || ""}
                      placeholder="Mobile"
                      disabled={!canEdit}
                      onChange={(e) => update(c.id, { mobile: e.target.value })}
                    />
                  </td>
                  <td>
                    {canEdit && (
                      <button
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() => remove(c.id)}
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canEdit && contacts.length > 0 && !picking && (
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-sm" onClick={() => setPicking(true)}>Add from roster</button>
          <button className="btn btn-sm" onClick={addGuest}>Add someone else</button>
        </div>
      )}

      {picking && (
        <div className="card card-pad picker">
          <div className="picker-head">
            <input
              className="input"
              style={{ maxWidth: 260 }}
              placeholder="Search the roster"
              value={search}
              autoFocus
              onChange={(e) => setSearch(e.target.value)}
            />
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={() => setPicking(false)}>Done</button>
          </div>

          {!roster ? (
            <div className="muted" style={{ padding: "10px 0" }}>Loading the roster…</div>
          ) : !available.length ? (
            <div className="muted" style={{ padding: "10px 0" }}>
              {search ? "Nobody matches that." : "Everyone on the roster is already assigned."}
            </div>
          ) : (
            <div className="picker-list">
              {available.map((p) => (
                <button key={p.id} className="picker-row" onClick={() => addFromRoster(p)}>
                  <span className="picker-name">{p.name}</span>
                  <span className="muted mono" style={{ fontSize: 11 }}>
                    {p.mobile || "no mobile"}
                  </span>
                  {p.slackId && <span className="slack-dot" title="On Slack" />}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
