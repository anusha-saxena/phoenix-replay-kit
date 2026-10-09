"use client";
import { useEffect, useState, useRef } from "react";
import WorkspaceStrategy from "./workspace-strategy";
import WorkspaceChart from "./workspace-chart";
import type {
  Capabilities,
  Template,
  Selection,
  Snapshot,
  WorkspaceResult,
  RunInput,
} from "../lib/workspace-types";
import type { ReplayDecision } from "../../../src/index.js";
async function api<T>(action: string, body?: unknown): Promise<T> {
  const response = await fetch(
    `/api/workspace/${action}`,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed");
  return result as T;
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2) + "\n"], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function runKey(input: RunInput | null) {
  if (!input) return "";
  return JSON.stringify({
    snapshotId: input.snapshot.id,
    baseline: input.baseline,
    candidate: input.candidate,
    assertions: input.assertions,
  });
}

const utc = (time: number) =>
  new Date(time).toISOString().replace("T", " ").replace(".000Z", " UTC");
const localInput = (time: number) => new Date(time).toISOString().slice(0, 16);
export default function Workspace() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [baseline, setBaseline] = useState<Selection>({
    id: "ema-cross",
    params: { fastPeriod: 9, slowPeriod: 21, priceField: "close" },
  });
  const [candidate, setCandidate] = useState<Selection>({
    id: "ema-cross",
    params: { fastPeriod: 5, slowPeriod: 21, priceField: "close" },
  });
  const [compare, setCompare] = useState(false);
  const [mode, setMode] = useState("demo");
  const [market, setMarket] = useState("");
  const [timeframe, setTimeframe] = useState("5m");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [duration, setDuration] = useState(86400000);
  const [refresh, setRefresh] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [fetchKey, setFetchKey] = useState("");
  const [completed, setCompleted] = useState<{
    result: WorkspaceResult;
    input: RunInput;
  } | null>(null);
  const selectionRequest = useRef(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [details, setDetails] = useState<(ReplayDecision | null)[] | null>(
    null,
  );
  const [assertions, setAssertions] = useState<Record<string, string>>({});
  const [exact, setExact] = useState(false);
  const dataKey = JSON.stringify({
    mode,
    market,
    timeframe,
    from,
    to,
    duration,
  });
  async function discover() {
    setDiscoveryError("");
    try {
      const result = await api<Capabilities>("capabilities");
      setCapabilities(result);
      setMarket(
        (previous) =>
          previous ||
          result.markets.find((m) => m.symbol === "SOL")?.symbol ||
          result.markets[0]?.symbol ||
          "",
      );
    } catch (error) {
      setDiscoveryError(
        error instanceof Error ? error.message : "Market discovery failed",
      );
    }
  }
  useEffect(() => {
    const end = Math.floor(Date.now() / 300000) * 300000;
    setTo(localInput(end));
    setFrom(localInput(end - 86400000));
    api<{ strategies: Template[] }>("strategies")
      .then((result) => setTemplates(result.strategies))
      .catch((error) => setError(error.message));
    void discover();
  }, []);
  function preset(ms: number) {
    const end = Math.floor(Date.now() / 300000) * 300000;
    setDuration(ms);
    setTo(localInput(end));
    setFrom(localInput(end - ms));
  }
  async function fetchDataset() {
    setBusy("Fetching dataset");
    setError("");
    try {
      let request: unknown = { mode: "demo" };
      if (mode !== "demo") {
        const readiness = await Promise.all(
          [baseline, ...(compare ? [candidate] : [])].map((selection) =>
            api<{ warmupBars: number }>("validate", selection),
          ),
        );
        request = {
          mode,
          symbol: market,
          timeframe,
          warmupBars: Math.max(...readiness.map((r) => r.warmupBars)),
          refresh,
          ...(mode === "historical"
            ? {
                fromMs: Date.parse(`${from}:00Z`),
                toMs: Date.parse(`${to}:00Z`),
              }
            : { durationMs: duration }),
        };
      }
      const data = await api<Snapshot>("dataset", request);
      setSnapshot(data);
      setFetchKey(dataKey);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Fetch failed");
    } finally {
      setBusy("");
    }
  }
  function currentAssertions() {
    const limits: Record<string, number | boolean> = {};
    for (const [name, value] of Object.entries(assertions)) {
      if (value !== "") limits[name] = Number(value);
    }
    if (exact) limits.exactEquivalence = true;
    return limits;
  }

  const input = snapshot
    ? {
        snapshot,
        baseline,
        ...(compare ? { candidate, assertions: currentAssertions() } : {}),
      }
    : null;
  const stale = completed && runKey(input) !== runKey(completed.input);
  async function run() {
    if (!input) return;
    setBusy(compare ? "Comparing strategies" : "Replaying strategy");
    setError("");
    try {
      const result = await api<WorkspaceResult>(
        compare ? "compare" : "replay",
        input,
      );
      setCompleted({ result, input: structuredClone(input) });
      selectionRequest.current++;
      setSelected(null);
      setDetails(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Replay failed");
    } finally {
      setBusy("");
    }
  }
  async function select(sequence: number, startMs: number | null) {
    if (!completed) return;
    const requestNumber = ++selectionRequest.current;
    setSelected(startMs);
    setDetails(null);
    setError("");
    try {
      const detail = await api<{ decisions: (ReplayDecision | null)[] }>(
        "detail",
        { ...completed.input, sequence },
      );
      if (requestNumber === selectionRequest.current)
        setDetails(detail.decisions);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not load diagnostics",
      );
    }
  }
  async function exportReport() {
    if (!completed) return;
    setBusy("Exporting report");
    setError("");
    try {
      download("phoenix-report.json", await api("export", completed.input));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Export failed");
    } finally {
      setBusy("");
    }
  }
  const report = completed?.result.report;
  const selectedCandle =
    selected === null
      ? undefined
      : completed?.input.snapshot.fixture.bars.find(
          (bar) => bar.time === selected,
        );
  return (
    <>
      <header className="site-header">
        <div className="container header-inner">
          <a className="brand" href="/">
            Strategy Replay Kit built on Phoenix Rise SDK
          </a>
          <nav aria-label="Main navigation">
            <a href="/">Demo</a>
            <a href="/workspace" aria-current="page">
              Developer Workspace
            </a>
            <a
              href="https://github.com/anusha-saxena/phoenix-replay-kit"
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </nav>
        </div>
      </header>
      <main className="container workspace">
        <p className="eyebrow">Developer Workspace</p>
        <h1>Build, replay, and compare your strategy.</h1>
        <p className="muted">
          Choose a template or write declarative rules. Fetch a fixed Phoenix
          perpetuals dataset, inspect decisions, and export an offline replay.
        </p>
        <section className="workspace-section">
          <h2>1. Configure strategies</h2>
          <label className="workspace-check">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
            />{" "}
            Compare original and updated strategies
          </label>
          <div className={compare ? "workspace-columns" : ""}>
            <WorkspaceStrategy
              label={compare ? "Original strategy" : "Strategy"}
              selection={baseline}
              templates={templates}
              onChange={setBaseline}
            />
            {compare && (
              <WorkspaceStrategy
                label="Updated strategy"
                selection={candidate}
                templates={templates}
                onChange={setCandidate}
              />
            )}
          </div>
          {compare && (
            <details>
              <summary>Regression assertions (optional)</summary>
              <div className="workspace-fields">
                {[
                  ["maxChangedDecisions", "Maximum changed decisions"],
                  ["maxChangedPercent", "Maximum changed percent"],
                  ["maxChangedBuy", "Maximum changed BUY decisions"],
                  ["maxChangedSell", "Maximum changed SELL decisions"],
                ].map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={0}
                      max={key === "maxChangedPercent" ? 100 : undefined}
                      step={key === "maxChangedPercent" ? "any" : 1}
                      value={assertions[key] ?? ""}
                      onChange={(e) =>
                        setAssertions({ ...assertions, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="workspace-check">
                <input
                  type="checkbox"
                  checked={exact}
                  onChange={(e) => setExact(e.target.checked)}
                />{" "}
                Require exactly equivalent decisions
              </label>
            </details>
          )}
        </section>
        <section className="workspace-section">
          <h2>2. Choose market data</h2>
          <div className="workspace-fields">
            <label>
              Dataset mode
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="demo">
                  Bundled Demo — historical SOL fixture
                </option>
                <option value="historical">Fetch historical window</option>
                <option value="latest">Fetch latest finalized candles</option>
              </select>
            </label>
            <label>
              Data type
              <select value="candles" disabled>
                <option value="candles">Finalized OHLC candles</option>
              </select>
            </label>
          </div>
          {mode !== "demo" && (
            <>
              <div className="workspace-fields">
                <label>
                  Phoenix market
                  <select
                    value={market}
                    disabled={!capabilities}
                    onChange={(e) => setMarket(e.target.value)}
                  >
                    <option value="">Choose a discovered market</option>
                    {capabilities?.markets.map((m) => (
                      <option key={m.symbol} value={m.symbol}>
                        {m.symbol} ({m.status})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Candle interval
                  <select
                    value={timeframe}
                    onChange={(e) => setTimeframe(e.target.value)}
                  >
                    {(capabilities?.timeframes ?? ["1m", "5m", "1h"]).map(
                      (t) => (
                        <option key={t}>{t}</option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {discoveryError && (
                <p role="alert">
                  {discoveryError}{" "}
                  <button onClick={discover}>Retry discovery</button>
                </p>
              )}
              <div className="workspace-actions">
                <span>Window presets</span>
                {[
                  [7200000, "Last 2 hours"],
                  [86400000, "Last 24 hours"],
                  [604800000, "Last 7 days"],
                ].map(([ms, label]) => (
                  <button key={ms} onClick={() => preset(Number(ms))}>
                    {label}
                  </button>
                ))}
              </div>
              {mode === "historical" ? (
                <div className="workspace-fields">
                  <label>
                    From (UTC, inclusive)
                    <input
                      type="datetime-local"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </label>
                  <label>
                    To (UTC, exclusive)
                    <input
                      type="datetime-local"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <p>
                  Recent window: {duration / 3600000} hours, ending at the last
                  closed candle bucket. This is a new snapshot, not a live
                  stream.
                </p>
              )}
              <label className="workspace-check">
                <input
                  type="checkbox"
                  checked={refresh}
                  onChange={(e) => setRefresh(e.target.checked)}
                />{" "}
                Bypass the historical cache
              </label>
              <p className="muted">
                App limit: 7 days / 5,000 bars including warm-up. Upstream
                retention and completeness are not guaranteed. Funding, sampled
                order books, and trusted TypeScript modules remain available
                through the CLI; this public workspace accepts candle templates
                and safe rules.
              </p>
            </>
          )}
          <button
            className="primary"
            disabled={!!busy || (mode !== "demo" && !capabilities)}
            onClick={fetchDataset}
          >
            {mode === "demo" ? "Load Demo dataset" : "Fetch market data"}
          </button>
          {snapshot && (
            <div className="workspace-dataset">
              <h3>
                Snapshot ready · {snapshot.fixture.meta.symbol} ·{" "}
                {snapshot.fixture.meta.timeframe}
              </h3>
              <p>
                {snapshot.fixture.bars.length.toLocaleString()} finalized
                candles · {snapshot.requestedWarmupBars} requested warm-up bars
              </p>
              <p>
                Requested evaluation: {utc(snapshot.evaluationFromMs)} →{" "}
                {utc(snapshot.evaluationToMs)}
              </p>
              <p>
                Observed data: {utc(snapshot.observedFromMs)} →{" "}
                {utc(snapshot.observedToMs)}
                <br />
                Fetched: {utc(snapshot.fixture.meta.fetchedAtMs)} · Source:{" "}
                {snapshot.mode === "demo"
                  ? "original bundled fixture"
                  : "Phoenix Rise HTTP"}
              </p>
              {!snapshot.fixture.meta.integrity.coverage.complete && (
                <p role="status">
                  WARNING:{" "}
                  {snapshot.fixture.meta.integrity.coverage.leadingMissingBars}{" "}
                  leading,{" "}
                  {snapshot.fixture.meta.integrity.coverage.internalMissingBars}{" "}
                  internal,{" "}
                  {snapshot.fixture.meta.integrity.coverage.trailingMissingBars}{" "}
                  trailing candles missing. Missing buckets are not filled.
                </p>
              )}
              <details>
                <summary>Snapshot identity and provenance</summary>
                <code>{snapshot.id}</code>
                <pre>{JSON.stringify(snapshot.fixture.meta, null, 2)}</pre>
              </details>
              <button
                onClick={() => download("phoenix-snapshot.json", snapshot)}
              >
                Download snapshot
              </button>
              {fetchKey !== dataKey && (
                <p role="status">
                  Data settings changed. Fetch a dataset for these settings
                  before running.
                </p>
              )}
            </div>
          )}
        </section>
        <section className="workspace-section">
          <h2>3. Run {compare ? "comparison" : "replay"}</h2>
          <p className="muted">
            Both strategies consume the same frozen events. Warm-up initializes
            state and is excluded from the common evaluation window. BUY and
            SELL are directional decisions, not simulated trades.
          </p>
          <button
            className="primary"
            disabled={
              !!busy || !snapshot || fetchKey !== dataKey || !templates.length
            }
            onClick={run}
          >
            {compare ? "Compare strategies" : "Run replay"}
          </button>
          {busy && <p role="status">{busy}…</p>}
          {error && (
            <p role="alert" className="workspace-error">
              {error}
            </p>
          )}
          {stale && (
            <p role="status">
              Settings changed. Results and downloads below belong to the last
              completed run.
            </p>
          )}
        </section>
        {completed && report && (
          <section className="workspace-section" aria-label="Workspace results">
            <h2>Results</h2>
            <p>
              <strong>
                {"changedDecisions" in report
                  ? `${report.changedDecisions} changed decisions · ${report.unchangedDecisions} unchanged`
                  : `${report.totalDecisions} decisions replayed`}
              </strong>
            </p>
            <p>
              Common evaluation: {utc(completed.result.evaluation.actualFromMs)}{" "}
              → {utc(completed.result.evaluation.actualToMs)}
              <br />
              {completed.result.evaluation.evaluationEvents.toLocaleString()}{" "}
              evaluation candles · {completed.result.evaluation.warmupEvents}{" "}
              preceding candles excluded
            </p>
            {completed.result.assertion && (
              <p role="status">
                Regression assertions:{" "}
                {completed.result.assertion.passed ? "PASS" : "FAIL"} ·{" "}
                {completed.result.assertion.metrics.changedPercent.toFixed(2)}%
                changed
                {completed.result.assertion.failures.length > 0
                  ? ` (${completed.result.assertion.failures.join(", ")})`
                  : ""}
              </p>
            )}
            {report.warnings.map((warning, i) => (
              <p className="muted" key={i}>
                WARNING: {warning}
              </p>
            ))}
            <div className="workspace-table">
              <table>
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>BUY</th>
                    <th>SELL</th>
                    <th>HOLD</th>
                  </tr>
                </thead>
                <tbody>
                  {("baseline" in report
                    ? [report.baseline, report.candidate]
                    : [{ name: report.strategyName, counts: report.counts }]
                  ).map((strategy, i) => (
                    <tr key={i}>
                      <td>{strategy.name}</td>
                      <td>{strategy.counts.BUY}</td>
                      <td>{strategy.counts.SELL}</td>
                      <td>{strategy.counts.HOLD}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>
              {"diffs" in report ? "Changed decisions" : "Decision timeline"}
            </h3>
            <p className="muted">
              Select a timestamp to see the recorded diagnostics. Showing up to{" "}
              {"diffs" in report ? 1000 : 200} rows; the export contains the
              full timeline.
            </p>
            <div className="workspace-table workspace-timeline">
              <table>
                <thead>
                  <tr>
                    <th>Timestamp (UTC)</th>
                    <th>{"diffs" in report ? "Original" : "Signal"}</th>
                    {"diffs" in report && <th>Updated</th>}
                  </tr>
                </thead>
                <tbody>
                  {"diffs" in report
                    ? report.diffs.map((d) => (
                        <tr key={d.eventId}>
                          <td>
                            <button
                              onClick={() =>
                                select(
                                  d.sequence,
                                  d.baseline?.candleStartMs ??
                                    d.candidate?.candleStartMs ??
                                    null,
                                )
                              }
                            >
                              {utc(d.timestampMs)}
                            </button>
                          </td>
                          <td>{d.baseline?.signal ?? "No decision"}</td>
                          <td>{d.candidate?.signal ?? "No decision"}</td>
                        </tr>
                      ))
                    : report.decisions.map((d) => (
                        <tr key={d.eventId}>
                          <td>
                            <button
                              onClick={() =>
                                select(d.sequence, d.candleStartMs)
                              }
                            >
                              {utc(d.availableAtMs)}
                            </button>
                          </td>
                          <td>{d.signal}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
              {"diffs" in report && report.changedDecisions === 0 && (
                <p>No changed decisions in this evaluation window.</p>
              )}
            </div>
            {selected !== null && (
              <section className="workspace-dataset">
                <h3>Selected candle · {utc(selected)}</h3>
                {selectedCandle && (
                  <p>
                    Trade OHLC: {selectedCandle.open} / {selectedCandle.high} /{" "}
                    {selectedCandle.low} / {selectedCandle.close}
                    <br />
                    Mark close: {selectedCandle.markClose} · Available:{" "}
                    {utc(
                      selectedCandle.time +
                        completed.input.snapshot.fixture.meta.timeframeMs,
                    )}
                  </p>
                )}
                {details ? (
                  details.map((decision, i) => (
                    <div key={i}>
                      <h4>
                        {completed.result.strategies[i]?.name}:{" "}
                        {decision?.signal ?? "No decision"}
                      </h4>
                      <p>{decision?.reason}</p>
                      <pre>
                        {JSON.stringify(decision?.diagnostics, null, 2)}
                      </pre>
                    </div>
                  ))
                ) : (
                  <p>Loading recorded diagnostics…</p>
                )}
                <button
                  onClick={() => {
                    selectionRequest.current++;
                    setSelected(null);
                    setDetails(null);
                  }}
                >
                  Show full history
                </button>
              </section>
            )}
            <WorkspaceChart
              snapshot={completed.input.snapshot}
              chart={completed.result.chart}
              selected={selected}
            />
            <h3>4. Export and reproduce</h3>
            <div className="workspace-actions">
              <button disabled={!!busy} onClick={exportReport}>
                Download full report
              </button>
              <button
                onClick={() =>
                  download("phoenix-manifest.json", {
                    schemaVersion: 1,
                    ...completed.input,
                  })
                }
              >
                Download replay manifest
              </button>
              <button
                onClick={() =>
                  download("phoenix-strategies.json", {
                    baseline: completed.input.baseline,
                    candidate: completed.input.candidate,
                  })
                }
              >
                Download strategy configuration
              </button>
              <button
                onClick={() =>
                  download("phoenix-snapshot.json", completed.input.snapshot)
                }
              >
                Download run snapshot
              </button>
            </div>
            <p>
              The manifest embeds the exact snapshot and configuration. From the
              repository, run:
            </p>
            <pre>
              npm run phoenix -- workspace --manifest phoenix-manifest.json
              --out phoenix-report.json
            </pre>
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(
                    "npm run phoenix -- workspace --manifest phoenix-manifest.json --out phoenix-report.json",
                  )
                  .catch(() =>
                    setError("Clipboard unavailable; copy the command above."),
                  )
              }
            >
              Copy CLI command
            </button>
            <details>
              <summary>Run identity and evaluation contract</summary>
              <pre>
                {JSON.stringify(
                  {
                    reportId: completed.result.reportId,
                    snapshotId: completed.result.snapshot.id,
                    engineVersion: completed.result.engineVersion,
                    strategies: completed.result.strategies,
                    evaluation: completed.result.evaluation,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </section>
        )}
      </main>
    </>
  );
}
