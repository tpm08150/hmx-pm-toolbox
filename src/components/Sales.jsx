import { useState, useEffect, useCallback } from "react";
import {
  fetchContractList,
  fetchContractData,
  fetchDefaultDates,
  fetchSalesperson,
  generateContract,
  downloadBlob,
  emailContract,
  loadDraft,
  saveDraft,
  yearTotals,
  money,
  MONTHS,
} from "../lib/contracts";
import SubmitBar from "./SubmitBar";
import MoneyInput, { TextInput } from "./MoneyInput";

const TABS = [
  { id: "event", label: "Event info" },
  { id: "categories", label: "Scope" },
  { id: "financials", label: "Financials" },
  { id: "generate", label: "Generate" },
];

export default function Sales({ user }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [docs, setDocs] = useState(null);
  const [searching, setSearching] = useState(false);

  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function search() {
    setSearching(true);
    setError(null);
    setDocs(null);
    try {
      const { documents } = await fetchContractList({ year, month });
      setDocs(documents);
    } catch (e) {
      setError(e.message);
    } finally {
      setSearching(false);
    }
  }

  async function open(doc) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchContractData(doc.id);
      setSelected({ ...data, id: doc.id, display: doc.display });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (selected) {
    return (
      <ContractForm
        data={selected}
        user={user}
        onBack={() => setSelected(null)}
      />
    );
  }

  const years = [now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear(),
                 now.getFullYear() + 1, now.getFullYear() + 2];

  return (
    <div>
      <div className="list-head">
        <div>
          <div className="eyebrow">Sales</div>
          <h1>Contracts</h1>
        </div>
      </div>

      {error && (
        <div className="banner banner-error">
          {error}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ maxWidth: 150 }}>
            <label htmlFor="c-month">Month</label>
            <select
              id="c-month"
              className="select"
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 110 }}>
            <label htmlFor="c-year">Year</label>
            <select
              id="c-year"
              className="select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={search} disabled={searching}>
            {searching ? "Searching…" : "Find quotes"}
          </button>
        </div>
      </div>

      {loading && <div className="loading">Loading the quote…</div>}

      {docs && !loading && (
        !docs.length ? (
          <div className="empty">
            <p>No quotes for {MONTHS[month - 1]} {year}.</p>
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="event-table">
              <thead>
                <tr>
                  <th style={{ width: 100 }}>Doc</th>
                  <th>Quote</th>
                  <th className="num" style={{ width: 130 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="event-row" onClick={() => open(d)}>
                    <td className="doc-num">{d.doc_number || "—"}</td>
                    <td className="event-name">{d.name || d.display}</td>
                    <td className="num mono">{money(d.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

/* ── The form ────────────────────────────────────────────────────────────── */

function ContractForm({ data, user, onBack }) {
  const header = data.header || {};
  const totals = data.totals || {};

  const [tab, setTab] = useState("event");
  const [form, setForm] = useState(() => initialForm(data));
  const [categories, setCategories] = useState(() =>
    (data.categories || []).map((c) => ({ ...c, scope: "" }))
  );
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [recipient, setRecipient] = useState("");

  // Pull anything saved earlier, plus the suggested dates and the
  // salesperson's details.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [draft, dates, sales] = await Promise.all([
          loadDraft(data.id),
          fetchDefaultDates(header.load_in).catch(() => ({})),
          header.salesperson
            ? fetchSalesperson(header.salesperson).catch(() => null)
            : null,
        ]);
        if (cancelled) return;

        setForm((f) => ({
          ...f,
          deposit_due: draft?.deposit_due || dates?.deposit_due || "",
          balance_due: draft?.balance_due || dates?.balance_due || "",
          salesperson_name: sales?.name || f.salesperson_name,
          salesperson_phone: sales?.phone || "",
          salesperson_email: sales?.email || "",
          ...(draft || {}),
        }));

        if (draft?.categories?.length) {
          setCategories((prev) =>
            prev.map((c) => {
              const saved = draft.categories.find((d) => d.name === c.name);
              return saved ? { ...c, scope: saved.scope || "" } : c;
            })
          );
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.id]);

  const patch = useCallback((next) => setForm((f) => ({ ...f, ...next })), []);

  // Drafts save on a delay, the same way event tabs do.
  useEffect(() => {
    const t = setTimeout(() => {
      saveDraft(data.id, { ...form, categories }, user).catch(() => {});
    }, 1200);
    return () => clearTimeout(t);
  }, [form, categories, data.id, user]);

  const baseTotal = Number(data.total_price) || 0;
  const years = Number(form.contract_years) || 1;
  const totalsByYear = yearTotals(baseTotal, form.year_increase_pct, years);
  const depositPct = (Number(form.deposit_pct) || 0) / 100;
  const deposit = baseTotal * depositPct;
  const balance = baseTotal - deposit;

  function buildPayload() {
    return {
      ...form,
      doc_number: data.doc_number || "",
      total_price: baseTotal,
      deposit,
      balance,
      equipment_total: totals.equipment || 0,
      labor_total: totals.labor || 0,
      subtotal: totals.subtotal || 0,
      tax: totals.tax || 0,
      in_kind: totals.discount || 0,
      inkind_value: totals.discount || 0,
      categories: categories.map((c) => ({
        name: c.name,
        subtotal: c.subtotal,
        scope: c.scope || "",
      })),
      y2_total: totalsByYear[1] || 0,
      y3_total: totalsByYear[2] || 0,
      y2_deposit: (totalsByYear[1] || 0) * depositPct,
      y3_deposit: (totalsByYear[2] || 0) * depositPct,
    };
  }

  async function generate() {
    setBusy("generate");
    setError(null);
    setNotice(null);
    try {
      const result = await generateContract(buildPayload());
      setGenerated(result);
      downloadBlob(result.blob, result.filename);
      setNotice(`Generated ${result.filename}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!recipient.trim()) {
      setError("Enter an email address to send it to.");
      return;
    }
    setBusy("email");
    setError(null);
    setNotice(null);
    try {
      await emailContract({ formData: buildPayload(), recipient: recipient.trim() });
      setNotice(`Sent to ${recipient.trim()}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 14 }}>
        ← All quotes
      </button>

      {notice && (
        <div className="banner banner-info">
          {notice}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}
      {error && (
        <div className="banner banner-error">
          {error}
          <div className="banner-spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <div className="event-head">
        <div>
          <div className="eyebrow mono">{data.doc_number || "No doc number"}</div>
          <h1>{form.event_name || "Untitled"}</h1>
          <div className="event-head-meta">
            {form.customer && <span>Client <b>{form.customer}</b></span>}
            {form.venue_info && <span>Venue <b>{form.venue_info}</b></span>}
            <span className="mono">{money(baseTotal)}</span>
          </div>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab${tab === t.id ? " tab-active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "event" && (
        <div className="card card-pad">
          <h2>Event</h2>
          <div className="contract-grid">
            <Field label="Event name" value={form.event_name} onChange={(v) => patch({ event_name: v })} wide />
            <Field label="Client" value={form.customer} onChange={(v) => patch({ customer: v })} />
            <Field label="Venue" value={form.venue_info} onChange={(v) => patch({ venue_info: v })} />
            <Field label="Location" value={form.event_location} onChange={(v) => patch({ event_location: v })} wide />
            <Field label="Load in" value={form.load_in} onChange={(v) => patch({ load_in: v })} />
            <Field label="Show start" value={form.show_start} onChange={(v) => patch({ show_start: v })} />
            <Field label="Show end" value={form.show_end} onChange={(v) => patch({ show_end: v })} />
            <Field label="Load out" value={form.load_out} onChange={(v) => patch({ load_out: v })} />
            <Field label="Production manager" value={form.production_manager} onChange={(v) => patch({ production_manager: v })} />
            <Field label="Salesperson" value={form.salesperson} onChange={(v) => patch({ salesperson: v })} />
          </div>

          <h2 style={{ marginTop: 22 }}>Client contacts</h2>
          <div className="contract-grid">
            <Field label="Contact 1 name" value={form.contact1_name} onChange={(v) => patch({ contact1_name: v })} />
            <Field label="Phone" value={form.contact1_phone} onChange={(v) => patch({ contact1_phone: v })} />
            <Field label="Email" value={form.contact1_email} onChange={(v) => patch({ contact1_email: v })} />
            <Field label="Contact 2 name" value={form.contact2_name} onChange={(v) => patch({ contact2_name: v })} />
            <Field label="Phone" value={form.contact2_phone} onChange={(v) => patch({ contact2_phone: v })} />
            <Field label="Email" value={form.contact2_email} onChange={(v) => patch({ contact2_email: v })} />
          </div>
        </div>
      )}

      {tab === "categories" && (
        <div className="card card-pad">
          <h2>Scope by category</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
            Pulled from the quote's line items. Each line of scope becomes a bullet in the
            contract.
          </p>

          {!categories.length ? (
            <div className="empty"><p>This quote has no categories.</p></div>
          ) : (
            categories.map((c, i) => (
              <div className="cat-block" key={c.name}>
                <div className="cat-head">
                  <span className="cat-name">{c.name}</span>
                  <span className="mono muted">{money(c.subtotal)}</span>
                </div>
                <textarea
                  className="textarea"
                  placeholder="One item per line"
                  value={c.scope}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((x, idx) => (idx === i ? { ...x, scope: e.target.value } : x))
                    )
                  }
                />
              </div>
            ))
          )}
        </div>
      )}

      {tab === "financials" && (
        <div className="card card-pad">
          <h2>Terms</h2>
          <div className="contract-grid">
            <div className="field">
              <label>Contract years</label>
              <select
                className="select"
                value={form.contract_years}
                onChange={(e) => patch({ contract_years: Number(e.target.value) })}
              >
                {[1, 2, 3].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>

            {years > 1 && (
              <div className="field">
                <label>Yearly increase (%)</label>
                <MoneyInput
                  value={form.year_increase_pct}
                  step="0.5"
                  className="input-block"
                  ariaLabel="Yearly increase"
                  onCommit={(v) => patch({ year_increase_pct: v })}
                />
              </div>
            )}

            <div className="field">
              <label>Deposit (%)</label>
              <MoneyInput
                value={form.deposit_pct}
                step="5"
                className="input-block"
                ariaLabel="Deposit percent"
                onCommit={(v) => patch({ deposit_pct: v })}
              />
            </div>

            <Field label="Deposit due" value={form.deposit_due} onChange={(v) => patch({ deposit_due: v })} />
            <Field label="Balance due" value={form.balance_due} onChange={(v) => patch({ balance_due: v })} />
            <Field label="Y1 change order due" value={form.y1_change_due} onChange={(v) => patch({ y1_change_due: v })} />
          </div>

          <div className="expense-summary" style={{ marginTop: 18 }}>
            <Figure label="Total" value={money(baseTotal)} />
            <Figure label="Deposit" value={money(deposit)} sub={`${form.deposit_pct || 0}%`} />
            <Figure label="Balance" value={money(balance)} />
            {totals.discount > 0 && <Figure label="In kind" value={money(totals.discount)} />}
          </div>

          {years > 1 && (
            <table className="event-table" style={{ marginTop: 14 }}>
              <thead>
                <tr>
                  <th>Year</th>
                  <th className="num" style={{ width: 140 }}>Total</th>
                  <th className="num" style={{ width: 140 }}>Deposit</th>
                </tr>
              </thead>
              <tbody>
                {totalsByYear.map((t, i) => (
                  <tr key={i}>
                    <td>Year {i + 1}</td>
                    <td className="num mono">{money(t)}</td>
                    <td className="num mono">{money(t * depositPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2 style={{ marginTop: 22 }}>Extra lines</h2>
          <div className="stack">
            <CustomLine
              label="Power"
              value={form.power_custom}
              highlight={form.power_highlight}
              onValue={(v) => patch({ power_custom: v })}
              onHighlight={(v) => patch({ power_highlight: v })}
            />
            <CustomLine
              label="Misc"
              value={form.misc_custom}
              highlight={form.misc_highlight}
              onValue={(v) => patch({ misc_custom: v })}
              onHighlight={(v) => patch({ misc_highlight: v })}
            />
            <CustomLine
              label="In kind description"
              value={form.inkind_desc}
              highlight={form.inkind_highlight}
              onValue={(v) => patch({ inkind_desc: v })}
              onHighlight={(v) => patch({ inkind_highlight: v })}
            />
          </div>
        </div>
      )}

      {tab === "generate" && (
        <div className="card card-pad">
          <h2>Generate</h2>
          <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 16 }}>
            Builds the Word document from everything above.
            {generated && ` Last built ${generated.filename}.`}
          </p>

          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="c-recipient">Send to</label>
            <input
              id="c-recipient"
              className="input"
              type="email"
              placeholder="client@example.com"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn" onClick={send} disabled={busy === "email" || !recipient.trim()}>
              {busy === "email" ? "Sending…" : "Email it"}
            </button>
          </div>
        </div>
      )}

      <SubmitBar
        label="Generate contract"
        busyLabel="Building…"
        busy={busy === "generate"}
        onClick={generate}
        hint="Downloads a Word document"
      />
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Field({ label, value, onChange, wide }) {
  return (
    <div className={`field${wide ? " contract-wide" : ""}`}>
      <label>{label}</label>
      <TextInput value={value || ""} onCommit={onChange} className="input-block" ariaLabel={label} />
    </div>
  );
}

function CustomLine({ label, value, highlight, onValue, onHighlight }) {
  return (
    <div className="custom-line">
      <div className="field" style={{ flex: 1 }}>
        <label>{label}</label>
        <TextInput value={value || ""} onCommit={onValue} className="input-block" ariaLabel={label} />
      </div>
      <label className="muted custom-line-check">
        <input type="checkbox" checked={!!highlight} onChange={(e) => onHighlight(e.target.checked)} />
        Highlight
      </label>
    </div>
  );
}

function Figure({ label, value, sub }) {
  return (
    <div className="figure">
      <div className="figure-label">{label}</div>
      <div className="figure-value mono">{value}</div>
      {sub && <div className="figure-sub mono">{sub}</div>}
    </div>
  );
}

function initialForm(data) {
  const h = data.header || {};
  return {
    event_name: h.document_name || "",
    customer: data.customer || "",
    venue_info: data.venue_info || "",
    event_location: data.venue_info || "",
    load_in: h.load_in || "",
    show_start: h.show_start || "",
    show_end: h.show_end || "",
    load_out: h.load_out || "",
    production_manager: h.production_manager || "",
    salesperson: h.salesperson || "",
    salesperson_name: h.salesperson || "",
    salesperson_phone: "",
    salesperson_email: "",
    contact1_name: data.contact1_name || "",
    contact1_phone: data.contact1_phone || "",
    contact1_email: data.contact1_email || "",
    contact2_name: "",
    contact2_phone: "",
    contact2_email: "",
    deposit_pct: 50,
    deposit_due: "",
    balance_due: "",
    y1_change_due: "",
    contract_years: 1,
    year_increase_pct: 3,
    power_custom: "",
    misc_custom: "",
    inkind_desc: "",
    power_highlight: false,
    misc_highlight: false,
    inkind_highlight: false,
    event_year: String(h.show_start || "").slice(0, 4),
  };
}
