import { useState, useEffect } from "react";
import { getSettings } from "../lib/settings";
import { sendTravelRequest, perDiemTotal, formatMoney } from "../lib/travel";
import SubmitBar from "../components/SubmitBar";

function newTraveler(fromContact, template) {
  return {
    id: crypto.randomUUID(),
    name: fromContact?.name || "",
    departureCity: template?.departureCity || "",
    destinationCity: template?.destinationCity || "",
    departureDate: template?.departureDate || "",
    returnDate: template?.returnDate || "",
  };
}

function blankDraft() {
  return {
    types: { perDiem: false, flight: false, hotel: false },
    notes: "",
    travelers: [newTraveler()],
  };
}

/**
 * The in-progress request lives on the event and autosaves, so switching tabs
 * or reloading mid-entry doesn't lose it. Only sending clears it.
 */
export default function Travel({ event, canEdit, onChange, onDraftChange }) {
  const draft = event.travelDraft || blankDraft();
  const saved = event.travelRequests || [];

  const [settings, setSettings] = useState(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => setSettings(null));
  }, []);

  const rate = Number(settings?.perDiemRate) || 59.5;
  const anyType = draft.types.perDiem || draft.types.flight || draft.types.hotel;
  const hasTraveler = draft.travelers.some((t) => t.name.trim());

  function patch(next) {
    onDraftChange({ ...draft, ...next });
  }

  function setType(key, on) {
    patch({ types: { ...draft.types, [key]: on } });
  }

  function updateTraveler(id, changes) {
    patch({
      travelers: draft.travelers.map((t) => (t.id === id ? { ...t, ...changes } : t)),
    });
  }

  function addTraveler() {
    patch({ travelers: [...draft.travelers, newTraveler(null, tripTemplate(draft.travelers))] });
  }

  /**
   * Fill a row per assigned contact, each carrying the first traveler's dates
   * and cities — the crew almost always flies the same route on the same days.
   */
  function addFromContacts() {
    const assigned = event.contacts || [];
    const template = tripTemplate(draft.travelers);

    if (!assigned.length) {
      patch({ travelers: [...draft.travelers, newTraveler(null, template)] });
      return;
    }

    const existing = new Set(draft.travelers.map((t) => t.name.trim().toLowerCase()));
    const keep = draft.travelers.filter((t) => t.name.trim());
    const additions = assigned
      .filter((c) => c.name && !existing.has(c.name.trim().toLowerCase()))
      .map((c) => newTraveler(c, template));

    patch({ travelers: [...keep, ...additions] });
  }

  function removeTraveler(id) {
    patch({ travelers: draft.travelers.filter((t) => t.id !== id) });
  }

  function copyFirstToAll() {
    const template = tripTemplate(draft.travelers);
    patch({
      travelers: draft.travelers.map((t, i) => (i === 0 ? t : { ...t, ...template })),
    });
  }

  async function send() {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const s = settings || (await getSettings());
      const result = await sendTravelRequest({ event, request: draft, settings: s });

      const record = {
        id: crypto.randomUUID(),
        sentAt: Date.now(),
        types: draft.types,
        notes: draft.notes,
        travelers: draft.travelers,
      };
      onChange([record, ...saved]);
      onDraftChange(blankDraft());

      const kinds = Object.entries(draft.types)
        .filter(([, on]) => on)
        .map(([k]) => ({ perDiem: "per diem", flight: "flight", hotel: "hotel" }[k]))
        .join(", ");
      setNotice(
        `Sent ${kinds} request.` +
          (result.pmEmailMissing
            ? " Note: couldn't match the PM to a Shiftboard email, so they weren't copied."
            : "")
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function reopen(record) {
    onDraftChange({
      types: { ...record.types },
      notes: record.notes || "",
      travelers: (record.travelers || []).map((t) => ({ ...t, id: crypto.randomUUID() })),
    });
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

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

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>New travel request</h2>

        <div className="travel-types">
          {[
            ["perDiem", "Per diem"],
            ["flight", "Flights"],
            ["hotel", "Hotel"],
          ].map(([key, label]) => (
            <label key={key} className="travel-type">
              <input
                type="checkbox"
                checked={draft.types[key]}
                disabled={!canEdit}
                onChange={(e) => setType(key, e.target.checked)}
              />
              {label}
            </label>
          ))}
          <button
            className="btn btn-sm"
            style={{ marginLeft: "auto" }}
            disabled={!canEdit}
            onClick={() => patch({ types: { perDiem: true, flight: true, hotel: true } })}
          >
            All three
          </button>
        </div>

        <div className="travel-travelers">
          {draft.travelers.map((t) => (
            <div className="traveler-row" key={t.id}>
              <input
                className="input"
                placeholder="Traveler name"
                value={t.name}
                disabled={!canEdit}
                onChange={(e) => updateTraveler(t.id, { name: e.target.value })}
              />
              <input
                className="input"
                placeholder="From (city)"
                value={t.departureCity}
                disabled={!canEdit}
                onChange={(e) => updateTraveler(t.id, { departureCity: e.target.value })}
              />
              <input
                className="input"
                placeholder="To (city)"
                value={t.destinationCity}
                disabled={!canEdit}
                onChange={(e) => updateTraveler(t.id, { destinationCity: e.target.value })}
              />
              <input
                className="input mono"
                type="date"
                aria-label="Departure date"
                value={t.departureDate}
                disabled={!canEdit}
                onChange={(e) => updateTraveler(t.id, { departureDate: e.target.value })}
              />
              <input
                className="input mono"
                type="date"
                aria-label="Return date"
                value={t.returnDate}
                disabled={!canEdit}
                onChange={(e) => updateTraveler(t.id, { returnDate: e.target.value })}
              />
              <div className="traveler-total mono">
                {draft.types.perDiem
                  ? formatMoney(perDiemTotal(t.departureDate, t.returnDate, rate)) || "—"
                  : ""}
              </div>
              {canEdit && (
                <button
                  className="btn btn-ghost btn-sm btn-danger"
                  onClick={() => removeTraveler(t.id)}
                  title="Remove traveler"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn btn-sm" onClick={addTraveler}>Add traveler</button>
            <button className="btn btn-sm" onClick={addFromContacts}>Add from contacts</button>
            {draft.travelers.length > 1 && (
              <button
                className="btn btn-sm"
                onClick={copyFirstToAll}
                title="Copy the first row's dates and cities to everyone"
              >
                Copy trip to all
              </button>
            )}
          </div>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label htmlFor="travel-notes">Notes</label>
          <textarea
            id="travel-notes"
            className="textarea"
            placeholder="Anything the travel coordinator should know."
            value={draft.notes}
            disabled={!canEdit}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </div>
      </div>

      {canEdit && (
        <SubmitBar
          label="Send request"
          busy={sending}
          disabled={!anyType || !hasTraveler}
          onClick={send}
          hint={
            !anyType
              ? "Pick per diem, flights, or hotel."
              : !hasTraveler
              ? "Add at least one traveler."
              : undefined
          }
        />
      )}

      {saved.length > 0 && (
        <div className="card" style={{ overflow: "hidden", marginTop: 16 }}>
          <table className="event-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Sent</th>
                <th style={{ width: 200 }}>Types</th>
                <th>Travelers</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 12 }}>{fmtWhen(r.sentAt)}</td>
                  <td style={{ fontSize: 13 }}>{typeLabels(r.types)}</td>
                  <td style={{ fontSize: 13 }}>
                    {(r.travelers || []).map((t) => t.name).filter(Boolean).join(", ") || "—"}
                  </td>
                  <td>
                    {canEdit && (
                      <button className="btn btn-ghost btn-sm" onClick={() => reopen(r)}>
                        Reopen
                      </button>
                    )}
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

/** The first named traveler's trip — the dates and cities everyone inherits. */
function tripTemplate(travelers) {
  const first = travelers.find((t) => t.departureDate || t.departureCity) || travelers[0] || {};
  return {
    departureCity: first.departureCity || "",
    destinationCity: first.destinationCity || "",
    departureDate: first.departureDate || "",
    returnDate: first.returnDate || "",
  };
}

function typeLabels(types) {
  const map = { perDiem: "Per diem", flight: "Flights", hotel: "Hotel" };
  return (
    Object.entries(types || {})
      .filter(([, on]) => on)
      .map(([k]) => map[k])
      .join(", ") || "—"
  );
}

function fmtWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}
