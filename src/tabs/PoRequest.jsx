import { useState, useRef } from "react";
import {
  VENUE_CODES,
  ACCOUNT_CODES,
  FREIGHT_OPTIONS,
  LOCATIONS,
  QUOTES_FOLDER,
  isRentalCode,
  fullCode,
  shareLinkFor,
  uploadQuote,
  sendPoRequest,
} from "../lib/po";
import { listFolder, cachedListing, cacheListing, fileIcon, formatSize } from "../lib/files";
import SubmitBar from "../components/SubmitBar";

function blankDraft(meta) {
  return {
    vendor: "",
    itemDescription: "",
    cost: "",
    charging: "",
    location: meta?.venue || "",
    venueCode: "",
    accountCode: "",
    freightOption: "",
    pickupLocation: "",
    pickupDate: "",
    returnLocation: "",
    returnDate: "",
    notes: "",
    quotes: [],
  };
}

export default function PoRequest({ event, user, canEdit, onChange, onDraftChange }) {
  const meta = event.meta || {};
  const draft = event.poDraft || blankDraft(meta);
  const saved = event.poRequests || [];
  const linked = event.fileCloudFolder || null;

  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const [picking, setPicking] = useState(false);
  const [pickPath, setPickPath] = useState(null);
  const [pickItems, setPickItems] = useState(null);
  const [pickLoading, setPickLoading] = useState(false);
  const [linking, setLinking] = useState(null);

  const [dragging, setDragging] = useState(false);
  const [uploads, setUploads] = useState([]);
  const dropInput = useRef(null);

  function patch(next) {
    onDraftChange({ ...draft, ...next });
  }

  function addQuote(quote, current) {
    const list = current || draft.quotes;
    if (list.some((q) => q.path === quote.path)) return list;
    return [...list, quote];
  }

  // ── Upload path ─────────────────────────────────────────────────────────

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    if (!linked?.path) {
      setError("Link a FileCloud folder on the Files tab first.");
      return;
    }

    setError(null);
    setNotice(null);
    setUploads(files.map((f) => ({ name: f.name, percent: 0 })));

    // Collect as we go so several files landing at once don't overwrite each
    // other's additions to the draft.
    let quotes = draft.quotes;
    const failed = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const quote = await uploadQuote({
          event,
          file,
          onProgress: ({ percent }) =>
            setUploads((prev) => prev.map((u, idx) => (idx === i ? { ...u, percent } : u))),
        });
        quotes = addQuote(quote, quotes);
        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, percent: 100 } : u))
        );
      } catch (e) {
        failed.push(file.name);
        setUploads((prev) =>
          prev.map((u, idx) => (idx === i ? { ...u, error: e.message } : u))
        );
      }
    }

    patch({ quotes });

    const added = files.length - failed.length;
    if (added) {
      setNotice(
        `Uploaded ${added} ${added === 1 ? "quote" : "quotes"} to ${QUOTES_FOLDER}.` +
          (failed.length ? ` ${failed.join(", ")} failed.` : "")
      );
    } else if (failed.length) {
      setError(`Couldn't upload ${failed.join(", ")}.`);
    }

    // Leave failures on screen; clear the successes.
    setTimeout(() => setUploads((prev) => prev.filter((u) => u.error)), 1200);
    if (dropInput.current) dropInput.current.value = "";
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (!canEdit) return;
    handleFiles(e.dataTransfer.files);
  }

  // ── Picker path ─────────────────────────────────────────────────────────

  async function openPicker() {
    if (!linked?.path) {
      setError("Link a FileCloud folder on the Files tab first.");
      return;
    }
    setPicking(true);
    await loadPick(`${linked.path}/${QUOTES_FOLDER}`);
  }

  async function loadPick(target) {
    setPickLoading(true);
    setError(null);
    try {
      const cached = cachedListing(target);
      if (cached) {
        setPickItems(cached);
        setPickPath(target);
        return;
      }
      const { items } = await listFolder(target);
      cacheListing(target, items);
      setPickItems(items);
      setPickPath(target);
    } catch (e) {
      // Subrents may not exist on every show; fall back to the Production Folder.
      if (target.endsWith(`/${QUOTES_FOLDER}`) && linked?.path) {
        setError(null);
        await loadPick(linked.path);
        return;
      }
      setError(e.message);
      setPickItems([]);
    } finally {
      setPickLoading(false);
    }
  }

  async function attachQuote(item) {
    setLinking(item.path);
    setError(null);
    try {
      const quote = await shareLinkFor(item.path);
      if (draft.quotes.some((q) => q.path === quote.path)) {
        setNotice(`${quote.name} is already attached.`);
        return;
      }
      patch({ quotes: [...draft.quotes, quote] });
      setNotice(`Attached ${quote.name}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLinking(null);
    }
  }

  function removeQuote(path) {
    patch({ quotes: draft.quotes.filter((q) => q.path !== path) });
  }

  // ── Send ────────────────────────────────────────────────────────────────

  const ready =
    draft.vendor.trim() &&
    draft.itemDescription.trim() &&
    draft.cost.trim() &&
    draft.venueCode &&
    draft.accountCode;

  async function send() {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await sendPoRequest({ event, request: draft, user });

      const record = {
        id: crypto.randomUUID(),
        sentAt: Date.now(),
        requester: user?.displayName || user?.email || "",
        ...draft,
        code: fullCode(draft.venueCode, draft.accountCode),
      };
      onChange([record, ...saved]);
      onDraftChange(blankDraft(meta));

      setNotice(
        `PO request sent to ${result.recipients.length} ${
          result.recipients.length === 1 ? "person" : "people"
        }.`
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function reopen(record) {
    const { id, sentAt, requester, code, ...rest } = record;
    onDraftChange({ ...blankDraft(meta), ...rest });
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const rental = draft.accountCode ? isRentalCode(draft.accountCode) : null;

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
        <h2>New PO request</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 16 }}>
          Show, date, and requester come from the event and your sign-in.
        </p>

        <div className="po-grid">
          <div className="field">
            <label htmlFor="po-vendor">Vendor</label>
            <input
              id="po-vendor"
              className="input"
              value={draft.vendor}
              disabled={!canEdit}
              onChange={(e) => patch({ vendor: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="po-cost">Cost</label>
            <input
              id="po-cost"
              className="input"
              placeholder="$0.00"
              value={draft.cost}
              disabled={!canEdit}
              onChange={(e) => patch({ cost: e.target.value })}
            />
          </div>

          <div className="field po-wide">
            <label htmlFor="po-desc">Item description</label>
            <textarea
              id="po-desc"
              className="textarea"
              style={{ minHeight: 64 }}
              value={draft.itemDescription}
              disabled={!canEdit}
              onChange={(e) => patch({ itemDescription: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="po-venue">Venue code</label>
            <select
              id="po-venue"
              className="select"
              value={draft.venueCode}
              disabled={!canEdit}
              onChange={(e) => patch({ venueCode: e.target.value })}
            >
              <option value="">Select…</option>
              {VENUE_CODES.map((v) => (
                <option key={v.code} value={v.code}>{v.code} — {v.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="po-account">Account code</label>
            <select
              id="po-account"
              className="select"
              value={draft.accountCode}
              disabled={!canEdit}
              onChange={(e) => patch({ accountCode: e.target.value })}
            >
              <option value="">Select…</option>
              {ACCOUNT_CODES.map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Full code</label>
            <div className="po-code mono">
              {fullCode(draft.venueCode, draft.accountCode) || "—"}
              {rental !== null && (
                <span
                  className={`pill ${rental ? "pill-planning" : "pill-ready"}`}
                  style={{ marginLeft: 8 }}
                >
                  {rental ? "Rental" : "Purchase"}
                </span>
              )}
            </div>
          </div>

          <div className="field">
            <label htmlFor="po-charging">Charging</label>
            <input
              id="po-charging"
              className="input"
              value={draft.charging}
              disabled={!canEdit}
              onChange={(e) => patch({ charging: e.target.value })}
            />
          </div>

          <div className="field po-wide">
            <label htmlFor="po-location">Location</label>
            <input
              id="po-location"
              className="input"
              value={draft.location}
              disabled={!canEdit}
              onChange={(e) => patch({ location: e.target.value })}
            />
          </div>
        </div>

        <h2 style={{ marginTop: 22 }}>Freight</h2>
        <div className="po-grid">
          <div className="field">
            <label htmlFor="po-freight">Freight or HMX pickup</label>
            <select
              id="po-freight"
              className="select"
              value={draft.freightOption}
              disabled={!canEdit}
              onChange={(e) => patch({ freightOption: e.target.value })}
            >
              <option value="">Select…</option>
              {FREIGHT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="po-pickup-loc">Pickup / delivery location</label>
            <select
              id="po-pickup-loc"
              className="select"
              value={draft.pickupLocation}
              disabled={!canEdit}
              onChange={(e) => patch({ pickupLocation: e.target.value })}
            >
              <option value="">Select…</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="po-pickup-date">Pickup / delivery date</label>
            <input
              id="po-pickup-date"
              className="input mono"
              type="date"
              value={draft.pickupDate}
              disabled={!canEdit}
              onChange={(e) => patch({ pickupDate: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="po-return-loc">Return location</label>
            <select
              id="po-return-loc"
              className="select"
              value={draft.returnLocation}
              disabled={!canEdit}
              onChange={(e) => patch({ returnLocation: e.target.value })}
            >
              <option value="">Select…</option>
              {LOCATIONS.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="po-return-date">Return date</label>
            <input
              id="po-return-date"
              className="input mono"
              type="date"
              value={draft.returnDate}
              disabled={!canEdit}
              onChange={(e) => patch({ returnDate: e.target.value })}
            />
          </div>
        </div>

        <h2 style={{ marginTop: 22 }}>Quotes</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 10 }}>
          Attached as public links from FileCloud, so the recipient always sees the current
          file. Anything dropped here lands in the {QUOTES_FOLDER} folder.
        </p>

        {draft.quotes.length > 0 && (
          <div className="quote-list">
            {draft.quotes.map((q) => (
              <div className="quote-row" key={q.path}>
                <span className="file-icon">📎</span>
                <a href={q.link} target="_blank" rel="noreferrer" className="quote-name">
                  {q.name}
                </a>
                {canEdit && (
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeQuote(q.path)}
                    title="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {uploads.length > 0 && (
          <div className="quote-list" style={{ marginTop: 6 }}>
            {uploads.map((u, i) => (
              <div className="quote-row" key={`${u.name}-${i}`}>
                <span className="file-icon">{u.error ? "⚠" : "↑"}</span>
                <span className="quote-name">{u.name}</span>
                {u.error ? (
                  <span className="muted" style={{ fontSize: 12 }}>{u.error}</span>
                ) : (
                  <>
                    <div className="transfer-track" style={{ maxWidth: 140 }}>
                      <div className="transfer-fill" style={{ width: `${u.percent}%` }} />
                    </div>
                    <span className="transfer-percent mono">{u.percent}%</span>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && (
          <>
            <div
              className={`dropzone${dragging ? " dropzone-active" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => dropInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && dropInput.current?.click()}
            >
              <input
                ref={dropInput}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => handleFiles(e.target.files)}
              />
              <div className="dropzone-icon">↑</div>
              <div>
                <b>Drop quotes here</b> or click to choose
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Uploaded to {QUOTES_FOLDER} and attached as a link
              </div>
            </div>

            <button className="btn btn-sm" onClick={openPicker} style={{ marginTop: 10 }}>
              Or pick one already in FileCloud
            </button>
          </>
        )}

        <div className="field" style={{ marginTop: 18 }}>
          <label htmlFor="po-notes">Notes</label>
          <textarea
            id="po-notes"
            className="textarea"
            placeholder="Anything else the approver should know."
            value={draft.notes}
            disabled={!canEdit}
            onChange={(e) => patch({ notes: e.target.value })}
          />
        </div>
      </div>

      {canEdit && (
        <SubmitBar
          label="Send PO request"
          busy={sending}
          disabled={!ready}
          onClick={send}
          hint={!ready ? "Vendor, description, cost, and both codes are required." : undefined}
        />
      )}

      {picking && (
        <div className="preview-overlay" onClick={() => setPicking(false)}>
          <div className="preview-box picker-box" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <span className="preview-title">
                {pickPath ? pickPath.split("/").slice(-1)[0] : "Pick a quote"}
              </span>
              <div style={{ flex: 1 }} />
              {pickPath && linked?.path && pickPath !== linked.path && (
                <button
                  className="btn btn-sm"
                  onClick={() => loadPick(pickPath.split("/").slice(0, -1).join("/"))}
                >
                  Up
                </button>
              )}
              <button className="btn btn-sm" onClick={() => setPicking(false)}>Done</button>
            </div>

            <div className="preview-body picker-body">
              {pickLoading ? (
                <div className="loading">Loading…</div>
              ) : !pickItems?.length ? (
                <div className="empty" style={{ margin: 20 }}>
                  <p>Nothing here.</p>
                </div>
              ) : (
                <div className="picker-list" style={{ width: "100%", maxHeight: "none" }}>
                  {pickItems.map((item) => (
                    <button
                      key={item.path}
                      className="picker-row"
                      onClick={() => (item.isDir ? loadPick(item.path) : attachQuote(item))}
                      disabled={linking === item.path}
                    >
                      <span className="file-icon">{fileIcon(item)}</span>
                      <span className="picker-name">{item.name}</span>
                      <span className="muted mono" style={{ fontSize: 11 }}>
                        {linking === item.path
                          ? "Linking…"
                          : item.isDir
                          ? ""
                          : formatSize(item.size)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="card" style={{ overflow: "hidden", marginTop: 16 }}>
          <table className="event-table">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Sent</th>
                <th style={{ width: 90 }}>Code</th>
                <th>Vendor</th>
                <th style={{ width: 100 }}>Cost</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {saved.map((r) => (
                <tr key={r.id}>
                  <td className="mono" style={{ fontSize: 12 }}>{fmtWhen(r.sentAt)}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.code || "—"}</td>
                  <td style={{ fontSize: 13 }}>{r.vendor || "—"}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.cost || "—"}</td>
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

function fmtWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}
