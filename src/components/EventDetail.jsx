import { useState, useEffect, useRef, useCallback } from "react";
import { getEvent, saveEvent, upsertEventFromFlex } from "../lib/firebase";
import { fetchEvent } from "../lib/anvil";
import { downloadPacket, postPacketToSlack } from "../lib/packet";
import { useEditLock } from "../lib/useEditLock";
import { deriveStatus } from "../lib/checklist";
import Checklist from "../tabs/Checklist";
import ShowInfo from "../tabs/ShowInfo";
import DaySheets from "../tabs/DaySheets";
import Contacts from "../tabs/Contacts";

const TABS = [
  { id: "checklist", label: "Check list" },
  { id: "showinfo", label: "Show info" },
  { id: "days", label: "Day sheets" },
  { id: "contacts", label: "Contacts" },
];

const SAVE_DELAY = 900;

export default function EventDetail({ eventId, user, onBack }) {
  const [event, setEvent] = useState(null);
  const [tab, setTab] = useState("checklist");
  const [saveState, setSaveState] = useState("idle");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [posting, setPosting] = useState(false);

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

  function updateContacts(contacts) {
    setEvent((prev) => ({ ...prev, contacts }));
    queueSave({ contacts });
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

  async function exportPdf() {
    setExporting(true);
    setError(null);
    try {
      await downloadPacket(event);
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  async function sendToSlack() {
    setPosting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await postPacketToSlack(event);

      // Remember the channel so the next post reuses it instead of hunting by name.
      if (result.channelId && result.channelId !== event.slackChannelId) {
        setEvent((prev) => ({
          ...prev,
          slackChannelId: result.channelId,
          slackChannelName: result.channelName,
        }));
        await saveEvent(eventId, {
          slackChannelId: result.channelId,
          slackChannelName: result.channelName,
        });
      }

      const invited = result.invitedCount || 0;
      setNotice(
        (result.created
          ? `Created #${result.channelName} and posted the schedule.`
          : `Posted the schedule to #${result.channelName}.`) +
          (invited ? ` Invited ${invited} ${invited === 1 ? "person" : "people"}.` : "")
      );
    } catch (e) {
      // Even on failure the channel may now exist; hold onto its ID.
      if (e.channelId && e.channelId !== event.slackChannelId) {
        await saveEvent(eventId, {
          slackChannelId: e.channelId,
          slackChannelName: e.channelName,
        }).catch(() => {});
      }
      setError(e.message);
    } finally {
      setPosting(false);
    }
  }

  if (error && !event) return <div className="banner banner-error">{error}</div>;
  if (!event) return <div className="loading">Loading…</div>;

  const meta = event.meta || {};
  const status = deriveStatus(event);
  const lockedByOther = lock && !isMine && !isStale;
  const hasPacket =
    (event.days?.length || 0) > 0 ||
    (event.showInfo?.length || 0) > 0 ||
    (event.contacts?.length || 0) > 0;

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

      {notice && (
        <div className="banner banner-info">
          {notice}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>
            Dismiss
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
            {event.slackChannelName && (
              <span>
                Slack <b>#{event.slackChannelName}</b>
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
      {tab === "contacts" && (
        <Contacts contacts={event.contacts || []} canEdit={canEdit} onChange={updateContacts} />
      )}

      <div className="packet-bar">
        <div>
          <div className="packet-title">Crew packet</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {hasPacket
              ? "Show info, contacts, and the full schedule, ready for the crew."
              : "Add show info, contacts, or a day sheet to build the packet."}
          </div>
        </div>
        <div className="packet-actions">
          <button className="btn btn-sm" onClick={exportPdf} disabled={exporting || !hasPacket}>
            {exporting ? "Building…" : "Download PDF"}
          </button>
          <button
            className="btn btn-sm btn-primary"
            onClick={sendToSlack}
            disabled={posting || !hasPacket}
          >
            {posting ? "Posting…" : event.slackChannelId ? "Post update to Slack" : "Send to Slack"}
          </button>
        </div>
      </div>
    </div>
  );
}
