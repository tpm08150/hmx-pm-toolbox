import { useState, useEffect } from "react";
import { watchAuth, signIn, signOut, checkAllowed } from "./lib/firebase";
import EventList from "./components/EventList";
import EventDetail from "./components/EventDetail";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking
  const [allowed, setAllowed] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [authError, setAuthError] = useState(null);

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
      }
    });
  }, []);

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
          {authError && (
            <p style={{ color: "var(--alert)", marginTop: 14 }}>{authError}</p>
          )}
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
            {user.email} doesn't have access yet. Ask Tyler to add you, then sign in
            again.
          </p>
          <button className="btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          HMX <span>PM Toolbox</span>
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-user">
          <span>{user.displayName || user.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={signOut} style={{ color: "#fff" }}>
            Sign out
          </button>
        </div>
      </header>

      <main className="main">
        {openId ? (
          <EventDetail eventId={openId} user={user} onBack={() => setOpenId(null)} />
        ) : (
          <EventList onOpen={setOpenId} />
        )}
      </main>
    </div>
  );
}
