/**
 * Crew packet: PDF download and Slack posting, both handled Anvil-side so the
 * Slack token never reaches the browser.
 */

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

/** Only the parts of the event the packet needs — no checklist, no lock. */
function packetPayload(event) {
  return {
    meta: event.meta || {},
    showInfo: event.showInfo || [],
    days: event.days || [],
    contacts: event.contacts || [],
    slackChannelId: event.slackChannelId || null,
  };
}

async function post(path, body) {
  if (!BASE || !KEY) {
    throw new Error(
      "Export isn't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY."
    );
  }

  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "X-Toolbox-Key": KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) throw new Error("Export rejected the toolbox key.");
  return res;
}

/**
 * Build the packet and hand it to the browser as a download.
 */
export async function downloadPacket(event) {
  const res = await post("/packet/pdf", packetPayload(event));

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error || `Couldn't build the PDF (${res.status}).`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filenameFor(event);
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Give the download a moment to start before revoking the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Create or reuse the event's Slack channel, then post the packet to it.
 * Returns { channelId, channelName, created, invited }.
 */
export async function postPacketToSlack(event) {
  const res = await post("/packet/slack", packetPayload(event));
  const data = await res.json().catch(() => null);

  if (!res.ok || data?.error) {
    const err = new Error(data?.error || `Slack post failed (${res.status}).`);
    // The channel may exist even when the upload failed — pass it back so the
    // toolbox can still save the ID rather than creating a duplicate later.
    err.channelId = data?.channelId;
    err.channelName = data?.channelName;
    throw err;
  }

  return data;
}

function filenameFor(event) {
  const name = (event.meta?.showName || "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `${name}_schedule.pdf`;
}
