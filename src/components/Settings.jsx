import { useState, useEffect } from "react";
import { getSettings, saveSettings, DEFAULT_SETTINGS } from "../lib/settings";
import { listEvents } from "../lib/firebase";
import { buildPerDiemRows, downloadPerDiemWorkbook, perDiemSum } from "../lib/perdiem-export";
import { reportsInRange, summarizeTechs, downloadProductionReportPdf } from "../lib/prodreport-export";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function Settings({ onBack }) {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);

  const now = new Date();

  const [expYear, setExpYear] = useState(now.getFullYear());
  const [expMonth, setExpMonth] = useState(now.getMonth() + 1);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState(null);

  const [repStart, setRepStart] = useState(isoDaysAgo(90));
  const [repEnd, setRepEnd] = useState(isoToday());
  const [repExporting, setRepExporting] = useState(false);
  const [repPreview, setRepPreview] = useState(null);

  useEffect(() => {
    getSettings({ force: true })
      .then(setSettings)
      .catch((e) => setError(e.message));
  }, []);

  function updateGroup(group, key, text) {
    setSettings((prev) => ({
      ...prev,
      [group]: { ...prev[group], [key]: splitEmails(text) },
    }));
  }


  function updateVenue(index, patch) {
    setSettings((prev) => ({
      ...prev,
      expense: {
        ...prev.expense,
        commissionVenues: prev.expense.commissionVenues.map((v, i) =>
          i === index ? { ...v, ...patch } : v
        ),
      },
    }));
  }

  function addVenue() {
    setSettings((prev) => ({
      ...prev,
      expense: {
        ...prev.expense,
        commissionVenues: [
          ...prev.expense.commissionVenues,
          { name: "", rate: 0.1, basis: "gross" },
        ],
      },
    }));
  }

  function removeVenue(index) {
    setSettings((prev) => ({
      ...prev,
      expense: {
        ...prev.expense,
        commissionVenues: prev.expense.commissionVenues.filter((_, i) => i !== index),
      },
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await saveSettings({
        perDiemRate: Number(settings.perDiemRate) || DEFAULT_SETTINGS.perDiemRate,
        travel: settings.travel,
        prodReport: {
          ...settings.prodReport,
          reportThreshold:
            Number(settings.prodReport.reportThreshold) ||
            DEFAULT_SETTINGS.prodReport.reportThreshold,
        },
        po: settings.po,
        labor: settings.labor,
        expense: settings.expense,
        files: {
          ...settings.files,
          slackCopyMaxMb:
            Number(settings.files.slackCopyMaxMb) || DEFAULT_SETTINGS.files.slackCopyMaxMb,
        },
      });
      setNotice("Settings saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function exportPerDiems() {
    setExporting(true);
    setError(null);
    setPreview(null);
    try {
      const rate = Number(settings.perDiemRate) || DEFAULT_SETTINGS.perDiemRate;
      const events = await listEvents();
      const rows = buildPerDiemRows(events, expYear, expMonth, rate);

      if (!rows.length) {
        setPreview({ count: 0 });
        return;
      }
      downloadPerDiemWorkbook(rows, expYear, expMonth);
      setPreview({ count: rows.length, total: perDiemSum(rows) });
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting(false);
    }
  }

  async function exportReports() {
    setRepExporting(true);
    setError(null);
    setRepPreview(null);
    try {
      const events = await listEvents();
      const inRange = reportsInRange(events, repStart, repEnd);

      if (!inRange.length) {
        setRepPreview({ events: 0 });
        return;
      }
      const techs = summarizeTechs(inRange);
      downloadProductionReportPdf(inRange, repStart, repEnd);
      setRepPreview({ events: inRange.length, techs: techs.length });
    } catch (e) {
      setError(e.message);
    } finally {
      setRepExporting(false);
    }
  }

  if (error && !settings) return <div className="banner banner-error">{error}</div>;
  if (!settings) return <div className="loading">Loading settings…</div>;

  const years = [
    now.getFullYear() - 1,
    now.getFullYear(),
    now.getFullYear() + 1,
    now.getFullYear() + 2,
  ];

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 14 }}>
        ← All events
      </button>

      <div className="list-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Settings</h1>
        </div>
        <div className="list-head-spacer" />
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save settings"}
        </button>
      </div>

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

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Production report export</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          One page per event, then a summary per technician with their notes and average
          rating across the range.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ maxWidth: 170 }}>
            <label htmlFor="rep-start">From</label>
            <input
              id="rep-start"
              className="input mono"
              type="date"
              value={repStart}
              onChange={(e) => setRepStart(e.target.value)}
            />
          </div>
          <div className="field" style={{ maxWidth: 170 }}>
            <label htmlFor="rep-end">To</label>
            <input
              id="rep-end"
              className="input mono"
              type="date"
              value={repEnd}
              onChange={(e) => setRepEnd(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={exportReports} disabled={repExporting}>
            {repExporting ? "Building…" : "Export PDF"}
          </button>
        </div>

        {repPreview && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            {repPreview.events === 0 ? (
              <span className="muted">No submitted reports in that range.</span>
            ) : (
              <span>
                {repPreview.events} {repPreview.events === 1 ? "event" : "events"} ·{" "}
                {repPreview.techs} {repPreview.techs === 1 ? "technician" : "technicians"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Monthly per diem export</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          Every traveler departing in the chosen month, with per diem totals, as a spreadsheet
          for payroll.
        </p>

        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ maxWidth: 150 }}>
            <label htmlFor="exp-month">Month</label>
            <select
              id="exp-month"
              className="select"
              value={expMonth}
              onChange={(e) => setExpMonth(Number(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: 110 }}>
            <label htmlFor="exp-year">Year</label>
            <select
              id="exp-year"
              className="select"
              value={expYear}
              onChange={(e) => setExpYear(Number(e.target.value))}
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={exportPerDiems} disabled={exporting}>
            {exporting ? "Building…" : "Export spreadsheet"}
          </button>
        </div>

        {preview && (
          <div style={{ marginTop: 12, fontSize: 13 }}>
            {preview.count === 0 ? (
              <span className="muted">No per diem requests for that month.</span>
            ) : (
              <span>
                {preview.count} {preview.count === 1 ? "traveler" : "travelers"} · total{" "}
                <b className="mono">${preview.total.toFixed(2)}</b>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Per diem rate</h2>
        <div className="field" style={{ maxWidth: 160 }}>
          <label htmlFor="rate">Daily rate ($)</label>
          <input
            id="rate"
            className="input mono"
            type="number"
            step="0.01"
            value={settings.perDiemRate}
            onChange={(e) => setSettings((prev) => ({ ...prev, perDiemRate: e.target.value }))}
          />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Total is this rate times the number of travel days (nights plus one).
        </p>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Travel request recipients</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          One email per line. The requesting PM is always added automatically.
        </p>

        <div className="stack">
          <RecipientField
            label="Per diem requests go to"
            value={settings.travel.perDiemRecipients}
            onChange={(t) => updateGroup("travel", "perDiemRecipients", t)}
          />
          <RecipientField
            label="Flight requests go to"
            value={settings.travel.flightRecipients}
            onChange={(t) => updateGroup("travel", "flightRecipients", t)}
          />
          <RecipientField
            label="Hotel requests go to"
            value={settings.travel.hotelRecipients}
            onChange={(t) => updateGroup("travel", "hotelRecipients", t)}
          />
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Hard cost goals</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          What each block should cost as a share of revenue, entered as a percentage. The
          expense sheet measures every show against these.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            ["equipment", "Equipment / rentals"],
            ["labor", "Labor"],
            ["trucking", "Trucking"],
            ["equipmentPurchases", "Equip. purchases"],
            ["overhead", "Overhead"],
            ["profit", "Profit goal"],
          ].map(([key, label]) => (
            <div className="field" key={key} style={{ maxWidth: 150 }}>
              <label htmlFor={`goal-${key}`}>{label} (%)</label>
              <input
                id={`goal-${key}`}
                className="input mono"
                type="number"
                step="0.5"
                value={pctValue(settings.expense.hardCostGoals[key])}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    expense: {
                      ...prev.expense,
                      hardCostGoals: {
                        ...prev.expense.hardCostGoals,
                        [key]: pctToFraction(e.target.value),
                      },
                    },
                  }))
                }
              />
            </div>
          ))}
        </div>

        <div className="field" style={{ maxWidth: 200, marginTop: 14 }}>
          <label htmlFor="budget-threshold">Track budgets above ($)</label>
          <input
            id="budget-threshold"
            className="input mono"
            type="number"
            step="500"
            value={settings.expense.budgetThreshold ?? 10000}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                expense: { ...prev.expense, budgetThreshold: Number(e.target.value) },
              }))
            }
          />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Shows below this contract value don't appear on the budget dashboard.
        </p>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Trucking</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          Cost is trucks x days x day rate, plus mileage x fuel per mile, plus (mileage / mpg)
          x fuel price.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            ["dayRate", "Day rate ($)", "1"],
            ["fuelPerMile", "Fuel per mile ($)", "0.01"],
            ["mpg", "Miles per gallon", "0.5"],
            ["fuelPrice", "Fuel price ($/gal)", "0.05"],
          ].map(([key, label, step]) => (
            <div className="field" key={key} style={{ maxWidth: 160 }}>
              <label htmlFor={`truck-${key}`}>{label}</label>
              <input
                id={`truck-${key}`}
                className="input mono"
                type="number"
                step={step}
                value={settings.expense.trucking[key] ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    expense: {
                      ...prev.expense,
                      trucking: { ...prev.expense.trucking, [key]: Number(e.target.value) },
                    },
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Commission venues</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          Venues that take a commission. Net bills on revenue less subrentals and non-Harvest
          labor; gross bills on revenue.
        </p>

        {(settings.expense.commissionVenues || []).map((v, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
            <div className="field" style={{ maxWidth: 220 }}>
              <label>Venue</label>
              <input
                className="input"
                value={v.name}
                onChange={(e) => updateVenue(i, { name: e.target.value })}
              />
            </div>
            <div className="field" style={{ maxWidth: 110 }}>
              <label>Rate (%)</label>
              <input
                className="input mono"
                type="number"
                step="0.5"
                value={pctValue(v.rate)}
                onChange={(e) => updateVenue(i, { rate: pctToFraction(e.target.value) })}
              />
            </div>
            <div className="field" style={{ maxWidth: 130 }}>
              <label>Basis</label>
              <select
                className="select"
                value={v.basis}
                onChange={(e) => updateVenue(i, { basis: e.target.value })}
              >
                <option value="net">Net</option>
                <option value="gross">Gross</option>
              </select>
            </div>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => removeVenue(i)}
              style={{ marginBottom: 1 }}
            >
              Remove
            </button>
          </div>
        ))}

        <button className="btn btn-sm" onClick={addVenue}>
          Add venue
        </button>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Overtime rules</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          An overtime hour bills at 1.5x. Leave a field blank where the rule doesn't apply —
          contractors have no night rule, and only Harvest has a weekly threshold. Christmas,
          New Year's, July 4th, Labor Day, Memorial Day, and Thanksgiving are overtime for
          everyone.
        </p>

        <table className="event-table" style={{ marginBottom: 4 }}>
          <thead>
            <tr>
              <th>Category</th>
              <th style={{ width: 150 }}>Daily after (hrs)</th>
              <th style={{ width: 160 }}>Overtime until (hour)</th>
              <th style={{ width: 160 }}>Weekly after (hrs)</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["hands", "Hands"],
              ["riggers", "Riggers"],
              ["contractors", "Contractors"],
              ["harvest", "Harvest"],
            ].map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                {["dailyAfter", "nightBefore", "weeklyAfter"].map((field) => (
                  <td key={field}>
                    <input
                      className="cell-input mono"
                      type="number"
                      step="1"
                      placeholder="—"
                      value={settings.labor.otRules?.[key]?.[field] ?? ""}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          labor: {
                            ...prev.labor,
                            otRules: {
                              ...prev.labor.otRules,
                              [key]: {
                                ...prev.labor.otRules?.[key],
                                [field]: e.target.value === "" ? null : Number(e.target.value),
                              },
                            },
                          },
                        }))
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Labor rates</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          Hourly rates for the PM's estimate on a labor request. A request can override these
          per show when a crew bills differently in another city.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            ["riggers", "Riggers"],
            ["hands", "Hands"],
            ["contractors", "Contractors"],
            ["harvest", "Harvest"],
          ].map(([key, label]) => (
            <div className="field" key={key} style={{ maxWidth: 130 }}>
              <label htmlFor={`rate-${key}`}>{label} ($/hr)</label>
              <input
                id={`rate-${key}`}
                className="input mono"
                type="number"
                step="0.5"
                value={settings.labor.rates[key] ?? ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    labor: {
                      ...prev.labor,
                      rates: { ...prev.labor.rates, [key]: e.target.value },
                    },
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>PO request recipients</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          One email per line. The account code decides which list a request goes to —
          subrents, labor, and trucking count as rental. The requester is always copied.
        </p>

        <div className="stack">
          <RecipientField
            label="Rental requests go to"
            value={settings.po.rentalRecipients}
            onChange={(t) => updateGroup("po", "rentalRecipients", t)}
          />
          <RecipientField
            label="Purchase and maintenance requests go to"
            value={settings.po.purchaseRecipients}
            onChange={(t) => updateGroup("po", "purchaseRecipients", t)}
          />
        </div>

        {(settings.po.extraRecipients || []).length > 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            Also copied:{" "}
            {settings.po.extraRecipients
              .map((r) => `${r.email} when ${r.whenRequester} requests`)
              .join("; ")}
            .
          </p>
        )}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>Production report recipients</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: -4, marginBottom: 14 }}>
          One email per line. Reports and tech reviews go out as two separate emails.
        </p>

        <div className="stack">
          <RecipientField
            label="Production reports go to"
            value={settings.prodReport.reportRecipients}
            onChange={(t) => updateGroup("prodReport", "reportRecipients", t)}
          />
          <RecipientField
            label="Tech reviews go to"
            value={settings.prodReport.reviewRecipients}
            onChange={(t) => updateGroup("prodReport", "reviewRecipients", t)}
          />
          <div className="field" style={{ maxWidth: 190 }}>
            <label htmlFor="threshold">Report required above ($)</label>
            <input
              id="threshold"
              className="input mono"
              type="number"
              step="500"
              value={settings.prodReport.reportThreshold}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  prodReport: { ...prev.prodReport, reportThreshold: e.target.value },
                }))
              }
            />
          </div>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Events below this value don't need a production report.
          </p>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Files</h2>
        <div className="field" style={{ maxWidth: 190 }}>
          <label htmlFor="slack-max">Slack copy limit (MB)</label>
          <input
            id="slack-max"
            className="input mono"
            type="number"
            step="1"
            value={settings.files.slackCopyMaxMb}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                files: { ...prev.files, slackCopyMaxMb: e.target.value },
              }))
            }
          />
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Files under this size upload to Slack as a copy so they preview inline. Larger ones
          post as a share link instead.
        </p>
      </div>
    </div>
  );
}

function RecipientField({ label, value, onChange }) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea
        className="textarea mono"
        style={{ fontSize: 12, minHeight: 70 }}
        value={(value || []).join("\n")}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function splitEmails(text) {
  return text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Goals are stored as fractions but read as percentages. */
function pctValue(fraction) {
  if (fraction == null || fraction === "") return "";
  return Math.round(Number(fraction) * 1000) / 10;
}

function pctToFraction(value) {
  if (value === "") return 0;
  return Number(value) / 100;
}
