import { useState, useEffect, useRef } from "react";
import {
  LABOR_CATEGORIES,
  LABOR_FOLDER,
  PAYROLL_NAME,
  shiftHours,
  estimate,
  formatHours,
  formatMoney,
  sendLaborRequest,
  saveLaborRequest,
  defaultRates,
} from "../lib/labor";
import SubmitBar from "../components/SubmitBar";
import { parseLaborFile, shiftDates } from "../lib/labor-import";

/**
 * A new call usually looks like the last one — same day, same venue, same
 * department and standing instructions. Role and trucks are the parts that
 * genuinely change per call, so those start empty.
 */
function newShift(template) {
  return {
    id: crypto.randomUUID(),
    date: template?.date || "",
    start: template?.start || "",
    end: template?.end || "",
    subject: template?.subject || "",
    role: "",
    quantity: 1,
    category: template?.category || "",
    department: template?.department || "",
    location: template?.location || "",
    roomFloor: template?.roomFloor || "",
    details: template?.details || "",
    trucks: "",
    publish: "Yes",
    notify: "Yes",
  };
}

function blankDraft(meta) {
  return {
    shifts: [
      newShift({
        date: (meta?.plannedStart || "").slice(0, 10),
        location: meta?.venue || "",
      }),
    ],
    note: "",
    rateOverride: false,
    rates: {},
  };
}

export default function LaborRequest({ event, user, canEdit, onChange, onDraftChange }) {
  const meta = event.meta || {};
  const draft = event.laborDraft || blankDraft(meta);
  const saved = event.laborRequests || [];
  const crew = event.shiftboardCrew || null;

  const [settingsRates, setSettingsRates] = useState({});
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [pendingImport, setPendingImport] = useState(null);
  const [dragging, setDragging] = useState(false);
  const importInput = useRef(null);

  useEffect(() => {
    defaultRates().then(setSettingsRates).catch(() => setSettingsRates({}));
  }, []);

  const rates = draft.rateOverride ? draft.rates : settingsRates;
  const est = estimate(draft.shifts, rates);

  function patch(next) {
    onDraftChange({ ...draft, ...next });
  }

  function updateShift(id, changes) {
    patch({ shifts: draft.shifts.map((s) => (s.id === id ? { ...s, ...changes } : s)) });
  }

  function addShift() {
    const last = draft.shifts[draft.shifts.length - 1];
    patch({ shifts: [...draft.shifts, newShift(last)] });
  }

  function duplicateShift(shift) {
    const copy = { ...shift, id: crypto.randomUUID() };
    const index = draft.shifts.findIndex((s) => s.id === shift.id);
    const next = [...draft.shifts];
    next.splice(index + 1, 0, copy);
    patch({ shifts: next });
  }

  function removeShift(id) {
    patch({ shifts: draft.shifts.filter((s) => s.id !== id) });
  }

  function toggleOverride(on) {
    patch({ rateOverride: on, rates: on ? { ...settingsRates } : {} });
  }

  /**
   * Read a Shiftboard template back in. A returning show's call is usually
   * last year's with new dates, so the shape is worth keeping — the PM picks
   * the new first day and everything moves with it.
   */
  async function handleImportFile(e) {
    await readImport(e.target.files?.[0]);
    if (importInput.current) importInput.current.value = "";
  }

  async function readImport(file) {
    if (!file) return;

    setError(null);
    setNotice(null);
    try {
      const parsed = await parseLaborFile(file);
      setPendingImport({
        ...parsed,
        newStart: (meta.plannedStart || "").slice(0, 10) || parsed.earliest,
        filename: file.name,
      });
    } catch (err) {
      setError(err.message);
    }
  }

  function onImportDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (!canEdit) return;
    readImport(e.dataTransfer.files?.[0]);
  }

  function applyImport() {
    if (!pendingImport) return;
    const moved = shiftDates(pendingImport.shifts, pendingImport.newStart);
    patch({ shifts: moved });

    const missing = moved.filter((s) => !s.category).length;
    setNotice(
      `Imported ${moved.length} shift${moved.length === 1 ? "" : "s"} from ${pendingImport.filename}.` +
        (missing
          ? ` ${missing} need${missing === 1 ? "s" : ""} a labor category before ${
              missing === 1 ? "it counts" : "they count"
            } toward the estimate.`
          : " Check the categories before sending — anything not a hand, rigger, or outside video position came in as Harvest.")
    );
    setPendingImport(null);
  }

  const ready = crew?.name && draft.shifts.some((s) => s.date && s.start && s.end);

  async function send() {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const payload = draft.shifts.filter((s) => s.date);
      const result = await sendLaborRequest({
        event,
        shifts: payload,
        note: draft.note,
        user,
      });

      const record = {
        id: crypto.randomUUID(),
        sentAt: Date.now(),
        requester: user?.displayName || user?.email || "",
        shifts: payload,
        note: draft.note,
        rates,
        totalHours: est.totalHours,
        totalCost: est.totalCost,
      };
      onChange([record, ...saved]);
      onDraftChange(blankDraft(meta));

      setNotice(
        `Sent ${result.shifts} shift${result.shifts === 1 ? "" : "s"} to ${PAYROLL_NAME}.` +
          (result.warnings?.length ? ` Note: ${result.warnings.join("; ")}.` : "")
      );
    } catch (e) {
      setError(
        e.needsSlackId
          ? `${PAYROLL_NAME} has no Slack ID on file. Add their member ID to the fax field in Shiftboard.`
          : e.message
      );
    } finally {
      setSending(false);
    }
  }

  /**
   * File a copy without sending. Also the way back to a request that went out
   * before the event had a folder linked.
   */
  async function saveToFileCloud() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload = draft.shifts.filter((s) => s.date);
      const result = await saveLaborRequest({
        event,
        shifts: payload,
        note: draft.note,
      });
      setNotice(`Saved ${result.filename} to ${LABOR_FOLDER}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function reopen(record) {
    patch({
      shifts: (record.shifts || []).map((s) => ({ ...s, id: crypto.randomUUID() })),
      note: record.note || "",
      rateOverride: false,
      rates: {},
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

      {!crew?.name && (
        <div className="banner banner-warn">
          Link a Shiftboard crew on the Timecards tab first — the import sheet needs the exact
          team name.
        </div>
      )}

      {pendingImport && (
        <div className="card card-pad import-panel">
          <h2>Import {pendingImport.shifts.length} shift
            {pendingImport.shifts.length === 1 ? "" : "s"}</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
            From {pendingImport.filename}. Pick the new first day and the rest move with it,
            keeping the gaps between days.
            {pendingImport.uncategorized > 0 && (
              <> {pendingImport.uncategorized} row
                {pendingImport.uncategorized === 1 ? " has" : "s have"} no role, so
                {pendingImport.uncategorized === 1 ? " it needs" : " they need"} a labor
                category set by hand.</>
            )}
          </p>

          <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field" style={{ maxWidth: 170 }}>
              <label htmlFor="imp-start">New first day</label>
              <input
                id="imp-start"
                className="input mono"
                type="date"
                value={pendingImport.newStart || ""}
                onChange={(e) =>
                  setPendingImport((p) => ({ ...p, newStart: e.target.value }))
                }
              />
            </div>
            <div className="muted" style={{ fontSize: 12, paddingBottom: 8 }}>
              was {pendingImport.earliest}
            </div>
          </div>

          <div className="import-preview">
            {shiftDates(pendingImport.shifts, pendingImport.newStart)
              .slice(0, 6)
              .map((s) => (
                <div className="import-row" key={s.id}>
                  <span className="mono">{s.date}</span>
                  <span className="mono muted">
                    {s.start}–{s.end}
                  </span>
                  <span>{s.subject || "—"}</span>
                  <span className="muted">{s.role || "—"}</span>
                  <span className="mono muted">×{s.quantity}</span>
                  <span className={s.category ? "muted" : "unassigned"}>
                    {s.category || "no category"}
                  </span>
                </div>
              ))}
            {pendingImport.shifts.length > 6 && (
              <div className="muted" style={{ fontSize: 12, paddingTop: 4 }}>
                and {pendingImport.shifts.length - 6} more
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={applyImport}>
              Replace {draft.shifts.filter((s) => s.date || s.subject).length > 0 ? "current shifts" : "and continue"}
            </button>
            <button className="btn" onClick={() => setPendingImport(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>Shifts</h2>
          {crew?.name && (
            <span className="muted" style={{ fontSize: 12 }}>
              Crew: <b>{crew.name}</b>
              {meta.docNumber && <> · Event code {meta.docNumber}</>}
            </span>
          )}
        </div>

        <div className="shift-head">
          <span>Date</span>
          <span>Start</span>
          <span>End</span>
          <span>Subject</span>
          <span>Role</span>
          <span>Qty</span>
          <span>Category</span>
          <span>Hours</span>
          <span />
        </div>

        <div className="shift-rows">
          {draft.shifts.map((s) => (
            <div className="shift-row" key={s.id}>
              <input
                className="input mono"
                type="date"
                aria-label="Date"
                value={s.date}
                disabled={!canEdit}
                onChange={(e) => updateShift(s.id, { date: e.target.value })}
              />
              <input
                className="input mono"
                type="time"
                aria-label="Start"
                value={s.start}
                disabled={!canEdit}
                onChange={(e) => updateShift(s.id, { start: e.target.value })}
              />
              <input
                className="input mono"
                type="time"
                aria-label="End"
                value={s.end}
                disabled={!canEdit}
                onChange={(e) => updateShift(s.id, { end: e.target.value })}
              />
              <input
                className="input"
                placeholder="Load In"
                value={s.subject}
                disabled={!canEdit}
                onChange={(e) => updateShift(s.id, { subject: e.target.value })}
              />
              <input
                className="input"
                placeholder="Role"
                value={s.role}
                disabled={!canEdit}
                onChange={(e) => updateShift(s.id, { role: e.target.value })}
              />
              <input
                className="input mono"
                type="number"
                min="1"
                aria-label="Quantity"
                value={s.quantity}
                disabled={!canEdit}
                onChange={(e) => updateShift(s.id, { quantity: e.target.value })}
              />
              <select
                className="select"
                aria-label="Labor category"
                value={s.category}
                disabled={!canEdit}
                onChange={(e) => updateShift(s.id, { category: e.target.value })}
              >
                <option value="">—</option>
                {LABOR_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <div className="shift-hours mono">{formatHours(shiftHours(s))}</div>
              {canEdit && (
                <div className="shift-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => duplicateShift(s)}
                    title="Duplicate"
                  >
                    ⧉
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeShift(s.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {canEdit && (
          <>
            <button className="btn btn-sm" onClick={addShift} style={{ marginTop: 10 }}>
              Add shift
            </button>

            <input
              ref={importInput}
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={handleImportFile}
            />

            <div
              className={`dropzone dropzone-slim${dragging ? " dropzone-active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onImportDrop}
              onClick={() => importInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && importInput.current?.click()}
            >
              <span className="dropzone-icon">↑</span>
              <span>
                <b>Drop last year's request here</b> or click to choose
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                Dates shift to this show, the shape stays
              </span>
            </div>
          </>
        )}

        <details className="shift-more">
          <summary>More columns for the import sheet</summary>
          <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Location, room, department, details, and trucks go on the sheet but aren't part of
            the estimate.
          </p>
          {draft.shifts.map((s, i) => (
            <div className="shift-extra" key={s.id}>
              <div className="eyebrow mono">{extraLabel(s, i)}</div>
              <div className="shift-extra-grid">
                <input
                  className="input"
                  placeholder="Location"
                  value={s.location}
                  disabled={!canEdit}
                  onChange={(e) => updateShift(s.id, { location: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Room / floor"
                  value={s.roomFloor}
                  disabled={!canEdit}
                  onChange={(e) => updateShift(s.id, { roomFloor: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Department"
                  value={s.department}
                  disabled={!canEdit}
                  onChange={(e) => updateShift(s.id, { department: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Trucks"
                  value={s.trucks}
                  disabled={!canEdit}
                  onChange={(e) => updateShift(s.id, { trucks: e.target.value })}
                />
                <input
                  className="input shift-extra-wide"
                  placeholder="Details — dress code, parking, position requirements"
                  value={s.details}
                  disabled={!canEdit}
                  onChange={(e) => updateShift(s.id, { details: e.target.value })}
                />
              </div>
            </div>
          ))}
        </details>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Estimate</h2>
          <div style={{ flex: 1 }} />
          {canEdit && (
            <label className="muted" style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={draft.rateOverride}
                onChange={(e) => toggleOverride(e.target.checked)}
              />
              Override rates for this show
            </label>
          )}
        </div>

        <table className="event-table estimate-table">
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ width: 110 }}>Rate</th>
              <th style={{ width: 90 }}>Hours</th>
              <th style={{ width: 120 }}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {LABOR_CATEGORIES.map((c) => {
              const bucket = est.byCategory[c.id];
              return (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    {draft.rateOverride && canEdit ? (
                      <input
                        className="cell-input mono"
                        type="number"
                        step="0.01"
                        value={draft.rates[c.id] ?? ""}
                        placeholder={String(settingsRates[c.id] ?? "")}
                        onChange={(e) =>
                          patch({ rates: { ...draft.rates, [c.id]: e.target.value } })
                        }
                      />
                    ) : (
                      <span className="mono muted">{formatMoney(bucket.rate)}</span>
                    )}
                  </td>
                  <td className="mono">{formatHours(bucket.hours)}</td>
                  <td className="mono">{formatMoney(bucket.cost)}</td>
                </tr>
              );
            })}
            {est.unassignedHours > 0 && (
              <tr>
                <td className="unassigned">No category</td>
                <td />
                <td className="mono unassigned">{formatHours(est.unassignedHours)}</td>
                <td className="muted" style={{ fontSize: 12 }}>not estimated</td>
              </tr>
            )}
            <tr className="estimate-total">
              <td><b>Total</b></td>
              <td />
              <td className="mono"><b>{formatHours(est.totalHours)}</b></td>
              <td className="mono"><b>{formatMoney(est.totalCost)}</b></td>
            </tr>
          </tbody>
        </table>

        <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
          For your budgeting only — the estimate doesn't go on the sheet sent to payroll.
        </p>
      </div>

      <div className="card card-pad">
        <div className="field">
          <label htmlFor="labor-note">Note to {PAYROLL_NAME}</label>
          <textarea
            id="labor-note"
            className="textarea"
            placeholder="Anything worth flagging about this call."
            value={draft.note}
            disabled={!canEdit}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </div>
      </div>

      {canEdit && (
        <SubmitBar
          label="Send labor request"
          busy={sending}
          disabled={!ready}
          onClick={send}
          hint={
            !ready
              ? "Every shift needs a date, start, and end."
              : `Goes to ${PAYROLL_NAME}, filed in ${LABOR_FOLDER}`
          }
        >
          <button
            className="btn btn-sm"
            onClick={saveToFileCloud}
            disabled={saving || !draft.shifts.some((s) => s.date)}
            title={`Put a copy in ${LABOR_FOLDER} without sending it`}
          >
            {saving ? "Saving…" : "Save to FileCloud"}
          </button>
        </SubmitBar>
      )}

      {saved.length > 0 && (
        <div className="card" style={{ overflow: "hidden", marginTop: 16 }}>
          <table className="event-table">
            <thead>
              <tr>
                <th style={{ width: 140 }}>Sent</th>
                <th style={{ width: 80 }}>Shifts</th>
                <th style={{ width: 90 }}>Hours</th>
                <th>Estimate</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 12 }}>{fmtWhen(r.sentAt)}</td>
                  <td className="mono">{(r.shifts || []).length}</td>
                  <td className="mono">{formatHours(r.totalHours)}</td>
                  <td className="mono">{formatMoney(r.totalCost)}</td>
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

/** Enough to tell one shift's extra fields from another's at a glance. */
function extraLabel(shift, index) {
  const parts = [`Shift ${index + 1}`];
  if (shift.date) parts.push(shortDate(shift.date));
  if (shift.subject) parts.push(shift.subject);
  if (shift.role) parts.push(shift.role);
  return parts.join(" · ");
}

function shortDate(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
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
