/**
 * PO requests: venue and account codes, routing, quote handling, and sending.
 */
import { getSettings } from "./settings";
import { uploadFile, forgetListing } from "./files";

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

export const VENUE_CODES = [
  { code: "01", label: "Rental" },
  { code: "10", label: "Bartle" },
  { code: "11", label: "Bartle Store" },
  { code: "12", label: "Glen" },
  { code: "13", label: "Kauffman" },
];

/**
 * `rental` decides which recipient list the request goes to — subrents, labor,
 * and trucking are handled by a different group than purchases.
 */
export const ACCOUNT_CODES = [
  { code: "4782", label: "Subrent Equipment", rental: true },
  { code: "4787", label: "Intercompany Services (Illusions, AV Solutions)", rental: true },
  { code: "4785", label: "Subrent Services", rental: true },
  { code: "4640", label: "Local IATSE", rental: true },
  { code: "4650", label: "Contract Labor or Out of Town Labor", rental: true },
  { code: "4730", label: "Trucking/Vehicle", rental: true },
  { code: "4500", label: "Audio Purchase", rental: false },
  { code: "4510", label: "Lighting Purchase", rental: false },
  { code: "4520", label: "Video Purchase", rental: false },
  { code: "4540", label: "Purchases Other", rental: false },
  { code: "4570", label: "Purchases Staging", rental: false },
  { code: "4580", label: "Direct Expense", rental: false },
  { code: "4590", label: "Parts & Repair", rental: false },
  { code: "4795", label: "Meals and Per Diem", rental: false },
  { code: "5545", label: "Meal Expense", rental: false },
  { code: "5547", label: "Mileage and Parking", rental: false },
  { code: "4729", label: "Fuel", rental: false },
];

export const FREIGHT_OPTIONS = [
  "Freight Shipment",
  "Local Trucking Pickup",
  "Vendor Delivery or Pickup",
];

export const LOCATIONS = ["1111 Warehouse", "Bartle", "On-site (other)"];

/** Where quotes belong, by convention. */
export const QUOTES_FOLDER = "Subrents";

export function isRentalCode(accountCode) {
  return ACCOUNT_CODES.find((a) => a.code === accountCode)?.rental === true;
}

export function labelFor(list, code) {
  return list.find((i) => i.code === code)?.label || "";
}

/** Venue and account combine into one code, e.g. 01-4782. */
export function fullCode(venueCode, accountCode) {
  if (!venueCode || !accountCode) return "";
  return `${venueCode}-${accountCode}`;
}

/**
 * Who sees this request. Subrents and labor go to one group, purchases to
 * another, and the requester is always copied on their own request.
 */
export function recipientsFor({ settings, accountCode, requesterEmail, requesterName }) {
  const po = settings.po || {};
  const rental = isRentalCode(accountCode);
  const list = [...((rental ? po.rentalRecipients : po.purchaseRecipients) || [])];

  // A few people are only copied when a particular person is asking.
  for (const rule of po.extraRecipients || []) {
    if (rule.whenRequester && rule.whenRequester === requesterName && rule.email) {
      list.push(rule.email);
    }
  }

  if (requesterEmail) list.push(requesterEmail);

  return [...new Set(list.filter(Boolean))];
}

async function call(path, body) {
  if (!BASE || !KEY) {
    throw new Error("PO requests aren't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "X-Toolbox-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Request failed (${res.status}).`);
  }
  return data;
}

/** Turn a FileCloud file into a public link, for attaching to a request. */
export async function shareLinkFor(path) {
  const data = await call("/files/sharelink", { path });
  return { name: data.name, link: data.link, path: data.path };
}

/** Create a folder if it isn't there yet. */
export function ensureFolder(path) {
  return call("/files/ensurefolder", { path });
}

/**
 * Put a local file into the event's Subrents folder and return it as a link.
 *
 * Uploading rather than attaching keeps one copy of the quote, in the place
 * it belongs — an emailed attachment goes stale the moment the vendor revises
 * it, and nobody can find it later.
 */
export async function uploadQuote({ event, file, onProgress }) {
  const linked = event.fileCloudFolder;
  if (!linked?.path) {
    throw new Error("Link a FileCloud folder on the Files tab first.");
  }

  const folder = `${linked.path}/${QUOTES_FOLDER}`;
  await ensureFolder(folder);

  await uploadFile({ path: folder, file, onProgress });
  forgetListing(folder);

  return shareLinkFor(`${folder}/${file.name}`);
}

export async function sendPoRequest({ event, request, user }) {
  const settings = await getSettings();
  const meta = event.meta || {};

  const recipients = recipientsFor({
    settings,
    accountCode: request.accountCode,
    requesterEmail: user?.email,
    requesterName: user?.displayName,
  });

  const data = await call("/po/send", {
    kind: isRentalCode(request.accountCode) ? "Rental" : "Purchase/Maintenance",
    requesterName: user?.displayName || user?.email || "",
    requesterEmail: user?.email || "",
    eventName: meta.showName || "",
    eventDate: meta.plannedStart || "",
    location: request.location || meta.venue || "",
    vendor: request.vendor || "",
    itemDescription: request.itemDescription || "",
    cost: request.cost || "",
    charging: request.charging || "",
    venueLabel: labelFor(VENUE_CODES, request.venueCode),
    accountLabel: labelFor(ACCOUNT_CODES, request.accountCode),
    fullCode: fullCode(request.venueCode, request.accountCode),
    freightOption: request.freightOption || "",
    pickupLocation: request.pickupLocation || "",
    pickupDate: request.pickupDate || "",
    returnLocation: request.returnLocation || "",
    returnDate: request.returnDate || "",
    notes: request.notes || "",
    quotes: request.quotes || [],
    recipients,
  });

  return { ...data, recipients };
}
