import { useState, useEffect, useRef } from "react";

/**
 * A number field that survives a re-render.
 *
 * The expense sheet recomputes everything on each change, which recreates the
 * inputs and steals focus after a single keystroke. Keeping the typed text in
 * local state and only reporting it upward on blur — or after a pause — lets
 * someone type "12500" without the field jumping out from under them.
 */
export default function MoneyInput({
  value,
  onCommit,
  disabled,
  placeholder = "0.00",
  step = "0.01",
  className = "",
  ariaLabel,
}) {
  const [text, setText] = useState(fmt(value));
  const editing = useRef(false);

  // Track outside changes, but never while the field is being typed in.
  useEffect(() => {
    if (!editing.current) setText(fmt(value));
  }, [value]);

  function commit() {
    editing.current = false;
    const next = text === "" ? 0 : Number(text);
    if (Number.isNaN(next)) {
      setText(fmt(value));
      return;
    }
    if (next !== Number(value || 0)) onCommit(next);
  }

  return (
    <input
      className={`cell-input mono num entry ${className}`}
      type="number"
      step={step}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setText(fmt(value));
          editing.current = false;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A text field with the same focus-keeping behaviour. */
export function TextInput({
  value,
  onCommit,
  disabled,
  placeholder,
  className = "",
  ariaLabel,
}) {
  const [text, setText] = useState(value || "");
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(value || "");
  }, [value]);

  return (
    <input
      className={`cell-input ${className}`}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={text}
      disabled={disabled}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        editing.current = false;
        if (text !== (value || "")) onCommit(text);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

function fmt(n) {
  if (n == null || n === "") return "";
  return String(n);
}
