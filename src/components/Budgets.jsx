import { useState, useEffect, useMemo } from "react";
import { listEvents } from "../lib/firebase";
import { getSettings } from "../lib/settings";
import { buildDashboard, PERIODS, dateRange } from "../lib/dashboard";
import { money, percent } from "../lib/expense";

export default function Budgets({ onBack, onOpenEvent }) {
  const [events, setEvents] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [period, setPeriod] = useState("month");
  const [selected, setSelected] = useState(null); // { groupKey, eventId }

  useEffect(() => {
    Promise.all([listEvents(), getSettings()])
      .then(([e, s]) => {
        setEvents(e);
        setSettings(s);
      })
      .catch((e) => setError(e.message));
  }, []);

  const data = useMemo(
    () => (events && settings ? buildDashboard({ events, settings, period }) : null),
    [events, settings, period]
  );

  // Open on the most recent period, since that's the one being worked.
  useEffect(() => {
    if (data?.groups.length && !selected) {
      setSelected({ groupKey: data.groups[0].key, eventId: null });
    }
  }, [data, selected]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!data) return <div className="loading">Reading budgets…</div>;

  const group = data.groups.find((g) => g.key === selected?.groupKey) || data.groups[0];
  const event = group?.events.find((e) => e.id === selected?.eventId) || null;

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 14 }}>
        ← All events
      </button>

      <div className="list-head">
        <div>
          <div className="eyebrow">Live</div>
          <h1>Budgets</h1>
        </div>
        <div className="list-head-spacer" />
        <div className="period-switch">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              className={`period-btn${period === p.id ? " period-btn-active" : ""}`}
              onClick={() => {
                setPeriod(p.id);
                setSelected(null);
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!data.groups.length ? (
        <div className="empty">
          <p>
            No budgets being tracked yet. A show appears here once its labor request goes out.
          </p>
        </div>
      ) : (
        <div className="dash">
          {/* ── Periods and their shows ─────────────────────────────── */}
          <aside className="dash-side">
            {data.groups.map((g) => {
              const open = g.key === group?.key;
              return (
                <div className="dash-group" key={g.key}>
                  <button
                    className={`dash-period${open ? " dash-period-open" : ""}`}
                    onClick={() => setSelected({ groupKey: g.key, eventId: null })}
                  >
                    <span className="dash-period-label">{g.label}</span>
                    <span className={`pill ${!event && open ? "pill-onsite" : "pill-ready"}`}>
                      Total
                    </span>
                  </button>

                  {open && (
                    <div className="dash-events">
                      {g.events.map((e) => (
                        <button
                          key={e.id}
                          className={`dash-event${e.id === selected?.eventId ? " dash-event-active" : ""}`}
                          onClick={() => setSelected({ groupKey: g.key, eventId: e.id })}
                        >
                          <span className="dash-event-name">{e.name}</span>
                          <span
                            className={`mono dash-event-pct${
                              e.totals.profitPct < 0 ? " neg" : ""
                            }`}
                          >
                            {percent(e.totals.profitPct)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          {/* ── Detail ──────────────────────────────────────────────── */}
          <div className="dash-main">
            {event ? (
              <EventDetail row={event} onOpen={() => onOpenEvent?.(event.id)} />
            ) : (
              <PeriodView group={group} onPick={(id) => setSelected({ groupKey: group.key, eventId: id })} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── One period ──────────────────────────────────────────────────────── */

function PeriodView({ group, onPick }) {
  const r = group.rollup;
  const maxRevenue = Math.max(...group.events.map((e) => e.totals.revenue), 1);
  const profits = group.events.map((e) => e.totals.profitDollars);
  const maxProfit = Math.max(...profits.map(Math.abs), 1);

  return (
    <div>
      <div className="dash-head">
        <h2>{group.label}</h2>
        <span className="muted">
          {r.count} {r.count === 1 ? "show" : "shows"} · {r.onActual} on actuals
        </span>
      </div>

      <div className="expense-summary">
        <Figure label="Revenue" value={money(r.revenue)} sub={`${money(r.contractTotal)} contracted`} tone="revenue" />
        <Figure label="Hard cost" value={percent(r.hardCostPct)} sub={money(r.hardCost)} tone="cost" />
        <Figure
          label="Profit"
          value={percent(r.profitPct, 2)}
          sub={money(r.profitDollars)}
          tone={r.profitPct < 0 ? "bad" : "good"}
        />
        <Figure label="Commission" value={money(r.commission)} sub={percent(r.commissionPct, 2)} />
      </div>

      <div className="dash-figures">
        <Figure label="Equipment" value={money(r.equipmentTotal)} small />
        <Figure label="Rental services" value={money(r.rentalServicesTotal)} small />
        <Figure label="Labor estimate" value={money(r.laborEstimateTotal)} small />
        <Figure label="Labor actual" value={money(r.laborActualTotal)} small />
        <Figure label="Trucking" value={money(r.truckingTotal)} small />
      </div>

      <div className="goal-bars">
        <GoalBar label="Equipment" {...r.vsGoal.equipment} />
        <GoalBar label="Labor" {...r.vsGoal.labor} />
        <GoalBar label="Trucking" {...r.vsGoal.trucking} />
      </div>

      <div className="dash-charts">
        <Chart title="Revenue by show">
          {group.events.map((e) => (
            <Bar
              key={e.id}
              label={e.name}
              value={e.totals.revenue}
              max={maxRevenue}
              display={money(e.totals.revenue)}
              onClick={() => onPick(e.id)}
            />
          ))}
        </Chart>

        <Chart title="Profit by show">
          {group.events.map((e) => (
            <Bar
              key={e.id}
              label={e.name}
              value={Math.abs(e.totals.profitDollars)}
              max={maxProfit}
              negative={e.totals.profitDollars < 0}
              display={money(e.totals.profitDollars)}
              onClick={() => onPick(e.id)}
            />
          ))}
        </Chart>
      </div>

      <div className="card" style={{ overflow: "auto", marginTop: 16 }}>
        <table className="event-table dash-table">
          <thead>
            <tr>
              <th>Show</th>
              <th style={{ width: 118 }}>PM</th>
              <th style={{ width: 100 }}>Dates</th>
              <th className="num" style={{ width: 104 }}>Contract</th>
              <th className="num" style={{ width: 104 }}>Revenue</th>
              <th className="num" style={{ width: 96 }}>Equipment</th>
              <th className="num" style={{ width: 92 }}>Rental svc</th>
              <th className="num" style={{ width: 96 }}>Labor</th>
              <th className="num" style={{ width: 84 }}>Trucking</th>
              <th className="num" style={{ width: 88 }}>Comm $</th>
              <th className="num" style={{ width: 96 }}>Profit</th>
            </tr>
          </thead>
          <tbody>
            {group.events.map((e) => {
              const t = e.totals;
              return (
                <tr key={e.id} className="event-row" onClick={() => onPick(e.id)}>
                  <td>
                    <div className="event-name">{e.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {t.usingActual ? "Actuals" : "Estimate"}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>{e.pmName}</td>
                  <td className="mono" style={{ fontSize: 11 }}>{dateRange(e.start, e.end)}</td>
                  <td className="num mono">{money(t.contractTotal)}</td>
                  <td className="num mono">{money(t.revenue)}</td>
                  <td className="num mono">{money(t.equipmentTotal)}</td>
                  <td className="num mono">{money(t.rentalServicesTotal)}</td>
                  <td className="num mono">{money(t.laborTotal)}</td>
                  <td className="num mono">{money(t.truckingTotal)}</td>
                  <td className="num mono">{money(t.commission)}</td>
                  <td className="num">
                    <span className={`pct-pill${t.profitPct < 0 ? " neg" : ""}`}>
                      {percent(t.profitPct)}
                    </span>
                  </td>
                </tr>
              );
            })}
            <tr className="dash-total-row">
              <td colSpan={3}>
                <b>{group.label} total</b>
              </td>
              <td className="num mono"><b>{money(r.contractTotal)}</b></td>
              <td className="num mono"><b>{money(r.revenue)}</b></td>
              <td className="num mono"><b>{money(r.equipmentTotal)}</b></td>
              <td className="num mono"><b>{money(r.rentalServicesTotal)}</b></td>
              <td className="num mono"><b>{money(r.laborTotal)}</b></td>
              <td className="num mono"><b>{money(r.truckingTotal)}</b></td>
              <td className="num mono"><b>{money(r.commission)}</b></td>
              <td className="num">
                <span className={`pct-pill${r.profitPct < 0 ? " neg" : ""}`}>
                  <b>{percent(r.profitPct)}</b>
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── One show ────────────────────────────────────────────────────────── */

function EventDetail({ row, onOpen }) {
  const t = row.totals;

  return (
    <div>
      <div className="dash-head">
        <div>
          <h2>{row.name}</h2>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {row.pmName} · {dateRange(row.start, row.end)}
            {row.venue && <> · {row.venue}</>}
            {row.docNumber && <> · {row.docNumber}</>}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className={`pill ${t.usingActual ? "pill-closed" : "pill-planning"}`}>
          {t.usingActual ? "Actuals" : "Estimate"}
        </span>
        <button className="btn btn-sm" onClick={onOpen}>
          Open event
        </button>
      </div>

      <div className="expense-summary">
        <Figure label="Revenue" value={money(t.revenue)} sub={`${money(t.contractTotal)} contracted`} tone="revenue" />
        <Figure label="Hard cost" value={percent(t.hardCostPct)} sub={money(t.hardCost)} tone="cost" />
        <Figure
          label="Profit"
          value={percent(t.profitPct, 2)}
          sub={money(t.profitDollars)}
          tone={t.profitPct < 0 ? "bad" : "good"}
        />
        <Figure
          label="Equip. purchase"
          value={money(t.equipPurchaseActual)}
          sub={
            t.equipPurchaseActual < t.equipPurchaseGoal
              ? `goal ${money(t.equipPurchaseGoal)}`
              : "at goal"
          }
          tone={t.equipPurchaseActual < t.equipPurchaseGoal ? "warn" : undefined}
        />
      </div>

      <div className="goal-bars">
        <GoalBar label="Equipment" {...t.vsGoal.equipment} />
        <GoalBar label="Labor" {...t.vsGoal.labor} />
        <GoalBar label="Trucking" {...t.vsGoal.trucking} />
      </div>

      <div className="dash-figures">
        <Figure label="Equipment" value={money(t.equipmentTotal)} small />
        <Figure label="Rental services" value={money(t.rentalServicesTotal)} small />
        <Figure label="Labor estimate" value={money(t.laborEstimateTotal)} small />
        <Figure label="Labor actual" value={money(t.laborActualTotal)} small />
        <Figure label="Trucking" value={money(t.truckingTotal)} small />
        <Figure label="Commission" value={money(t.commission)} small />
      </div>

      <div className="card card-pad" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 13 }}>Labor</h2>
        <table className="event-table" style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th>Category</th>
              <th className="num" style={{ width: 90 }}>Est. hrs</th>
              <th className="num" style={{ width: 110 }}>Estimate</th>
              <th className="num" style={{ width: 90 }}>Act. hrs</th>
              <th className="num" style={{ width: 110 }}>Actual</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(t.actualByCategory || {}).map(([id, a]) => {
              const e = row.sheet.laborEstimate?.byCategory?.[id];
              const label = id.charAt(0).toUpperCase() + id.slice(1);
              return (
                <tr key={id}>
                  <td>{label}</td>
                  <td className="num mono muted">{e ? fmtHours(e.billable) : "—"}</td>
                  <td className="num mono muted">{e ? money(e.cost) : "—"}</td>
                  <td className="num mono">{a.billable ? fmtHours(a.billable) : "—"}</td>
                  <td className="num mono">{a.cost ? money(a.cost) : "—"}</td>
                </tr>
              );
            })}
            {t.invoiceTotal > 0 && (
              <tr>
                <td className="muted">Non-Harvest invoices</td>
                <td className="num" />
                <td className="num" />
                <td className="num" />
                <td className="num mono">{money(t.invoiceTotal)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────── */

function Figure({ label, value, sub, tone, small }) {
  return (
    <div className={`figure${tone ? ` figure-${tone}` : ""}${small ? " figure-small" : ""}`}>
      <div className="figure-label">{label}</div>
      <div className="figure-value mono">{value}</div>
      {sub && <div className="figure-sub mono">{sub}</div>}
    </div>
  );
}

function GoalBar({ label, actual, goal, delta }) {
  const over = delta > 0.001;
  const width = goal ? Math.max(Math.min((actual / goal) * 100, 100), 0) : 0;

  return (
    <div className="goal">
      <div className="goal-label">
        <span>{label}</span>
        <span className={`goal-delta mono${over ? " goal-over" : ""}`}>
          {percent(actual)} <span className="muted">/ {percent(goal, 0)}</span>
        </span>
      </div>
      <div className="goal-track">
        <div className={`goal-fill${over ? " goal-fill-over" : ""}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Chart({ title, children }) {
  return (
    <div className="chart">
      <div className="chart-title">{title}</div>
      <div className="chart-bars">{children}</div>
    </div>
  );
}

/**
 * A horizontal bar rather than the usual vertical column — show names are long
 * enough that vertical bars need rotated labels nobody can read.
 */
function Bar({ label, value, max, display, negative, onClick }) {
  const width = max ? Math.max((value / max) * 100, 1) : 0;
  return (
    <button className="chart-row" onClick={onClick} title={label}>
      <span className="chart-label">{label}</span>
      <span className="chart-track">
        <span className={`chart-fill${negative ? " chart-fill-neg" : ""}`} style={{ width: `${width}%` }} />
      </span>
      <span className={`chart-value mono${negative ? " neg" : ""}`}>{display}</span>
    </button>
  );
}

function fmtHours(n) {
  if (!n) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
