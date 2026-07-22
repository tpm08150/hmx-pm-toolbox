import { useState, useEffect } from "react";

export default function DaySheets({ days = [], meta = {}, canEdit, onChange }) {
  const [activeId, setActiveId] = useState(days[0]?.id ?? null);

  useEffect(() => {
    if (!days.length) {
      setActiveId(null);
    } else if (!days.some((d) => d.id === activeId)) {
      setActiveId(days[0].id);
    }
  }, [days, activeId]);

  const active = days.find((d) => d.id === activeId);

  function updateDay(id, patch) {
    onChange(days.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function addDay() {
    const next = {
      id: crypto.randomUUID(),
      date: suggestNextDate(days, meta),
      order: days.length,
      rows: [newRow()],
    };
    onChange([...days, next]);
    setActiveId(next.id);
  }

  function removeDay(id) {
    const remaining = days.filter((d) => d.id !== id).map((d, i) => ({ ...d, order: i }));
    onChange(remaining);
  }

  function updateRow(dayId, rowId, patch) {
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    updateDay(dayId, {
      rows: day.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    });
  }

  function addRow(dayId) {
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    const last = day.rows[day.rows.length - 1];
    updateDay(dayId, {
      rows: [...day.rows, newRow(last?.finish || "")],
    });
  }

  function removeRow(dayId, rowId) {
    const day = days.find((d) => d.id === dayId);
    if (!day) return;
    updateDay(dayId, { rows: day.rows.filter((r) => r.id !== rowId) });
  }

  if (!days.length) {
    return (
      <div className="empty">
        <p>No days scheduled yet. Add one for each day of the event, load in through load out.</p>
        {canEdit && (
          <button className="btn btn-primary" onClick={addDay}>
            Add day
          </button>
        )}
      </div>
    );
  }

  const ordered = [...days].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div>
      <div className="day-tabs">
        {ordered.map((day, i) => (
          <button
            key={day.id}
            className={`day-tab${day.id === activeId ? " day-tab-active" : ""}`}
            onClick={() => setActiveId(day.id)}
          >
            <span className="day-tab-num">Day {i + 1}</span>
            <span className="day-tab-date">{day.date ? formatDay(day.date) : "No date"}</span>
          </button>
        ))}
        {canEdit && (
          <button className="btn btn-sm" onClick={addDay}>
            + Day
          </button>
        )}
      </div>

      {active && (
        <div className="card card-pad">
          <div className="day-head">
            <div className="field" style={{ maxWidth: 190 }}>
              <label htmlFor="day-date">Date</label>
              <input
                id="day-date"
                type="date"
                className="input mono"
                value={active.date || ""}
                disabled={!canEdit}
                onChange={(e) => updateDay(active.id, { date: e.target.value })}
              />
            </div>
            <div className="day-head-spacer" />
            {canEdit && (
              <button
                className="btn btn-sm btn-danger"
                onClick={() => removeDay(active.id)}
              >
                Remove day
              </button>
            )}
          </div>

          <div className="spine">
            {active.rows.map((row) => (
              <div className="block" key={row.id}>
                <div className="block-times">
                  <input
                    type="time"
                    value={row.start || ""}
                    disabled={!canEdit}
                    aria-label="Start time"
                    onChange={(e) => updateRow(active.id, row.id, { start: e.target.value })}
                  />
                  <div className="to">to</div>
                  <input
                    type="time"
                    value={row.finish || ""}
                    disabled={!canEdit}
                    aria-label="Finish time"
                    onChange={(e) => updateRow(active.id, row.id, { finish: e.target.value })}
                  />
                </div>

                <div className="block-body">
                  <input
                    className="block-task"
                    value={row.task || ""}
                    placeholder="What's happening"
                    disabled={!canEdit}
                    onChange={(e) => updateRow(active.id, row.id, { task: e.target.value })}
                  />
                  <textarea
                    className="block-notes"
                    value={row.notes || ""}
                    placeholder="Goals, crew, anything worth flagging"
                    rows={1}
                    disabled={!canEdit}
                    onChange={(e) => updateRow(active.id, row.id, { notes: e.target.value })}
                  />
                </div>

                {canEdit && (
                  <div className="block-actions">
                    <button
                      className="btn btn-ghost btn-sm btn-danger"
                      onClick={() => removeRow(active.id, row.id)}
                      title="Remove block"
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {canEdit && (
            <button className="btn btn-sm" onClick={() => addRow(active.id)} style={{ marginTop: 10 }}>
              Add block
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function newRow(startFrom = "") {
  return {
    id: crypto.randomUUID(),
    start: startFrom,
    finish: "",
    task: "",
    notes: "",
  };
}

/** Day one lands on load in; each later day steps forward from the last. */
function suggestNextDate(days, meta) {
  if (!days.length) return (meta.plannedStart || "").slice(0, 10);
  const last = [...days].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).pop();
  if (!last?.date) return "";
  const d = new Date(`${last.date}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDay(iso) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}
