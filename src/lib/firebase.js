import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCeYKgrRN1yU9lNweFKpIeANPwh0virakA",
  authDomain: "hmx-pm-toolbox.firebaseapp.com",
  projectId: "hmx-pm-toolbox",
  storageBucket: "hmx-pm-toolbox.firebasestorage.app",
  messagingSenderId: "455425555316",
  appId: "1:455425555316:web:45ff77e17f84f922c70a21",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ── Auth ─────────────────────────────────────────────────────────────────────

const provider = new GoogleAuthProvider();

export function signIn() {
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * The allowlist is a Firestore collection keyed by email. A user who signs in
 * with Google but has no allowlist doc gets read-nothing access, enforced by
 * the security rules — this check just gives them a clear message instead of
 * a wall of permission errors.
 */
export async function checkAllowed(email) {
  if (!email) return null;
  const snap = await getDoc(doc(db, "allowlist", email.toLowerCase()));
  return snap.exists() ? snap.data() : null;
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function listEvents() {
  const q = query(collection(db, "events"), orderBy("meta.plannedStart", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getEvent(eventId) {
  const snap = await getDoc(doc(db, "events", eventId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveEvent(eventId, patch) {
  await updateDoc(doc(db, "events", eventId), {
    ...patch,
    "meta.updatedAt": serverTimestamp(),
  });
}

/**
 * Create the event doc if it's new, or refresh only the Flex-sourced meta
 * fields if it exists. Never clobbers PM-entered content — a PM who renamed
 * the show or corrected the venue keeps their edit.
 */
export async function upsertEventFromFlex(flexEvent, { overwriteMeta = false } = {}) {
  const ref = doc(db, "events", flexEvent.flexId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      meta: {
        flexId: flexEvent.flexId,
        docNumber: flexEvent.docNumber || "",
        showName: flexEvent.showName || "",
        venue: flexEvent.venue || "",
        client: flexEvent.client || "",
        pmName: flexEvent.pmName || "un-assigned",
        salesperson: flexEvent.salesperson || "",
        plannedStart: flexEvent.plannedStart || "",
        plannedEnd: flexEvent.plannedEnd || "",
        totalPrice: flexEvent.totalPrice || 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      checklist: {},
      showInfo: defaultShowInfo(),
      days: [],
      lock: null,
    });
    return "created";
  }

  if (overwriteMeta) {
    const patch = {};
    for (const key of [
      "docNumber",
      "showName",
      "venue",
      "client",
      "pmName",
      "salesperson",
      "plannedStart",
      "plannedEnd",
      "totalPrice",
    ]) {
      if (flexEvent[key] !== undefined && flexEvent[key] !== "") {
        patch[`meta.${key}`] = flexEvent[key];
      }
    }
    patch["meta.updatedAt"] = serverTimestamp();
    await updateDoc(ref, patch);
    return "updated";
  }

  // Existing doc, light sync: only fill fields that are still empty.
  const existing = snap.data().meta || {};
  const patch = {};
  for (const key of ["docNumber", "plannedStart", "plannedEnd", "totalPrice"]) {
    if (!existing[key] && flexEvent[key]) patch[`meta.${key}`] = flexEvent[key];
  }
  if (Object.keys(patch).length) {
    patch["meta.updatedAt"] = serverTimestamp();
    await updateDoc(ref, patch);
    return "touched";
  }
  return "unchanged";
}

function defaultShowInfo() {
  return [
    { id: crypto.randomUUID(), header: "Audio", body: "", order: 0 },
    { id: crypto.randomUUID(), header: "Lighting", body: "", order: 1 },
    { id: crypto.randomUUID(), header: "Video", body: "", order: 2 },
    { id: crypto.randomUUID(), header: "Rigging", body: "", order: 3 },
    { id: crypto.randomUUID(), header: "Power", body: "", order: 4 },
  ];
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings() {
  const snap = await getDoc(doc(db, "settings", "global"));
  return snap.exists() ? snap.data() : null;
}

export async function saveSettings(patch) {
  await setDoc(doc(db, "settings", "global"), patch, { merge: true });
}

export { serverTimestamp };
