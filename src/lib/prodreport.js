/**
 * Production report sending. Recipients come from settings; the assembled
 * report goes to Anvil, which sends the two emails.
 */
import { getSettings } from "./settings";

const BASE = import.meta.env.VITE_ANVIL_BASE;
const KEY = import.meta.env.VITE_TOOLBOX_KEY;

export async function sendProductionReport({ event, report }) {
  if (!BASE || !KEY) {
    throw new Error("Report sending isn't configured. Set VITE_ANVIL_BASE and VITE_TOOLBOX_KEY.");
  }

  const settings = await getSettings();
  const meta = event.meta || {};

  const payload = {
    showName: meta.showName || "",
    pmName: meta.pmName || "",
    wentWell: report.wentWell || "",
    wentWrong: report.wentWrong || "",
    nextYear: report.nextYear || "",
    techReviews: (report.techReviews || []).map((t) => ({
      name: t.name || "",
      role: t.role || "",
      attitude: t.attitude || "",
      technical: t.technical || "",
      prep: t.prep || "",
      customerService: t.customerService || "",
      notes: t.notes || "",
    })),
    reportRecipients: settings.prodReport.reportRecipients,
    reviewRecipients: settings.prodReport.reviewRecipients,
  };

  const res = await fetch(`${BASE}/prodreport/send`, {
    method: "POST",
    headers: { "X-Toolbox-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) {
    throw new Error(data?.error || `Send failed (${res.status}).`);
  }
  return data;
}
