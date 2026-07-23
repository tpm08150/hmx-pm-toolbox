/**
 * Contacts sync: pull who's assigned to the event's Shiftboard crew and merge
 * them into the contacts sheet.
 */
import { fetchRoster } from "./roster";

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

export async function fetchAssignments({ workgroup, start, end }) {
  if (!BASE || !KEY) {
    throw new Error("Sync isn't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const params = new URLSearchParams({ workgroup });
  if (start) params.set("start", start);
  if (end) params.set("end", end);

  const res = await fetch(`${BASE}/assignments?${params}`, {
    headers: { "X-Toolbox-Key": KEY },
  });

  if (res.status === 401) throw new Error("Sync rejected the toolbox key.");

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Couldn't read assignments (${res.status}).`);
  }
  return data;
}

/**
 * Merge Shiftboard assignments into the existing contacts.
 *
 * Three rules, in order of what they protect:
 *   - Hand-added contacts (client, venue rep) are never touched.
 *   - Someone already on the sheet keeps their row; only blank fields fill in,
 *     so a corrected phone number or role survives the sync.
 *   - Someone no longer assigned is marked, not deleted — the PM decides.
 *
 * Returns { contacts, added, updated, dropped }.
 */
export function mergeAssignments(existing, assignments, roster) {
  const rosterFor = (shiftboardId) =>
    (roster || []).find((p) => p.id === shiftboardId) || {};

  const assigned = new Map(assignments.map((a) => [a.shiftboardId, a]));
  const seen = new Set();
  let added = 0;
  let updated = 0;
  let dropped = 0;

  const contacts = (existing || []).map((c) => {
    // Anything the PM typed in stays exactly as it is.
    if (c.source !== "shiftboard" && !c.shiftboardId) return c;

    const match =
      assigned.get(c.shiftboardId) ||
      assignments.find(
        (a) => a.name.trim().toLowerCase() === (c.name || "").trim().toLowerCase()
      );

    if (!match) {
      // Still on the sheet, no longer on the schedule.
      if (!c.unassigned) dropped += 1;
      return { ...c, unassigned: true };
    }

    seen.add(match.shiftboardId);

    const person = rosterFor(match.shiftboardId);
    const next = { ...c, unassigned: false, shiftboardId: match.shiftboardId };
    let changed = false;

    // Only fill gaps — an edited value is the PM's call, not Shiftboard's.
    const fill = (field, value) => {
      if (!next[field] && value) {
        next[field] = value;
        changed = true;
      }
    };

    fill("role", match.role);
    fill("location", match.location);
    fill("mobile", match.mobile);
    fill("email", person.email);
    fill("slackId", person.slackId);

    if (changed) updated += 1;
    return next;
  });

  for (const a of assignments) {
    if (seen.has(a.shiftboardId)) continue;

    // Skip anyone already on the sheet by name, however they got there.
    const byName = contacts.find(
      (c) => (c.name || "").trim().toLowerCase() === a.name.trim().toLowerCase()
    );
    if (byName) {
      byName.shiftboardId = a.shiftboardId;
      byName.unassigned = false;
      if (!byName.role && a.role) byName.role = a.role;
      if (!byName.location && a.location) byName.location = a.location;
      if (!byName.mobile && a.mobile) byName.mobile = a.mobile;
      continue;
    }

    const person = rosterFor(a.shiftboardId);
    contacts.push({
      id: crypto.randomUUID(),
      source: "shiftboard",
      shiftboardId: a.shiftboardId,
      name: a.name,
      role: a.role || "",
      location: a.location || "",
      email: person.email || "",
      mobile: a.mobile || "",
      slackId: person.slackId || "",
      unassigned: false,
    });
    added += 1;
  }

  return { contacts, added, updated, dropped };
}

/** Pull assignments and the roster together, then merge. */
export async function syncContactsFromShiftboard({ event }) {
  const crew = event.shiftboardCrew;
  if (!crew?.id) {
    throw new Error("Link a Shiftboard crew on the Timecards tab first.");
  }

  const meta = event.meta || {};
  const { people } = await fetchAssignments({
    workgroup: crew.id,
    start: meta.plannedStart,
    end: meta.plannedEnd || meta.plannedStart,
  });

  // The roster fills in emails and Slack IDs, which shifts don't carry.
  let roster = [];
  try {
    roster = (await fetchRoster()).people;
  } catch {
    // Sync is still worth doing without them.
  }

  return mergeAssignments(event.contacts || [], people, roster);
}
