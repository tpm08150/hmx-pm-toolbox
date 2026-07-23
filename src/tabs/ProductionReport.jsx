import { useState } from "react";
import { RATING_LEGEND } from "../lib/settings";
import { sendProductionReport } from "../lib/prodreport";
import SubmitBar from "../components/SubmitBar";

const RATINGS = ["5", "4", "3", "2", "1"];

function reviewFromContact(contact) {
  return {
    id: crypto.randomUUID(),
    name: contact?.name || "",
    role: contact?.role || "",
    attitude: "",
    technical: "",
    prep: "",
    customerService: "",
    notes: "",
  };
}

function blankDraft() {
  return { wentWell: "", wentWrong: "", nextYear: "", techReviews: [] };
}

/**
 * The in-progress report lives on the event and autosaves, so a PM pulled away
 * mid-write doesn't lose it. Submitting stores a stamped copy separately and
 * leaves the draft in place, so a resend starts from what was sent.
 */
export default function ProductionReport({ event, canEdit, onChange, onDraftChange, onSubmitted }) {
  const submitted = event.productionReport || null;
  const draft = event.reportDraft || (submitted ? stripStamp(submitted) : blankDraft());

  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  function patch(next) {
    onDraftChange({ ...draft, ...next });
  }

  function updateReview(id, changes) {
    patch({
      techReviews: draft.techReviews.map((t) => (t.id === id ? { ...t, ...changes } : t)),
    });
  }

  function addReview() {
    patch({ techReviews: [...draft.techReviews, reviewFromContact()] });
  }

  /** Name and role both come across from the contacts sheet. */
  function addFromContacts() {
    const assigned = event.contacts || [];
    const existingNames = new Set(
      draft.techReviews.map((t) => (t.name || "").trim().toLowerCase()).filter(Boolean)
    );
    const additions = assigned
      .filter((c) => c.name && !existingNames.has(c.name.trim().toLowerCase()))
      .map(reviewFromContact);

    if (!additions.length) {
      setNotice(
        assigned.length
          ? "Everyone on the contacts sheet already has a review row."
          : "No contacts assigned to this event yet."
      );
      return;
    }
    patch({
      techReviews: [...draft.techReviews.filter((t) => (t.name || "").trim()), ...additions],
    });
  }

  function removeReview(id) {
    patch({ techReviews: draft.techReviews.filter((t) => t.id !== id) });
  }

  function missingRatings() {
    return (draft.techReviews || [])
      .filter((t) => (t.name || "").trim())
      .some((t) => !t.attitude || !t.technical || !t.prep || !t.customerService);
  }

  async function submit() {
    if (missingRatings()) {
      setError("Every named tech needs all four ratings before you can send.");
      return;
    }

    setSending(true);
    setError(null);
    setNotice(null);
    try {
      await sendProductionReport({ event, report: draft });
      onChange({ ...draft, submittedAt: Date.now() });
      onSubmitted?.();
      setNotice("Production report sent.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  const alreadySubmitted = !!submitted?.submittedAt;
  const reviews = draft.techReviews || [];

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

      {alreadySubmitted && (
        <div className="banner banner-info">
          Submitted{" "}
          {new Date(submitted.submittedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          . Editing and sending again will resend it.
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Production report</h2>
        <div className="stack">
          <div className="field">
            <label htmlFor="went-well">What went well</label>
            <textarea
              id="went-well"
              className="textarea"
              value={draft.wentWell || ""}
              disabled={!canEdit}
              onChange={(e) => patch({ wentWell: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="went-wrong">What didn't go well</label>
            <textarea
              id="went-wrong"
              className="textarea"
              value={draft.wentWrong || ""}
              disabled={!canEdit}
              onChange={(e) => patch({ wentWrong: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor="next-year">What we can improve next year</label>
            <textarea
              id="next-year"
              className="textarea"
              value={draft.nextYear || ""}
              disabled={!canEdit}
              onChange={(e) => patch({ nextYear: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>Tech reviews</h2>
          <span className="muted" style={{ fontSize: 12 }}>
            Names and roles come from the contacts sheet — rate each 1 to 5.
          </span>
        </div>

        {!reviews.length ? (
          <div className="empty" style={{ marginTop: 12 }}>
            <p>No reviews yet. Pull in the crew from the contacts sheet.</p>
            {canEdit && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button className="btn btn-primary" onClick={addFromContacts}>
                  Add from contacts
                </button>
                <button className="btn" onClick={addReview}>Add tech</button>
              </div>
            )}
          </div>
        ) : (
          <div className="reviews">
            {reviews.map((t) => (
              <div className="review-row" key={t.id}>
                <input
                  className="input"
                  placeholder="Name"
                  value={t.name || ""}
                  disabled={!canEdit}
                  onChange={(e) => updateReview(t.id, { name: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Role"
                  value={t.role || ""}
                  disabled={!canEdit}
                  onChange={(e) => updateReview(t.id, { role: e.target.value })}
                />
                {["attitude", "technical", "prep", "customerService"].map((field) => (
                  <select
                    key={field}
                    className="select rating-select"
                    value={t[field] || ""}
                    disabled={!canEdit}
                    onChange={(e) => updateReview(t.id, { [field]: e.target.value })}
                    aria-label={ratingLabel(field)}
                  >
                    <option value="">{ratingLabel(field)}</option>
                    {RATINGS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                ))}
                <input
                  className="input"
                  placeholder="Notes"
                  value={t.notes || ""}
                  disabled={!canEdit}
                  onChange={(e) => updateReview(t.id, { notes: e.target.value })}
                />
                {canEdit && (
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => removeReview(t.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {canEdit && reviews.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn-sm" onClick={addFromContacts}>Add from contacts</button>
            <button className="btn btn-sm" onClick={addReview}>Add tech</button>
          </div>
        )}

        <div className="rating-legend">
          {RATING_LEGEND.map((r) => (
            <div key={r.score} className="legend-line">
              <b>{r.score} — {r.label}:</b> {r.text}
            </div>
          ))}
        </div>
      </div>

      {canEdit && (
        <SubmitBar
          label={alreadySubmitted ? "Resend report" : "Submit report"}
          busy={sending}
          onClick={submit}
          hint={missingRatings() ? "Every named tech needs all four ratings." : undefined}
        />
      )}
    </div>
  );
}

/** A submitted report minus its timestamp, for seeding the editable draft. */
function stripStamp(report) {
  const { submittedAt, ...rest } = report;
  return {
    wentWell: rest.wentWell || "",
    wentWrong: rest.wentWrong || "",
    nextYear: rest.nextYear || "",
    techReviews: (rest.techReviews || []).map((t) => ({
      ...t,
      id: t.id || crypto.randomUUID(),
    })),
  };
}

function ratingLabel(field) {
  return {
    attitude: "Attitude",
    technical: "Technical",
    prep: "Prep",
    customerService: "Cust. Service",
  }[field];
}
