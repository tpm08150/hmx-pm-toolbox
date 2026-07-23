import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { DEFAULT_OT_RULES } from "./overtime";

/**
 * Company-wide settings in one Firestore doc, editable from the admin page.
 * These defaults seed it on first read and document the shape.
 */
export const DEFAULT_SETTINGS = {
  perDiemRate: 59.5,
  travel: {
    perDiemRecipients: ["kbarnes@harvestkc.com", "tmorton@harvestkc.com"],
    flightRecipients: [
      "rdavis@harvestkc.com",
      "tmorton@harvestkc.com",
      "kbarnes@harvestkc.com",
    ],
    hotelRecipients: [
      "rdavis@harvestkc.com",
      "tmorton@harvestkc.com",
      "kbarnes@harvestkc.com",
    ],
  },
  prodReport: {
    reportRecipients: [
      "gturcotte@harvestkc.com",
      "awilt@hmxlive.com",
      "ProductionManagers@harvestkc.com",
    ],
    reviewRecipients: [
      "tmorton@harvestkc.com",
      "jkoan@harvestkc.com",
      "kbarnes@harvestkc.com",
      "tnissen@harvestkc.com",
    ],
    // Events under this dollar amount don't need a production report, so they
    // don't count toward the reminder.
    reportThreshold: 10000,
  },
  po: {
    // Subrents, labor, and trucking are handled by a different group than
    // purchases, so the account code decides which list gets the request.
    rentalRecipients: [
      "tmorton@harvestkc.com",
      "weston@harvestkc.com",
      "therwig@harvestkc.com",
      "warehouse@harvestkc.com",
      "btoliver@harvestkc.com",
      "kcoffey@hmxlive.com",
    ],
    purchaseRecipients: [
      "tmorton@harvestkc.com",
      "tnissen@hmxlive.com",
      "jkoan@hmxlive.com",
      "btoliver@harvestkc.com",
      "kcoffey@hmxlive.com",
      "therwig@harvestkc.com",
    ],
    // Copied only when a particular person is the requester.
    extraRecipients: [
      { whenRequester: "James Wooten", email: "tnissen@hmxlive.com" },
    ],
  },
  labor: {
    // Hourly rates. Hands and riggers are both IATSE but bill differently.
    rates: {
      hands: 45,
      riggers: 55,
      contractors: 65,
      harvest: 40,
    },
    otRules: DEFAULT_OT_RULES,
  },
  expense: {
    // What each block should cost as a share of revenue. Overhead is whatever
    // the others leave.
    hardCostGoals: {
      equipment: 0.12,
      labor: 0.3,
      trucking: 0.02,
      profit: 0.03,
      equipmentPurchases: 0.13,
      overhead: 0.4,
    },
    // Below this, nobody builds a budget sheet, so the dashboard leaves the
    // show out. Separate from the production report threshold in case the two
    // ever need to diverge.
    budgetThreshold: 10000,
    // net = revenue less subrentals and non-Harvest labor; gross = revenue.
    commissionVenues: [
      { name: "Bartle Hall", rate: 0.2, basis: "net" },
      { name: "Kauffman Center", rate: 0.1, basis: "gross" },
    ],
    trucking: {
      dayRate: 125,
      fuelPerMile: 0.17,
      mpg: 6,
      fuelPrice: 4,
    },
  },
  files: {
    // Slack previews PDFs and images inline, so a copy beats a link up to a
    // point. Past this, a link keeps the channel usable.
    slackCopyMaxMb: 20,
  },
};

/**
 * Tech roles, kept for reference. The production report now takes role as free
 * text carried over from the contacts sheet, so nothing reads this today.
 */
export const TECH_ROLES = [
  "Lead Rigger", "A1", "A2", "A3", "FOH Engineer", "Monitors", "Broadcast Audio",
  "Stage Crew", "Wireless", "Audio Patch", "LD", "L1", "L2", "L3",
  "Master Electrician", "Electrician", "V1", "V2", "V3", "GFX", "Switcher Op",
  "Camera Op", "E2/Spyder Op", "Breakout Tech", "Tech", "Order Forms",
];

export const RATING_LEGEND = [
  { score: "5", label: "Great", text: "No issues, went above and beyond. Helped make other people's job easier." },
  { score: "4", label: "Good", text: "Had a minor issue or two, things to improve upon. Overall helpful to have on the show." },
  { score: "3", label: "OK", text: "Had a few issues, things that were avoidable with proper care and attention." },
  { score: "2", label: "Not Good", text: "Several small issues and possibly larger ones. Things that were avoidable." },
  { score: "1", label: "Bad", text: "Had more than one major issue, actively hurt the show with poor performance." },
];

let cache = null;

export async function getSettings({ force = false } = {}) {
  if (cache && !force) return cache;

  const snap = await getDoc(doc(db, "settings", "global"));
  cache = snap.exists() ? mergeDefaults(snap.data()) : { ...DEFAULT_SETTINGS };
  return cache;
}

export async function saveSettings(patch) {
  await setDoc(
    doc(db, "settings", "global"),
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true }
  );
  cache = null;
}

/**
 * Fill any gap a stored doc doesn't cover, so adding a new setting later
 * doesn't break older docs that predate it.
 */
function mergeDefaults(stored) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    travel: { ...DEFAULT_SETTINGS.travel, ...(stored.travel || {}) },
    prodReport: { ...DEFAULT_SETTINGS.prodReport, ...(stored.prodReport || {}) },
    po: { ...DEFAULT_SETTINGS.po, ...(stored.po || {}) },
    labor: {
      ...DEFAULT_SETTINGS.labor,
      ...(stored.labor || {}),
      rates: { ...DEFAULT_SETTINGS.labor.rates, ...(stored.labor?.rates || {}) },
      otRules: { ...DEFAULT_SETTINGS.labor.otRules, ...(stored.labor?.otRules || {}) },
    },
    expense: {
      ...DEFAULT_SETTINGS.expense,
      ...(stored.expense || {}),
      hardCostGoals: {
        ...DEFAULT_SETTINGS.expense.hardCostGoals,
        ...(stored.expense?.hardCostGoals || {}),
      },
      trucking: {
        ...DEFAULT_SETTINGS.expense.trucking,
        ...(stored.expense?.trucking || {}),
      },
      commissionVenues:
        stored.expense?.commissionVenues || DEFAULT_SETTINGS.expense.commissionVenues,
    },
    files: { ...DEFAULT_SETTINGS.files, ...(stored.files || {}) },
  };
}

export function clearSettingsCache() {
  cache = null;
}
