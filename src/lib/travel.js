/**
 * Travel requests: per diem math runs here (so the rate is always the current
 * settings value), then the assembled request goes to Anvil to email.
 */
import { fetchRoster } from "./roster";

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

/** Per diem = rate × travel days, where days = nights + 1 (both ends count). */
export function perDiemTotal(departureDate, returnDate, rate) {
  if (!departureDate || !returnDate) return null;
  const start = new Date(`${departureDate}T00:00:00`);
  const end = new Date(`${returnDate}T00:00:00`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;

  const nights = Math.round((end - start) / 86400000);
  const days = nights + 1;
  return days * rate;
}

export function formatMoney(n) {
  if (n == null) return "";
  return `$${n.toFixed(2)}`;
}

/**
 * Find the PM's email from the Shiftboard roster by name. Returns "" if the
 * Flex PM name doesn't match anyone — the caller flags that rather than
 * silently dropping the PM from the recipients.
 */
export async function pmEmailFromRoster(pmName) {
  if (!pmName || pmName === "un-assigned") return "";
  try {
    const { people } = await fetchRoster();
    const match = people.find(
      (p) => p.name.trim().toLowerCase() === pmName.trim().toLowerCase()
    );
    return match?.email || "";
  } catch {
    return "";
  }
}

/**
 * Assemble and send. Adds the PM's own email to every selected type's
 * recipients, computes per diem per traveler, and posts to Anvil.
 */
export async function sendTravelRequest({ event, request, settings }) {
  if (!BASE || !KEY) {
    throw new Error("Travel isn't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const meta = event.meta || {};
  const rate = Number(settings.perDiemRate) || 59.5;

  const travelers = (request.travelers || []).map((t) => ({
    name: t.name || "",
    departureCity: t.departureCity || "",
    destinationCity: t.destinationCity || "",
    departureDate: t.departureDate || "",
    returnDate: t.returnDate || "",
    perDiemTotal: request.types.perDiem
      ? formatMoney(perDiemTotal(t.departureDate, t.returnDate, rate))
      : "",
  }));

  const pmEmail = await pmEmailFromRoster(meta.pmName);
  const withPm = (list) => {
    const set = [...(list || [])];
    if (pmEmail && !set.includes(pmEmail)) set.push(pmEmail);
    return set;
  };

  const payload = {
    showName: meta.showName || "",
    pmName: meta.pmName || "",
    notes: request.notes || "",
    types: request.types,
    recipients: {
      perDiem: withPm(settings.travel.perDiemRecipients),
      flight: withPm(settings.travel.flightRecipients),
      hotel: withPm(settings.travel.hotelRecipients),
    },
    travelers,
  };

  const res = await fetch(`${BASE}/travel/send`, {
    method: "POST",
    headers: { "X-Toolbox-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Send failed (${res.status}).`);
  }

  return { ...data, pmEmailMissing: !pmEmail && meta.pmName !== "un-assigned" };
}
