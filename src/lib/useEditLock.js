import { useEffect, useState, useCallback, useRef } from "react";
import { doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const BEAT_MS = 30_000; // how often the holder refreshes the lock
const STALE_MS = 120_000; // how long before an unrefreshed lock is up for grabs

/**
 * One person edits, everyone else watches. The holder rewrites a timestamp
 * every 30 seconds; if that stops for two minutes — closed laptop, dead
 * battery, lost tab — the lock goes stale and anyone can claim it. There is
 * also a manual takeover for the impatient case.
 */
export function useEditLock(eventId, user) {
  const [lock, setLock] = useState(undefined); // undefined = still loading
  const beatRef = useRef(null);

  const isMine = !!(lock && user && lock.uid === user.uid);
  const isStale = !!(lock && lockAge(lock) > STALE_MS);
  const canEdit = isMine && !isStale ? true : !lock || isStale;

  useEffect(() => {
    if (!eventId) return;
    const ref = doc(db, "events", eventId);
    return onSnapshot(ref, (snap) => {
      setLock(snap.exists() ? snap.data().lock || null : null);
    });
  }, [eventId]);

  const claim = useCallback(async () => {
    if (!eventId || !user) return;
    await updateDoc(doc(db, "events", eventId), {
      lock: {
        uid: user.uid,
        name: user.displayName || user.email,
        acquiredAt: Date.now(),
        beatAt: Date.now(),
      },
    });
  }, [eventId, user]);

  const release = useCallback(async () => {
    if (!eventId) return;
    await updateDoc(doc(db, "events", eventId), { lock: null });
  }, [eventId]);

  // Keep the heartbeat going while this tab holds the lock.
  useEffect(() => {
    if (!isMine || !eventId) return;

    beatRef.current = setInterval(() => {
      updateDoc(doc(db, "events", eventId), { "lock.beatAt": Date.now() }).catch(
        () => {}
      );
    }, BEAT_MS);

    return () => clearInterval(beatRef.current);
  }, [isMine, eventId]);

  // Best-effort release when the tab closes. Not guaranteed, which is exactly
  // why the staleness check exists.
  useEffect(() => {
    if (!isMine) return;
    const handler = () => {
      navigator.sendBeacon?.("");
      release();
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, [isMine, release]);

  return { lock, isMine, isStale, canEdit, claim, release };
}

function lockAge(lock) {
  const beat = lock.beatAt || lock.acquiredAt || 0;
  return Date.now() - beat;
}
