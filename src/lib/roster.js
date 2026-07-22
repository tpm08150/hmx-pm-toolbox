/**
 * Crew roster, sourced from Shiftboard through the Anvil proxy.
 *
 * The roster changes rarely and the Shiftboard pull takes a few seconds, so
 * it's cached in memory for the session. Anything that needs it fresh can
 * pass { force: true }.
 */

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

let cache = null;
let inFlight = null;

export async function fetchRoster({ force = false, all = false } = {}) {
  if (!force && cache && !all) return cache;

  // Several components can ask at once on first load; share one request.
  if (!force && inFlight && !all) return inFlight;

  const run = (async () => {
    if (!BASE || !KEY) {
      throw new Error(
        "Roster isn't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY."
      );
    }

    const res = await fetch(`${BASE}/roster${all ? "?all=1" : ""}`, {
      headers: { "X-Toolbox-Key": KEY },
    });

    if (res.status === 401) throw new Error("Roster rejected the toolbox key.");

    const data = await res.json().catch(() => null);
    if (!res.ok || data?.error) {
      throw new Error(data?.error || `Couldn't load the roster (${res.status}).`);
    }

    if (!all) cache = data;
    return data;
  })();

  if (!all) inFlight = run;

  try {
    return await run;
  } finally {
    if (!all) inFlight = null;
  }
}

export function clearRosterCache() {
  cache = null;
}

/** Someone the PM typed in rather than picked from Shiftboard. */
export function makeGuestContact() {
  return {
    id: crypto.randomUUID(),
    source: "manual",
    name: "",
    role: "",
    email: "",
    mobile: "",
    slackId: "",
  };
}

/** A roster person pinned to this event, with a role for this show only. */
export function fromRoster(person) {
  return {
    id: crypto.randomUUID(),
    source: "roster",
    rosterId: person.id,
    name: person.name,
    role: "",
    email: person.email,
    mobile: person.mobile,
    slackId: person.slackId,
  };
}
