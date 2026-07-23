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

const FLEX_OWNED = ["pmName", "salesperson", "plannedStart", "plannedEnd", "totalPrice", "docNumber"];
const PM_EDITABLE = ["showName", "venue", "client"];

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
      contacts: [],
      lock: null,
    });
    return "created";
  }

  const existing = snap.data().meta || {};
  const patch = {};

  if (overwriteMeta) {
    for (const key of [...FLEX_OWNED, ...PM_EDITABLE]) {
      if (flexEvent[key] !== undefined && flexEvent[key] !== "") {
        patch[`meta.${key}`] = flexEvent[key];
      }
    }
  } else {
    for (const key of FLEX_OWNED) {
      const incoming = flexEvent[key];
      if (incoming === undefined || incoming === "") continue;
      if (existing[key] !== incoming) patch[`meta.${key}`] = incoming;
    }
    for (const key of PM_EDITABLE) {
      if (!existing[key] && flexEvent[key]) patch[`meta.${key}`] = flexEvent[key];
    }
  }

  if (!Object.keys(patch).length) return "unchanged";

  patch["meta.updatedAt"] = serverTimestamp();
  await updateDoc(ref, patch);
  return overwriteMeta ? "updated" : "touched";
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

export { serverTimestamp };
