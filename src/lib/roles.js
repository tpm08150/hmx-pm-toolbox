/**
 * Who sees what.
 *
 * A role decides which sections appear in the top bar and where someone lands
 * when they sign in. Everything is additive — a new role means a new entry
 * here rather than a condition scattered through the app.
 */

export const SECTIONS = [
  { id: "sales", label: "Sales" },
  { id: "events", label: "PMs" },
  { id: "budgets", label: "Budgets" },
  { id: "roster", label: "Roster" },
  { id: "settings", label: "Settings" },
];

export const ROLES = {
  admin: {
    label: "Admin",
    sections: ["sales", "events", "budgets", "roster", "settings"],
    landing: "events",
  },
  pm: {
    label: "Production manager",
    sections: ["events", "budgets", "roster"],
    landing: "events",
  },
  sales: {
    label: "Sales",
    sections: ["sales", "budgets", "roster"],
    landing: "sales",
  },
  // Left here deliberately: a technician portal is coming, and adding it now
  // means the shape doesn't have to change again later.
  tech: {
    label: "Technician",
    sections: ["roster"],
    landing: "roster",
  },
};

/**
 * An allowlist entry's role.
 *
 * Older entries only have `admin: true/false`, from before roles existed, so
 * those are read as admin or PM rather than being migrated by hand.
 */
export function roleOf(allowed) {
  if (!allowed) return null;
  const named = String(allowed.role || "").toLowerCase();
  if (ROLES[named]) return named;
  return allowed.admin === true ? "admin" : "pm";
}

export function sectionsFor(role) {
  const allowed = ROLES[role]?.sections || [];
  return SECTIONS.filter((s) => allowed.includes(s.id));
}

export function landingFor(role) {
  return ROLES[role]?.landing || "events";
}

export function canSee(role, section) {
  return (ROLES[role]?.sections || []).includes(section);
}
