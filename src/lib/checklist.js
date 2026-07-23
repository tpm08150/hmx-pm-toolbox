/**
 * Task IDs are permanent. Renaming a task's label is safe; changing its id
 * orphans every completion already recorded against it. Add new tasks with
 * new ids rather than reusing retired ones.
 *
 * `prod-report` in particular is auto-checked when a production report sends,
 * so its id has to stay put.
 */
export const DEFAULT_TASKS = [
  // ── Planning ──────────────────────────────────────────────────────────
  { id: "p-handoff", phase: "planning", label: "Hand off conversation with sales" },
  { id: "p-intro", phase: "planning", label: "Sales person makes PM introduction to client" },
  { id: "p-client-details", phase: "planning", label: "Discuss event details with client — confirm timeline for load in/out, rehearsals, and basic run of show" },
  { id: "p-venue-timeline", phase: "planning", label: "Confirm event timeline with the venue" },
  { id: "p-labor-request", phase: "planning", label: "Create and send labor request" },
  { id: "p-gear-list", phase: "planning", label: "Review gear list from Casey and any subrentals — make sure you have all the equipment the event needs" },
  { id: "p-layouts", phase: "planning", label: "Review layouts, send update requests to Casey as needed" },
  { id: "p-show-info", phase: "planning", label: "Fill out show info and day sheets" },
  { id: "p-contacts", phase: "planning", label: "Once labor is assigned, review the assignments and build your show contacts sheet" },
  { id: "p-travel", phase: "planning", label: "If this is a travel show, request flights, hotels, and per diem — check the contract for which of those we're responsible for booking" },
  { id: "p-slack", phase: "planning", label: "Create the Slack channel and send layouts, gear list, schedules, show info, day sheets, and anything else the crew needs" },

  // ── Prep ──────────────────────────────────────────────────────────────
  { id: "prep-start", phase: "prep", label: "Meet with technicians at the start of each prep day to go over layouts, gear list, schedule, and expectations" },
  { id: "prep-end", phase: "prep", label: "Check in with technicians at the end of each day to discuss the plan for tomorrow" },
  { id: "prep-load", phase: "prep", label: "Make sure all gear is loaded onto trucks and drivers are assigned" },

  // ── On site ───────────────────────────────────────────────────────────
  { id: "os-start", phase: "onsite", label: "Start of day meeting with crew — timeline, expectations, and responsibilities" },
  { id: "os-intros", phase: "onsite", label: "Introduce any stage hands to the lead technicians they'll be working with" },
  { id: "os-client", phase: "onsite", label: "Check in with the client at the beginning and end of each day, and before any meal breaks" },
  { id: "os-end", phase: "onsite", label: "End each day with a crew meeting and confirm call backs" },

  // ── Following event ───────────────────────────────────────────────────
  { id: "fe-change-orders", phase: "post", label: "Follow up with sales on any change orders" },
  { id: "fe-subrentals", phase: "post", label: "Help make sure subrentals are returned" },
  { id: "fe-timecards", phase: "post", label: "Approve timecards" },
  // Kept from the original set — the production report auto-checks this one.
  { id: "prod-report", phase: "post", label: "Submit production report and tech review" },
  { id: "fe-pictures", phase: "post", label: "Post event pictures to the FileCloud folder" },
  { id: "fe-meeting", phase: "post", label: "Schedule the post event meeting with the salesperson" },
  { id: "fe-invoices", phase: "post", label: "Review and approve all event invoices from accounting" },
  { id: "fe-actuals", phase: "post", label: "Fill out actuals on the budget sheet" },
];

export const PHASES = [
  { id: "planning", label: "Planning" },
  { id: "prep", label: "Prep" },
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
    // Prep counts toward readiness — a show isn't ready if the trucks aren't
    // loaded, whatever the planning list says.
    const planning = phaseProgress(event, tasks, "planning");
    const prep = phaseProgress(event, tasks, "prep");
    const done = planning.done + prep.done;
    const total = planning.total + prep.total;

    if (done === 0) return { id: "not-started", label: "Not started" };
    if (done === total) return { id: "ready", label: "Ready" };
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
