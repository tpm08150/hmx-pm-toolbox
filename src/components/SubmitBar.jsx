/**
 * The submit bar every form ends with.
 *
 * Sticks to the bottom of the viewport so the action is reachable without
 * scrolling, while staying in the position that reads as "I'm done" — a
 * primary button at the top of a form fights the order you fill it in.
 */
export default function SubmitBar({
  label,
  busyLabel,
  busy = false,
  disabled = false,
  hint,
  onClick,
  children,
}) {
  return (
    <div className="submit-bar">
      {children}
      {hint && <span className="submit-hint">{hint}</span>}
      <div className="submit-spacer" />
      <button className="btn btn-send" onClick={onClick} disabled={busy || disabled}>
        {busy ? busyLabel || "Sending…" : label}
      </button>
    </div>
  );
}
