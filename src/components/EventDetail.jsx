import { useState, useEffect, useRef, useCallback } from "react";
import { getEvent, saveEvent, upsertEventFromFlex } from "../lib/firebase";
import { fetchEvent } from "../lib/anvil";
import { useEditLock } from "../lib/useEditLock";
import { deriveStatus } from "../lib/checklist";
import Checklist from "../tabs/Checklist";
import ShowInfo from "../tabs/ShowInfo";
import DaySheets from "../tabs/DaySheets";

const TABS = [
  { id: "checklist", label: "Check list" },
  { id: "showinfo", label: "Show info" },
  { id: "days", label: "Day sheets" },
];

const SAVE_DELAY = 900;

export default function EventDetail({ eventId, user, onBack }) {
  const [event, setEvent] = useState(null);
  const [tab, setTab] = useState("checklist");
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const { lock, isMine, isStale, canEdit, claim, release } = useEditLock(eventId, user);
  const saveTimer = useRef(null);
  const pending = useRef({});

  useEffect(() => {
    let cancelled = false;
    getEvent(eventId)
      .then((data) => {
        if (!cancelled) setEvent(data);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // Claim the lock on open if it's free or stale, release it on the way out.
  useEffect(() => {
    if (lock === undefined || !user) return;
    if (!lock || isStale) claim();
  }, [lock, isStale, user, claim]);

  useEffect(() => {
    return () => {
      if (isMine) release();
    };
  }, [isMine, release]);

  /** Writes batch up over ~1s so a burst of typing is one Firestore write. */
  const queueSave = useCallback(
    (patch) => {
      pending.current = { ...pending.current, ...patch };
      setSaveState("saving");

      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const batch = pending.current;
        pending.current = {};
        try {
          await saveEvent(eventId, batch);
          setSaveState("saved");
        } catch (e) {
          setSaveState("error");
          setError(e.message);
        }
      }, SAVE_DELAY);
    },
    [eventId]
  );

  function toggleTask(taskId, done) {
    const entry = done
      ? { done: true, doneBy: user.displayName || user.email, doneAt: Date.now() }
      : { done: false };

    setEvent((prev) => ({
      ...prev,
      checklist: { ...(prev.checklist || {}), [taskId]: entry },
    }));
    queueSave({ [`checklist.${taskId}`]: entry });
  }

  function updateShowInfo(sections) {
    setEvent((prev) => ({ ...prev, showInfo: sections }));
    queueSave({ showInfo: sections });
  }

  function updateDays(days) {
    setEvent((prev) => ({ ...prev, days }));
    queueSave({ days });
  }

  async function refreshFromFlex() {
    setRefreshing(true);
    setError(null);
    try {
      const fresh = await fetchEvent(eventId);
      await upsertEventFromFlex({ ...fresh, flexId: eventId }, { overwriteMeta: true });
      setEvent(await getEvent(eventId));
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  if (error && !event) return <div className="banner banner-error">{error}</div>;
  if (!event) return <div className="loading">Loading…</div>;

  const meta = event.meta || {};
  const status = deriveStatus(event);
  const lockedByOther = lock && !isMine && !isStale;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 14 }}>
        ← All events
      </button>

      {lockedByOther && (
        <div className="banner banner-warn">
          <span>
            <b>{lock.name}</b> is editing this event. You can read it, but changes are off
            until they're done.
          </span>
          <div className="banner-spacer" />
          <button className="btn btn-sm" onClick={claim}>
            Take over
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

      <div className="event-head">
        <div>
          <div className="eyebrow mono">{meta.docNumber || "No doc number"}</div>
          <h1>{meta.showName || "Untitled event"}</h1>
          <div className="event-head-meta">
            {meta.venue && (
              <span>
                Venue <b>{meta.venue}</b>
              </span>
            )}
            <span>
              PM{" "}
              <b className={meta.pmName === "un-assigned" ? "unassigned" : ""}>
                {meta.pmName || "—"}
              </b>
            </span>
            {meta.plannedStart && (
              <span className="mono">
                {meta.plannedStart} → {meta.plannedEnd || meta.plannedStart}
              </span>
            )}
          </div>
        </div>

        <div className="event-head-actions">
          <span className={`pill pill-${status.id}`}>{status.label}</span>
          <button className="btn btn-sm" onClick={refreshFromFlex} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh from Flex"}
          </button>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span className="save-state" style={{ alignSelf: "center", paddingRight: 4 }}>
          {saveState === "saving" && "Saving…"}
          {saveState === "saved" && "Saved"}
          {saveState === "error" && "Not saved"}
        </span>
      </div>

      {tab === "checklist" && (
        <Checklist event={event} canEdit={canEdit} onToggle={toggleTask} />
      )}
      {tab === "showinfo" && (
        <ShowInfo sections={event.showInfo || []} canEdit={canEdit} onChange={updateShowInfo} />
      )}
      {tab === "days" && (
        <DaySheets days={event.days || []} meta={meta} canEdit={canEdit} onChange={updateDays} />
      )}
    </div>
  );
}
