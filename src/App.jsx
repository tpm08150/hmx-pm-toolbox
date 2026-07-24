import { useState, useEffect } from "react";
import { watchAuth, signIn, signOut, checkAllowed } from "./lib/firebase";
import { useTheme } from "./lib/useTheme";
import { roleOf, sectionsFor, landingFor, canSee, ROLES } from "./lib/roles";
import EventList from "./components/EventList";
import EventDetail from "./components/EventDetail";
import Roster from "./components/Roster";
import Settings from "./components/Settings";
import Budgets from "./components/Budgets";
import Sales from "./components/Sales";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [allowed, setAllowed] = useState(null);
  const [view, setView] = useState(null);
  const [authError, setAuthError] = useState(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    return watchAuth(async (u) => {
      setUser(u);
      if (u) {
        try {
          setAllowed(await checkAllowed(u.email));
        } catch {
          setAllowed(null);
        }
      } else {
        setAllowed(null);
        setView(null);
      }
    });
  }, []);

  const role = roleOf(allowed);

  // Land wherever this person's role starts, once we know what it is.
  useEffect(() => {
    if (role && !view) setView({ name: landingFor(role) });
  }, [role, view]);

  if (user === undefined) {
    return <div className="loading">Loading…</div>;
  }

  if (!user) {
    return (
      <div className="signin">
        <div className="signin-card">
          <div className="eyebrow">HMX</div>
          <h1>PM Toolbox</h1>
          <p>Sign in with the Google account you use for work.</p>
          <button
            className="btn btn-primary"
            onClick={() => signIn().catch((e) => setAuthError(e.message))}
          >
            Sign in with Google
          </button>
          {authError && <p style={{ color: "var(--alert)", marginTop: 14 }}>{authError}</p>}
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="signin">
        <div className="signin-card">
          <div className="eyebrow">HMX</div>
          <h1>Not on the list</h1>
          <p>
            {user.email} doesn't have access yet. Ask Tyler to add you, then sign in again.
          </p>
          <button className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (!view) return <div className="loading">Loading…</div>;

  const sections = sectionsFor(role);

  /** An event detail page still counts as being in the events section. */
  const activeSection = view.name === "event" ? "events" : view.name;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          HMX <span>PM Toolbox</span>
        </div>

        <nav className="topnav">
          {sections.map((s) => (
            <button
              key={s.id}
              className={`topnav-item${activeSection === s.id ? " topnav-item-active" : ""}`}
              onClick={() => setView({ name: s.id })}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="topbar-spacer" />

        <div className="topbar-user">
          <button
            className="theme-toggle"
            onClick={toggle}
            title={theme === "dark" ? "Switch to light" : "Switch to dark"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>

          <span title={ROLES[role]?.label}>{user.displayName || user.email}</span>

          <button className="btn btn-ghost btn-sm" onClick={signOut} style={{ color: "#fff" }}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">
        {view.name === "event" && canSee(role, "events") && (
          <EventDetail
            eventId={view.eventId}
            user={user}
            onBack={() => setView({ name: "events" })}
          />
        )}

        {view.name === "events" && canSee(role, "events") && (
          <EventList user={user} onOpen={(eventId) => setView({ name: "event", eventId })} />
        )}

        {view.name === "sales" && canSee(role, "sales") && <Sales user={user} />}

        {view.name === "budgets" && canSee(role, "budgets") && (
          <Budgets
            onBack={() => setView({ name: landingFor(role) })}
            onOpenEvent={
              canSee(role, "events")
                ? (eventId) => setView({ name: "event", eventId })
                : undefined
            }
          />
        )}

        {view.name === "roster" && canSee(role, "roster") && (
          <Roster onBack={() => setView({ name: landingFor(role) })} />
        )}

        {view.name === "settings" && canSee(role, "settings") && (
          <Settings onBack={() => setView({ name: landingFor(role) })} />
        )}
      </main>
    </div>
  );
}
