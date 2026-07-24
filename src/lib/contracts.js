/**
 * Contract generation, through the Anvil app that already talks to Flex and
 * fills the Word template. Drafts live in Firestore rather than an Anvil Data
 * Table, so the browser owns them.
 */
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

async function call(path, { method = "GET", body } = {}) {
  if (!BASE || !KEY) {
    throw new Error("Contracts aren't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const options = { method, headers: { "X-Toolbox-Key": KEY } };
  if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE}${path}`, options);
  if (res.status === 401) throw new Error("Contracts rejected the toolbox key.");

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Request failed (${res.status}).`);
  }
  return data;
}

/** Quotes for one month, for the picker. */
export function fetchContractList({ year, month }) {
  return call(`/contract/list?year=${year}&month=${month}`);
}

/** Everything the form needs: header, addresses, totals, categories. */
export function fetchContractData(documentId, { refresh = false } = {}) {
  const params = new URLSearchParams({ id: documentId });
  if (refresh) params.set("refresh", "1");
  return call(`/contract/data?${params}`);
}

/** Deposit and balance dates suggested from load-in. */
export function fetchDefaultDates(loadIn) {
  return call(`/contract/dates?loadIn=${encodeURIComponent(loadIn || "")}`);
}

export function fetchSalesperson(name) {
  return call(`/contract/salesperson?name=${encodeURIComponent(name || "")}`);
}

/**
 * Build the contract and hand it back as a download.
 *
 * The Word template and python-docx live in Anvil, so the document is made
 * there and streamed here rather than assembled in the browser.
 */
export async function generateContract(formData) {
  const res = await fetch(`${BASE}/contract/generate`, {
    method: "POST",
    headers: { "X-Toolbox-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(formData),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error || `Couldn't build the contract (${res.status}).`);
  }

  const blob = await res.blob();
  const name =
    res.headers.get("X-Filename") ||
    `${(formData.event_name || "contract").replace(/[^\w\s-]/g, "").trim()}.docx`;

  return { blob, filename: name };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Send the generated contract on to the client. */
export function emailContract({ formData, recipient }) {
  return call("/contract/email", {
    method: "POST",
    body: { formData, recipient },
  });
}

// ── Drafts ───────────────────────────────────────────────────────────────────

/**
 * A contract in progress, keyed by its Flex document id.
 *
 * These were an Anvil Data Table; Firestore keeps them next to everything else
 * the toolbox stores and means the browser can read one without a round trip
 * through Anvil.
 */
export async function loadDraft(documentId) {
  if (!documentId) return null;
  const snap = await getDoc(doc(db, "contractDrafts", documentId));
  return snap.exists() ? snap.data() : null;
}

export async function saveDraft(documentId, draft, user) {
  if (!documentId) return;
  await setDoc(
    doc(db, "contractDrafts", documentId),
    {
      ...draft,
      savedBy: user?.displayName || user?.email || "",
      savedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function clearDraft(documentId) {
  if (!documentId) return;
  await deleteDoc(doc(db, "contractDrafts", documentId));
}

// ── Shaping ──────────────────────────────────────────────────────────────────

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Year 1 is the quoted price; later years compound from it.
 *
 * The inflation figure applies to Year 2 onward — applying it to Year 1 would
 * quietly raise the number the client already agreed to.
 */
export function yearTotals(baseTotal, inflationPct, years) {
  const rate = 1 + (Number(inflationPct) || 0) / 100;
  const out = [Number(baseTotal) || 0];
  for (let i = 1; i < (Number(years) || 1); i++) {
    out.push(out[0] * Math.pow(rate, i));
  }
  return out;
}

export function money(n) {
  return `$${(Number(n) || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
