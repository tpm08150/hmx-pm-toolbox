/**
 * Task IDs are permanent. Renaming a task's label is safe; changing its id
 * orphans every completion already recorded against it. Add new tasks with
 * new ids rather than reusing retired ones.
 */
export const DEFAULT_TASKS = [
  { id: "handoff", phase: "planning", label: "Hand-off conversation with salesman & mark the date in PM schedule" },
  { id: "client-discuss", phase: "planning", label: "Contact client to discuss event (schedule, needs, any additional needs/upsell)" },
  { id: "gear-list", phase: "planning", label: "Create a gear list from Flex" },
  { id: "subrents", phase: "planning", label: "Confirm sub-rents and receive a PO, add sub-rentals to shipping/trucking lists" },
  { id: "est-expenses", phase: "planning", label: "Fill in estimated expenses on expense sheet" },
  { id: "layout", phase: "planning", label: "Create a production layout" },
  { id: "timeline", phase: "planning", label: "Confirm timeline/schedule with client and venue" },
  { id: "labor-truck", phase: "planning", label: "Create labor and truck schedule, send to Katie and Tyler" },
  { id: "resume", phase: "planning", label: "Create production resume" },
  { id: "show-flow", phase: "planning", label: "Create a show flow (if the client is not providing it)" },
  { id: "send-crew", phase: "planning", label: "Send event resume, layout, gear list and all other pertinent documents to crew" },
  { id: "change-order", phase: "planning", label: "Create change order if client's needs are different than contract" },
  { id: "lead-meeting", phase: "planning", label: "Meet with leads prior to show prep" },
  { id: "pack", phase: "planning", label: "Make sure all equipment gets packed appropriately" },

  { id: "crew-meeting", phase: "onsite", label: "Start of day meeting with crew — go over expectations and responsibilities" },
  { id: "client-checkin", phase: "onsite", label: "Check in with client at beginning and end of each day, and before meal breaks" },
  { id: "eod-meeting", phase: "onsite", label: "End each day with meeting to confirm next day's call time and tasks" },

  { id: "turn-in-co", phase: "post", label: "Turn in change order — must be signed by client" },
  { id: "return-subs", phase: "post", label: "Make sure sub-rentals get returned on time" },
  { id: "approve-labor", phase: "post", label: "Approve all labor through Shiftboard" },
  { id: "prod-report", phase: "post", label: "Email production report to production list and place in drive event folder" },
  { id: "scan-docs", phase: "post", label: "Scan any related event documents and place on drive" },
  { id: "post-meeting", phase: "post", label: "Schedule post event meeting with salesperson (when necessary)" },
  { id: "actuals", phase: "post", label: "Fill out actuals on expense sheet" },
  { id: "thank-you", phase: "post", label: "Send thank you note to client" },
];

export const PHASES = [
  { id: "planning", label: "Planning" },
  { id: "onsite", label: "On site" },
  { id: "post", label: "Following event" },
];

/**
 * Status comes from where today sits relative to the event dates, then from
 * checklist progress once the event is over. Nobody sets it by hand, so it
 * can't go stale.
 */
export function deriveStatus(event, tasks = DEFAULT_TASKS) {
  const meta = event?.meta || {};
  const start = parseDay(meta.plannedStart);
  const end = parseDay(meta.plannedEnd);
  const today = startOfDay(new Date());

  if (!start || !end) return { id: "unscheduled", label: "No dates" };

  if (today < start) {
    const progress = phaseProgress(event, tasks, "planning");
    if (progress.done === 0) return { id: "not-started", label: "Not started" };
    if (progress.done === progress.total) return { id: "ready", label: "Ready" };
    return { id: "planning", label: "Planning" };
  }

  if (today >= start && today <= end) {
    return { id: "onsite", label: "On site" };
  }

  const post = phaseProgress(event, tasks, "post");
  if (post.done === post.total) return { id: "closed", label: "Closed" };
  return { id: "post", label: "Post event" };
}

export function phaseProgress(event, tasks, phase) {
  const checklist = event?.checklist || {};
  const relevant = tasks.filter((t) => t.phase === phase);
  const done = relevant.filter((t) => checklist[t.id]?.done).length;
  return { done, total: relevant.length };
}

export function overallProgress(event, tasks = DEFAULT_TASKS) {
  const checklist = event?.checklist || {};
  const done = tasks.filter((t) => checklist[t.id]?.done).length;
  return { done, total: tasks.length };
}

function parseDay(str) {
  if (!str) return null;
  const [y, m, d] = String(str).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
