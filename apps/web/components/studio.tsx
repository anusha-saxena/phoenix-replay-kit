"use client";
import { useEffect, useState } from "react";
import Charts from "./charts";
import { BuySetting, AdvancedSetting } from "./strategy-settings";
import { example, parseConfig } from "../lib/config";
import { utc, explainDecision } from "../lib/presentation";
import type { DemoData, CompareData } from "../lib/engine";
const github = "https://github.com/anusha-saxena/phoenix-replay-kit";
const sides = ["baseline", "candidate"] as const;
const labels = { baseline: "Original strategy", candidate: "Updated strategy" };
const cli = `npm run phoenix -- compare \\\n  --data data/fixtures/candles/sol-5m-1790869255065-1791474055065.json \\\n  --baseline strategies/rsi-v1.ts \\\n  --candidate strategies/rsi-v2.ts \\\n  --max-changed-decisions 0`;
async function requestComparison(
  configs: typeof example,
): Promise<CompareData> {
  const response = await fetch("/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(configs),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Comparison failed");
  return data;
}
function Signal({ value }: { value?: string }) {
  return (
    <span className={`signal ${(value ?? "").toLowerCase()}`}>
      {value ?? "SKIPPED"}
    </span>
  );
}
export default function Studio() {
  const [demo, setDemo] = useState<DemoData | null>(null);
  const [result, setResult] = useState<CompareData | null>(null);
  const [configs, setConfigs] = useState<typeof example>(
    structuredClone(example),
  );
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All changes");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [dataset, comparison] = await Promise.all([
        fetch("/api/demo").then(async (response) => {
          if (!response.ok) throw new Error("Unable to load historical data");
          return response.json();
        }),
        requestComparison(example),
      ]);
      setDemo(dataset);
      setResult(comparison);
      setSelected(null);
    } catch {
      setError("We could not load the demo. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function run() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      parseConfig(configs.baseline, "Original strategy");
      parseConfig(configs.candidate, "Updated strategy");
      setResult(await requestComparison(configs));
      setSelected(null);
      setFilter("All changes");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to run comparison");
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "phoenix-comparison.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stale =
    result !== null &&
    JSON.stringify(configs) !== JSON.stringify(result.configs);
  const diff = result?.report.diffs.find((d) => d.eventId === selected);
  const candle = demo?.candles.find(
    (c) =>
      c.time ===
      (diff?.baseline?.candleStartMs ?? diff?.candidate?.candleStartMs),
  );
  const rows =
    result?.report.diffs.filter((d) => {
      const category = `${d.baseline?.signal} → ${d.candidate?.signal}`;
      return (
        filter === "All changes" ||
        filter === category ||
        (filter === "Other changes" &&
          !["BUY → HOLD", "HOLD → BUY"].includes(category))
      );
    }) ?? [];
  return (
    <>
      <header>
        <div className="container header-inner">
          <a className="brand" href="#overview">
            Strategy Replay Kit built on Phoenix Rise SDK
          </a>
          <nav aria-label="Main navigation">
            <a href="#demo">Demo</a>
            <a href="/workspace">Developer Workspace</a>
            <a href={github} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
          </nav>
        </div>
      </header>
      <main className="container">
        <section id="overview" className="intro">
          <p className="eyebrow intro-kicker">Strategy Regression Testing</p>
          <h1>What happens when a developer updates a trading strategy?</h1>
          <p className="eyebrow author-credit">Made with ♡ by Anusha</p>

          <p className="lead">
            Even a small change in strategy logic can change when it generates
            BUY, SELL, or HOLD signals. This tool lets developers
            replay the same historical market data through two strategy versions
            and see exactly where their decisions differ.
          </p>
          <dl className="problem-solution">
            <div>
              <dt>The problem</dt>
              <dd>
                A strategy change can introduce unexpected behavior that’s hard
                to detect by reading code alone.
              </dd>
            </div>
            <div>
              <dt>The solution</dt>
              <dd>
                This is a data analytics & deterministic strategy replay tool that runs both versions on the same Phoenix market data, then
                looks at every BUY, SELL, or HOLD decision that changed.
              </dd>
            </div>
          </dl>
          <div className="actions">
            <a href="#demo" className="button primary">
              Try the interactive demo
            </a>
            <a
              href={github}
              target="_blank"
              rel="noreferrer"
            >
              GitHub ↗
            </a>
          </div>
        </section>
        <section
          id="demo"
          className="demo-section"
          aria-label="Interactive strategy comparison"
        >
          <h2>Try changing a strategy</h2>
          <p>
            We’re testing a simple trading rule based on RSI, a momentum
            indicator ranging from 0 to 100. The strategy generates a BUY signal
            when RSI crosses upward through a chosen threshold.
          </p>
          <p>
            Let’s see what changes when we lower that threshold from 30 to 25.
          </p>
          {demo && (
            <p className="dataset-line">
              Demo dataset: {demo.meta.symbol}-PERP · 5-minute candles ·{" "}
              {demo.candles.length.toLocaleString()} recorded observations.
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run();
            }}
            aria-label="Strategy settings"
          >
            <div className="strategy-grid">
              {sides.map((side) => (
                <BuySetting
                  key={side}
                  title={labels[side]}
                  config={configs[side]}
                  onChange={(value) =>
                    setConfigs({ ...configs, [side]: value })
                  }
                />
              ))}
            </div>
            <details className="advanced">
              <summary>Advanced strategy settings</summary>
              <p>
                RSI period controls how many price changes the indicator uses.
                SELL is triggered by crossing downward through the upper
                threshold. Mark close uses the recorded mark price instead of
                the last trade price.
              </p>
              <div className="advanced-grid">
                {sides.map((side) => (
                  <AdvancedSetting
                    key={side}
                    title={labels[side]}
                    config={configs[side]}
                    onChange={(value) =>
                      setConfigs({ ...configs, [side]: value })
                    }
                  />
                ))}
              </div>
            </details>
            <p className="same-data">
              Both strategies process the exact same historical SOL prices. Only
              their settings differ.
            </p>
            <div className="actions run-actions">
              <button
                className="button primary"
                type="submit"
                disabled={busy || !demo}
              >
                {busy ? "Running comparison…" : "Run comparison"}
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  setConfigs({ ...configs, candidate: { ...configs.baseline } })
                }
              >
                Make both strategies identical
              </button>
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() => setConfigs(structuredClone(example))}
              >
                Reset
              </button>
            </div>
            <p className="settings-notice" role="status">
              {stale
                ? "Settings changed. Run comparison to see updated results."
                : busy
                  ? "Replaying both strategies on the same recorded observations…"
                  : result
                    ? "Comparison complete. Explore the results below."
                    : ""}
            </p>
          </form>
          {error && (
            <div role="alert" className="error">
              {error}{" "}
              {!demo && (
                <button onClick={() => void load()}>Retry loading</button>
              )}
            </div>
          )}
          {!result && !error && (
            <p role="status">
              Loading the dataset and comparing the example settings…
            </p>
          )}
        </section>
        {result && demo && (
          <>
            <section
              className="result-section"
              aria-label="Comparison results"
              aria-busy={busy}
            >
              <div className="section-heading">
                <div>
                  <p className="eyebrow">
                    {stale
                      ? "Previous comparison · settings changed"
                      : "Comparison results"}
                  </p>
                  <h2 className="result-title">
                    <span
                      data-testid="changed-count"
                      aria-hidden={result.report.changedDecisions === 0}
                    >
                      {result.report.changedDecisions}
                    </span>
                    {result.report.changedDecisions === 0 ? (
                      <span className="zero-title">No decisions changed.</span>
                    ) : (
                      " decisions changed"
                    )}
                  </h2>
                </div>
                <button className="button" onClick={download}>
                  Download JSON
                </button>
              </div>
              <p>
                {result.report.changedDecisions === 0
                  ? "Both versions produced the same decisions on all comparable observations."
                  : `Across ${result.report.inputEvents.toLocaleString()} historical market observations, the two strategies made different decisions at ${result.report.changedDecisions.toLocaleString()} timestamps.`}
              </p>
              <div className="result-detail">
                <table className="count-table">
                  <caption className="sr-only">
                    Decision totals from the last completed comparison
                  </caption>
                  <thead>
                    <tr>
                      <th>Decision</th>
                      <th>Original</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["BUY", "SELL", "HOLD"] as const).map((signal) => (
                      <tr key={signal}>
                        <th scope="row">{signal}</th>
                        <td>
                          {result.report.baseline.counts[
                            signal
                          ].toLocaleString()}
                        </td>
                        <td>
                          {result.report.candidate.counts[
                            signal
                          ].toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="result-context">
                  <p>
                    <strong>
                      {result.report.unchangedDecisions.toLocaleString()}
                    </strong>{" "}
                    decisions were unchanged.
                  </p>
                  <p>
                    Fewer BUY signals do not necessarily mean a better strategy.
                  </p>
                  <p>
                    This tool compares trading signals, not trades, profits, or
                    investment performance.
                  </p>
                </div>
              </div>
            </section>
            <section className="investigation" aria-label="Changed decisions">
              <div className="section-heading">
                <div>
                  <h2>See exactly where the strategies disagree</h2>
                  <p>
                    Choose a timestamp to understand the difference and focus
                    the charts below.
                  </p>
                </div>
                <label className="filter-label">
                  Show
                  <select
                    aria-label="Changed decision types"
                    value={filter}
                    onChange={(e) => {
                      setFilter(e.target.value);
                      setSelected(null);
                    }}
                  >
                    {[
                      "All changes",
                      "BUY → HOLD",
                      "HOLD → BUY",
                      "Other changes",
                    ].map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </label>
              </div>
              {rows.length ? (
                <div className="diff-table-wrap">
                  <table className="diff-table">
                    <thead>
                      <tr>
                        <th>Time (UTC)</th>
                        <th>Original decision</th>
                        <th>Updated decision</th>
                        <th>Why it changed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr
                          key={d.eventId}
                          className={selected === d.eventId ? "selected" : ""}
                          onClick={() => setSelected(d.eventId)}
                        >
                          <td>
                            <button
                              className="row-button"
                              aria-pressed={selected === d.eventId}
                              onClick={() => setSelected(d.eventId)}
                            >
                              {utc(d.timestampMs)}
                            </button>
                          </td>
                          <td>
                            <Signal value={d.baseline?.signal} />
                          </td>
                          <td>
                            <Signal value={d.candidate?.signal} />
                          </td>
                          <td>
                            {result.configs.baseline.period !==
                              result.configs.candidate.period ||
                            result.configs.baseline.priceField !==
                              result.configs.candidate.priceField
                              ? "Different RSI settings"
                              : d.baseline?.signal === "SELL" ||
                                  d.candidate?.signal === "SELL"
                                ? `SELL threshold: ${result.configs.baseline.sellThreshold} → ${result.configs.candidate.sellThreshold}`
                                : `BUY threshold: ${result.configs.baseline.buyThreshold} → ${result.configs.candidate.buyThreshold}`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="empty">
                  {result.report.changedDecisions === 0
                    ? "No decisions changed. Try a different threshold to explore a behavioral change."
                    : "No decisions match this filter."}
                </p>
              )}
              {diff && (
                <section className="selection" aria-label="Selected decision">
                  <h3>{utc(diff.timestampMs)} UTC</h3>
                  <p className="decision-pair">
                    Original: <Signal value={diff.baseline?.signal} />{" "}
                    <span aria-hidden="true">→</span> Updated:{" "}
                    <Signal value={diff.candidate?.signal} />
                  </p>
                  <div className="explanation-grid">
                    {sides.map((side) => (
                      <div key={side}>
                        <h4>{labels[side]}</h4>
                        <p>
                          {explainDecision(diff[side], result.configs[side])}
                        </p>
                        {(result.configs.baseline.period !==
                          result.configs.candidate.period ||
                          result.configs.baseline.priceField !==
                            result.configs.candidate.priceField) && (
                          <p className="small">
                            RSI({result.configs[side].period}) using{" "}
                            {result.configs[side].priceField === "close"
                              ? "close"
                              : "mark close"}
                            .
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                  <details>
                    <summary>Technical diagnostics</summary>
                    {candle && (
                      <p>
                        Candle start: {utc(candle.time)} UTC. Open {candle.open}
                        , high {candle.high}, low {candle.low}, close{" "}
                        {candle.close}.
                      </p>
                    )}
                    <pre>
                      {JSON.stringify(
                        {
                          eventId: diff.eventId,
                          decisionTimeUtc: diff.timestampUtc,
                          configurations: result.configs,
                          original: diff.baseline,
                          updated: diff.candidate,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </section>
              )}
            </section>
            <Charts
              demo={demo}
              result={result}
              selected={diff?.timestampMs ?? null}
            />
          </>
        )}
        <section id="how-it-works" className="how-section">
          <h2>The design</h2>
          <p>
            Change your strategy, replay the same data, and see what moved
            before you ship it. Here’s what happens along the way:
          </p>
          <ol className="pipeline">
            {[
              [
                "Collect",
                "Fetch candles with the Rise SDK’s candles.getCandlesV2 method. Save a JSON fixture with source metadata and coverage checks.",
              ],
              [
                "Replay",
                "Validate the fixture and turn closed candles into replay events. Process them in a fixed order, using candle close as the decision time.",
              ],
              [
                "Evaluate",
                "Create a fresh strategy instance for each version. Each processes the same events with its own indicator state, recording signals, reasons, and diagnostic values.",
              ],
              [
                "Compare",
                "Match decisions by event ID and flag changed signals or missing decisions. Reports include counts, timestamps, and both versions’ diagnostics.",
              ],
            ].map(([title, description]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </li>
            ))}
          </ol>
          <p>
            The demo sends your settings to <code>/api/compare</code>. The server
            runs both strategies through the same TypeScript engine used by the
            CLI, using a bundled dataset rather than fetching new prices each
            time. The CLI can load local TypeScript
            strategy modules, too!
          </p>
          <details className="cli">
            <summary>
              Add a strategy check to your CI
            </summary>
            <div className="section-heading">
              <p>
                Set the limit to zero to fail the check if any decision changes.
                This example update changes decisions, so the command exits
                with code 1. Raise the limit if you expect some changes.
              </p>
              <button
                className="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(cli);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setError(
                      "Clipboard unavailable. Select and copy the command below.",
                    );
                  }
                }}
              >
                {copied ? "Copied" : "Copy command"}
              </button>
            </div>
            <pre>{cli}</pre>
            <a href={`${github}/blob/main/CLI.md`}>
              Read the CLI documentation ↗
            </a>
          </details>
        </section>
        {demo && (
          <section className="methodology">
            <p className="data-note">
              The collection is missing its last {demo.meta.integrity.coverage.trailingMissingBars}{" "}
              candles. We replay the candles we have; missing prices aren’t filled in.
            </p>
            <details>
              <summary>Dataset and methodology</summary>
              <dl className="metadata">
                <div>
                  <dt>Historical replay range (UTC)</dt>
                  <dd>
                    {utc(demo.replayStartMs)} → {utc(demo.replayEndMs)}
                  </dd>
                </div>
                <div>
                  <dt>Collected (UTC)</dt>
                  <dd>{utc(demo.meta.fetchedAtMs)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>
                    {demo.meta.sdkPackage} · {demo.meta.method}
                  </dd>
                </div>
                <div>
                  <dt>Data completeness</dt>
                  <dd>
                    {demo.meta.integrity.coverage.leadingMissingBars} leading,{" "}
                    {demo.meta.integrity.coverage.internalMissingBars} internal,{" "}
                    {demo.meta.integrity.coverage.trailingMissingBars} trailing
                    candles missing.
                  </dd>
                </div>
                <div>
                  <dt>Dataset identity</dt>
                  <dd className="dataset-id">{demo.datasetId}</dd>
                </div>
                <div>
                  <dt>When a candle is used</dt>
                  <dd>
                    We treat each finished candle as available at its scheduled
                    close. We don’t know how long the API took to publish it.
                    Charts label the candle’s start; its decision is timestamped
                    {" "}{demo.meta.timeframe} later, when that candle closes.
                  </dd>
                </div>
              </dl>
            </details>
          </section>
        )}
      </main>
      <footer className="container">
        <p className="signature">Made with <span aria-label="love">♡</span> by Anusha</p>
        <p className="footer-credit">Built using the Ellipsis Labs Rise SDK.<br />
          Independent project, not an official Ellipsis Labs product.</p>
      </footer>
    </>
  );
}
