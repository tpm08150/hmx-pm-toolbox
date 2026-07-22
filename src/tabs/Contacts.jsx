import { useState, useEffect, useMemo } from "react";
import { fetchRoster, makeGuestContact, fromRoster } from "../lib/roster";

export default function Contacts({ contacts = [], canEdit, onChange }) {
  const [roster, setRoster] = useState(null);
  const [rosterError, setRosterError] = useState(null);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState("");

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

  return (
    <div>
      {rosterError && (
        <div className="banner banner-warn">
          {rosterError} You can still add contacts by hand.
        </div>
      )}

      {!contacts.length ? (
        <div className="empty">
          <p>Nobody assigned yet. Add the crew working this show, plus the client and venue contacts.</p>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => setPicking(true)}>
                Add from roster
              </button>
              <button className="btn" onClick={addGuest}>
                Add someone else
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ overflow: "hidden", marginBottom: 14 }}>
          <table className="event-table contacts-table">
            <thead>
              <tr>
                <th>Name</th>
                <th style={{ width: 180 }}>Role on this show</th>
                <th style={{ width: 210 }}>Email</th>
                <th style={{ width: 130 }}>Mobile</th>
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.source === "roster" ? (
                      <div className="contact-name">
                        {c.name}
                        {c.slackId && <span className="slack-dot" title="On Slack" />}
                      </div>
                    ) : (
                      <input
                        className="cell-input"
                        value={c.name}
                        placeholder="Name"
                        disabled={!canEdit}
                        onChange={(e) => update(c.id, { name: e.target.value })}
                      />
                    )}
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      value={c.role}
                      placeholder="Role"
                      disabled={!canEdit}
                      onChange={(e) => update(c.id, { role: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input mono"
                      style={{ fontSize: 12 }}
                      value={c.email}
                      placeholder="Email"
                      disabled={!canEdit}
                      onChange={(e) => update(c.id, { email: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input mono"
                      style={{ fontSize: 12 }}
                      value={c.mobile}
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
          <button className="btn btn-sm" onClick={() => setPicking(true)}>
            Add from roster
          </button>
          <button className="btn btn-sm" onClick={addGuest}>
            Add someone else
          </button>
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
            <button className="btn btn-ghost btn-sm" onClick={() => setPicking(false)}>
              Done
            </button>
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
