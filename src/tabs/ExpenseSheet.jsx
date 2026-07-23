import { useState, useEffect, useMemo } from "react";
import { getSettings } from "../lib/settings";
import { derive, calculate, money, percent } from "../lib/expense";
import { LABOR_CATEGORIES } from "../lib/overtime";
import MoneyInput, { TextInput } from "../components/MoneyInput";

export default function ExpenseSheet({ event, canEdit, onChange }) {
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState(null);
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch((e) => setError(e.message));
  }, []);

  const sheet = useMemo(
    () => (settings ? derive({ event, settings }) : null),
    [event, settings]
  );

  const totals = useMemo(
    () => (sheet && settings ? calculate({ sheet, settings }) : null),
    [sheet, settings]
  );

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!sheet || !totals) return <div className="loading">Loading the sheet…</div>;

  /** Saves only what the PM owns; derived lines are recomputed on read. */
  function save(patch) {
    const { laborEstimate, dismissedPoLines, ...stored } = { ...sheet, ...patch };
    onChange({
      ...stored,
      contracts: stored.contracts.filter((c) => c.source !== "flex"),
      equipment: stored.equipment.filter((l) => l.source !== "po"),
      rentalServices: stored.rentalServices.filter((l) => l.source !== "po"),
    });
  }

  function addLine(block) {
    const line =
      block === "contracts"
        ? { id: crypto.randomUUID(), name: "", amount: 0, source: "manual" }
        : { id: crypto.randomUUID(), vendor: "", cost: 0, source: "manual" };
    save({ [block]: [...sheet[block], line] });
  }

  function updateLine(block, id, patch) {
    save({ [block]: sheet[block].map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  }

  function removeLine(block, id) {
    save({ [block]: sheet[block].filter((l) => l.id !== id) });
  }

  /** A PO line's cost can be corrected without touching the request itself. */
  function adjustPo(poId, patch) {
    save({
      poAdjustments: {
        ...sheet.poAdjustments,
        [poId]: { ...sheet.poAdjustments?.[poId], ...patch },
      },
    });
  }

  function updateLabor(patch) {
    save({ labor: { ...sheet.labor, ...patch } });
  }

  function updateActual(categoryId, field, value) {
    updateLabor({
      actualHours: {
        ...sheet.labor.actualHours,
        [categoryId]: { ...sheet.labor.actualHours?.[categoryId], [field]: value },
      },
    });
  }

  function updateInvoice(id, patch) {
    updateLabor({
      invoices: (sheet.labor.invoices || []).map((x) =>
        x.id === id ? { ...x, ...patch } : x
      ),
    });
  }

  function addInvoice() {
    updateLabor({
      invoices: [
        ...(sheet.labor.invoices || []),
        { id: crypto.randomUUID(), label: "", amount: 0 },
      ],
    });
  }

  const est = sheet.laborEstimate;
  const venues = settings.expense?.commissionVenues || [];
  const dismissed = sheet.dismissedPoLines || [];

  /** One vendor and cost, whether it came from a PO or was typed in. */
  function CostRow({ block, line }) {
    const isPo = line.source === "po";
    return (
      <tr className={isPo ? "row-derived" : ""}>
        <td>
          {isPo ? (
            <span className="line-name">
              <span className="line-text">{line.vendor || "—"}</span>
              <span className="src-tag" title={`PO ${line.code}`}>{line.code || "PO"}</span>
              {line.adjusted && (
                <span className="src-tag adj-tag" title={`Ordered at ${money(line.originalCost)}`}>
                  adj
                </span>
              )}
            </span>
          ) : (
            <TextInput
              value={line.vendor}
              placeholder="Vendor"
              ariaLabel="Vendor"
              disabled={!canEdit}
              onCommit={(v) => updateLine(block, line.id, { vendor: v })}
            />
          )}
        </td>
        <td className="col-money">
          <MoneyInput
            value={line.cost}
            ariaLabel="Cost"
            disabled={!canEdit}
            onCommit={(v) =>
              isPo
                ? adjustPo(line.poId, { cost: v })
                : updateLine(block, line.id, { cost: v })
            }
          />
        </td>
        <td className="col-x">
          {canEdit && (
            <button
              className="btn btn-ghost btn-sm btn-danger"
              title={isPo ? "Leave this PO off the sheet" : "Remove"}
              onClick={() =>
                isPo ? adjustPo(line.poId, { dismissed: true }) : removeLine(block, line.id)
              }
            >
              ×
            </button>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="expense">
      {/* ── Headline ──────────────────────────────────────────────────── */}
      <div className="expense-summary">
        <Figure label="Revenue" value={money(totals.revenue)} tone="revenue" />
        <Figure
          label="Hard cost"
          value={percent(totals.hardCostPct)}
          sub={money(totals.hardCost)}
          tone="cost"
        />
        <Figure
          label="Profit"
          value={percent(totals.profitPct, 2)}
          sub={money(totals.profitDollars)}
          tone={totals.profitPct < 0 ? "bad" : "good"}
        />
        <Figure
          label="Equip. purchase"
          value={money(totals.equipPurchaseActual)}
          sub={
            totals.equipPurchaseActual < totals.equipPurchaseGoal
              ? `goal ${money(totals.equipPurchaseGoal)}`
              : "at goal"
          }
          tone={totals.equipPurchaseActual < totals.equipPurchaseGoal ? "warn" : undefined}
        />
      </div>

      <div className="goal-bars">
        <GoalBar label="Equipment" {...totals.vsGoal.equipment} />
        <GoalBar label="Labor" {...totals.vsGoal.labor} />
        <GoalBar label="Trucking" {...totals.vsGoal.trucking} />
      </div>

      <div className="expense-grid">
        {/* ── Contracts ───────────────────────────────────────────────── */}
        <section className="exp-block exp-revenue-block">
          <header className="exp-head">
            <h2>Contracts &amp; change orders</h2>
            <span className="exp-total mono">{money(totals.contractTotal)}</span>
            {canEdit && (
              <button className="btn btn-sm" onClick={() => addLine("contracts")}>
                Add
              </button>
            )}
          </header>

          <table className="exp-table">
            <tbody>
              {sheet.contracts.map((c) => (
                <tr key={c.id} className={c.source === "flex" ? "row-derived" : ""}>
                  <td>
                    {c.source === "flex" ? (
                      <span className="line-name">
                        <span className="line-text">{c.name}</span>
                        <span className="src-tag">Flex</span>
                        {c.overridden && (
                          <span
                            className="src-tag adj-tag"
                            title={`Flex has ${money(c.flexAmount)}`}
                          >
                            adj
                          </span>
                        )}
                      </span>
                    ) : (
                      <TextInput
                        value={c.name}
                        placeholder="Change order"
                        ariaLabel="Change order name"
                        disabled={!canEdit}
                        onCommit={(v) => updateLine("contracts", c.id, { name: v })}
                      />
                    )}
                  </td>
                  <td className="col-money">
                    <MoneyInput
                      value={c.amount}
                      ariaLabel="Amount"
                      disabled={!canEdit}
                      onCommit={(v) =>
                        c.source === "flex"
                          ? save({ contractOverride: v })
                          : updateLine("contracts", c.id, { amount: v })
                      }
                    />
                  </td>
                  <td className="col-x">
                    {canEdit && c.source === "flex" && c.overridden && (
                      <button
                        className="btn btn-ghost btn-sm"
                        title={`Back to Flex (${money(c.flexAmount)})`}
                        onClick={() => save({ contractOverride: null })}
                      >
                        ↺
                      </button>
                    )}
                    {canEdit && c.source !== "flex" && (
                      <button
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() => removeLine("contracts", c.id)}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="exp-foot">
            <span className="muted">Less rental services</span>
            <span className="mono">−{money(totals.rentalServicesTotal)}</span>
          </div>
          <div className="exp-foot exp-foot-strong">
            <span>Revenue</span>
            <span className="mono">{money(totals.revenue)}</span>
          </div>
        </section>

        {/* ── Equipment ───────────────────────────────────────────────── */}
        <section className="exp-block exp-equipment-block">
          <header className="exp-head">
            <h2>Equipment, purchases, maintenance, rentals</h2>
            <span className="exp-total mono">{money(totals.equipmentTotal)}</span>
            {canEdit && (
              <button className="btn btn-sm" onClick={() => addLine("equipment")}>
                Add
              </button>
            )}
          </header>

          {!sheet.equipment.length ? (
            <p className="exp-empty">Nothing yet. Sent POs land here automatically.</p>
          ) : (
            <table className="exp-table">
              <tbody>
                {sheet.equipment.map((l) => (
                  <CostRow key={l.id} block="equipment" line={l} />
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Rental services ─────────────────────────────────────────── */}
        <section className="exp-block exp-services-block">
          <header className="exp-head">
            <h2>Rental services</h2>
            <span className="exp-total mono">{money(totals.rentalServicesTotal)}</span>
            {canEdit && (
              <button className="btn btn-sm" onClick={() => addLine("rentalServices")}>
                Add
              </button>
            )}
          </header>
          <p className="exp-note">Comes off revenue before anything else.</p>

          {!sheet.rentalServices.length ? (
            <p className="exp-empty">Nothing yet.</p>
          ) : (
            <table className="exp-table">
              <tbody>
                {sheet.rentalServices.map((l) => (
                  <CostRow key={l.id} block="rentalServices" line={l} />
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Trucking ────────────────────────────────────────────────── */}
        <section className="exp-block exp-trucking-block">
          <header className="exp-head">
            <h2>Trucking</h2>
            <span className="exp-total mono">{money(totals.truckingTotal)}</span>
          </header>

          <div className="truck-grid">
            <div className="field">
              <label htmlFor="tr-trucks">Trucks</label>
              <MoneyInput
                value={sheet.trucking.trucks}
                step="1"
                placeholder="0"
                ariaLabel="Number of trucks"
                className="input-block"
                disabled={!canEdit}
                onCommit={(v) => save({ trucking: { ...sheet.trucking, trucks: v } })}
              />
            </div>
            <div className="field">
              <label htmlFor="tr-days">Days</label>
              <MoneyInput
                value={sheet.trucking.days}
                step="1"
                placeholder="0"
                ariaLabel="Number of days"
                className="input-block"
                disabled={!canEdit}
                onCommit={(v) => save({ trucking: { ...sheet.trucking, days: v } })}
              />
            </div>
            <div className="field">
              <label htmlFor="tr-miles">Mileage</label>
              <MoneyInput
                value={sheet.trucking.miles}
                step="1"
                placeholder="0"
                ariaLabel="Total mileage"
                className="input-block"
                disabled={!canEdit}
                onCommit={(v) => save({ trucking: { ...sheet.trucking, miles: v } })}
              />
            </div>
          </div>

          <div className="exp-foot">
            <span className="muted">Truck days</span>
            <span className="mono">{money(totals.truckDays)}</span>
          </div>
          <div className="exp-foot">
            <span className="muted">Fuel &amp; mileage</span>
            <span className="mono">{money(totals.mileage)}</span>
          </div>
        </section>

        {/* ── Labor ───────────────────────────────────────────────────── */}
        <section className="exp-block exp-labor-block exp-wide">
          <header className="exp-head">
            <h2>Labor</h2>
            <span className="exp-total mono">
              {money(totals.laborTotal)}
              <span className="exp-total-tag">
                {totals.usingActual ? "actual" : "estimate"}
              </span>
            </span>
          </header>

          {!est && !totals.usingActual && (
            <p className="exp-note">
              No labor request sent yet. Send one from the Labor tab and the estimate lands here.
            </p>
          )}

          <div className="table-scroll">
            <table className="exp-table labor-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="col-money">Rate</th>
                  <th className="col-hours">Est. ST</th>
                  <th className="col-hours">Est. OT</th>
                  <th className="col-money">Estimate</th>
                  <th className="col-hours">Act. ST</th>
                  <th className="col-hours">Act. OT</th>
                  <th className="col-money">Actual</th>
                </tr>
              </thead>
              <tbody>
                {LABOR_CATEGORIES.map((c) => {
                  const e = est?.byCategory?.[c.id];
                  const a = totals.actualByCategory?.[c.id];
                  return (
                    <tr key={c.id}>
                      <td>{c.label}</td>
                      <td className="col-money mono muted num">{money(a?.rate)}</td>
                      <td className="col-hours mono num muted">{fmtHours(e?.straight)}</td>
                      <td className="col-hours mono num muted">{fmtHours(e?.overtime)}</td>
                      <td className="col-money mono num muted">{e ? money(e.cost) : "—"}</td>
                      <td className="col-hours">
                        <MoneyInput
                          value={sheet.labor.actualHours?.[c.id]?.straight}
                          step="0.25"
                          placeholder="0"
                          ariaLabel={`${c.label} actual straight time`}
                          disabled={!canEdit}
                          onCommit={(v) => updateActual(c.id, "straight", v)}
                        />
                      </td>
                      <td className="col-hours">
                        <MoneyInput
                          value={sheet.labor.actualHours?.[c.id]?.overtime}
                          step="0.25"
                          placeholder="0"
                          ariaLabel={`${c.label} actual overtime`}
                          disabled={!canEdit}
                          onCommit={(v) => updateActual(c.id, "overtime", v)}
                        />
                      </td>
                      <td className="col-money mono num">{a?.cost ? money(a.cost) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {est?.uncategorizedHours > 0 && (
            <p className="exp-note warn-note">
              {fmtHours(est.uncategorizedHours)} hours on the labor request have no category and
              aren't estimated.
            </p>
          )}

          <div className="subblock">
            <header className="subexp-head">
              <span className="eyebrow">Non-Harvest invoices</span>
              <span className="mono subexp-total">{money(totals.invoiceTotal)}</span>
              {canEdit && (
                <button className="btn btn-sm" onClick={addInvoice}>
                  Add invoice
                </button>
              )}
            </header>

            {!(sheet.labor.invoices || []).length ? (
              <p className="exp-empty">
                IATSE, BDBG, and anything else billed to us for this show.
              </p>
            ) : (
              <table className="exp-table">
                <tbody>
                  {sheet.labor.invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <TextInput
                          value={inv.label}
                          placeholder="IATSE GS"
                          ariaLabel="Invoice label"
                          disabled={!canEdit}
                          onCommit={(v) => updateInvoice(inv.id, { label: v })}
                        />
                      </td>
                      <td className="col-money">
                        <MoneyInput
                          value={inv.amount}
                          ariaLabel="Invoice amount"
                          disabled={!canEdit}
                          onCommit={(v) => updateInvoice(inv.id, { amount: v })}
                        />
                      </td>
                      <td className="col-x">
                        {canEdit && (
                          <button
                            className="btn btn-ghost btn-sm btn-danger"
                            onClick={() =>
                              updateLabor({
                                invoices: sheet.labor.invoices.filter((x) => x.id !== inv.id),
                              })
                            }
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ── Commission ──────────────────────────────────────────────── */}
        <section className="exp-block exp-commission-block exp-wide">
          <header className="exp-head">
            <h2>Commission</h2>
            <span className="exp-total mono">
              {money(totals.commission)}
              {totals.commissionVenue && (
                <span className="exp-total-tag">{percent(totals.commissionPct, 2)}</span>
              )}
            </span>
          </header>

          <div className="commission-row">
            <div className="field" style={{ maxWidth: 240 }}>
              <label htmlFor="venue">Venue</label>
              <select
                id="venue"
                className="select"
                value={sheet.venue}
                disabled={!canEdit}
                onChange={(e) => save({ venue: e.target.value })}
              >
                <option value="">No commission</option>
                {venues.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} — {percent(v.rate, 0)}
                  </option>
                ))}
              </select>
            </div>

            {totals.commissionVenue && (
              <div className="commission-detail">
                <div className="commission-figure">
                  <span className="muted">Commissionable</span>
                  <span className="mono">{money(totals.commissionable)}</span>
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {totals.commissionVenue.basis === "net"
                    ? "Revenue less subrentals and non-Harvest labor"
                    : "Revenue"}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {dismissed.length > 0 && (
        <div className="dismissed">
          <button className="btn btn-ghost btn-sm" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? "Hide" : "Show"} {dismissed.length} PO
            {dismissed.length === 1 ? "" : "s"} left off the sheet
          </button>

          {showDismissed && (
            <table className="exp-table" style={{ marginTop: 8 }}>
              <tbody>
                {dismissed.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span className="line-name muted">
                        <span className="line-text">{l.vendor || "—"}</span>
                        <span className="src-tag">{l.code || "PO"}</span>
                      </span>
                    </td>
                    <td className="col-money mono num muted">{money(l.originalCost)}</td>
                    <td className="col-x">
                      {canEdit && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => adjustPo(l.poId, { dismissed: false })}
                        >
                          Restore
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="field" style={{ marginTop: 16 }}>
        <label htmlFor="exp-notes">Notes</label>
        <textarea
          id="exp-notes"
          className="textarea"
          value={sheet.notes || ""}
          disabled={!canEdit}
          onChange={(e) => save({ notes: e.target.value })}
        />
      </div>
    </div>
  );
}

function Figure({ label, value, sub, tone }) {
  return (
    <div className={`figure${tone ? ` figure-${tone}` : ""}`}>
      <div className="figure-label">{label}</div>
      <div className="figure-value mono">{value}</div>
      {sub && <div className="figure-sub mono">{sub}</div>}
    </div>
  );
}

/**
 * Where a block sits against its goal. Over is the direction that costs money,
 * so that's the one that gets a colour.
 */
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

function fmtHours(n) {
  if (!n) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
