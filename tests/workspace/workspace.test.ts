import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { syntheticFixture } from "../helpers/synthetic-fixture.js";
import {
  Ema,
  createEmaCrossStrategy,
  createBreakoutStrategy,
  createDeclarativeStrategy,
  createRsiCrossStrategy,
  listStrategies,
  parseStrategySelection,
  strategyFactory,
  createCandleReplayEvents,
  runReplay,
  createSnapshot,
  validateSnapshot,
  runWorkspace,
  evaluateSnapshot,
  checkAssertions,
  compareStrategies,
  validateCandleFixture,
} from "../../src/index.js";
const long = () =>
  syntheticFixture(
    Array.from({ length: 70 }, (_, i) => 100 + 10 * Math.sin(i / 3)),
  );
const snapshot = () => {
  const f = long();
  return createSnapshot(
    f,
    "historical",
    f.bars[25]!.time,
    f.meta.requestedToMs,
    25,
  );
};
const ema = { id: "ema-cross", params: { fastPeriod: 3, slowPeriod: 8 } };
describe("shared strategy contracts", () => {
  it("discovers valid defaults and rejects unsafe/unrecognized configuration", () => {
    expect(listStrategies().map((t) => t.id)).toEqual([
      "rsi-cross",
      "ema-cross",
      "breakout",
    ]);
    for (const template of listStrategies())
      expect(strategyFactory({ id: template.id })().requiredInputs).toEqual([
        "candle_closed",
      ]);
    for (const value of [
      { id: "constructor" },
      { id: "__proto__" },
      { id: "ema-cross", params: { fastPeriod: 21, slowPeriod: 9 } },
      { id: "breakout", params: { lookback: -1 } },
      { id: "rsi-cross", params: { buyThreshold: 70, sellThreshold: 30 } },
      { id: "ema-cross", path: "/tmp/code.ts" },
      { id: "ema-cross", params: { code: "eval()" } },
    ])
      expect(() => parseStrategySelection(value)).toThrow();
  });
  it("seeds EMA with the mean and applies a hand-calculated smoothing update", () => {
    const e = new Ema(3);
    expect([e.update(10), e.update(20), e.update(30), e.update(40)]).toEqual([
      null,
      null,
      20,
      30,
    ]);
    expect(() => e.update(NaN)).toThrow();
  });
  it("emits real EMA crossings, holds flat prices and resets state for every run", () => {
    const events = createCandleReplayEvents(long());
    const factory = createEmaCrossStrategy({ fastPeriod: 3, slowPeriod: 8 });
    const result = runReplay({ events, strategy: factory });
    expect(result.counts.BUY).toBeGreaterThan(0);
    expect(result.counts.SELL).toBeGreaterThan(0);
    expect(result).toEqual(runReplay({ events, strategy: factory }));
    const flat = runReplay({
      events: createCandleReplayEvents(syntheticFixture(Array(40).fill(10))),
      strategy: factory,
    });
    expect(flat.counts.BUY + flat.counts.SELL).toBe(0);
    const prefix = runReplay({
      events: createCandleReplayEvents(
        syntheticFixture(
          long()
            .bars.slice(0, 35)
            .map((b) => b.close),
        ),
      ),
      strategy: factory,
    });
    expect(prefix.decisions).toEqual(result.decisions.slice(0, 35));
  });
  it("breaks the prior close window without including the current candle, and suppresses repeated same-side signals", () => {
    const result = runReplay({
      events: createCandleReplayEvents(
        syntheticFixture([10, 10, 11, 12, 11, 8]),
      ),
      strategy: createBreakoutStrategy({ lookback: 2 }),
    });
    expect(result.decisions.map((d) => d.signal)).toEqual([
      "HOLD",
      "HOLD",
      "BUY",
      "HOLD",
      "HOLD",
      "SELL",
    ]);
    expect(result.decisions[2]!.diagnostics?.high).toBe(10);
  });
  it("evaluates indicator crossings and AND / OR rules safely with first-match semantics", () => {
    const spec = {
      name: "Rules",
      rules: [
        {
          signal: "BUY",
          when: {
            op: "and",
            conditions: [
              {
                op: "crossAbove",
                left: { kind: "ema", period: 2 },
                right: { kind: "ema", period: 4 },
              },
              {
                op: "gt",
                left: { kind: "price" },
                right: { kind: "constant", value: 0 },
              },
            ],
          },
        },
        {
          signal: "SELL",
          when: {
            op: "crossBelow",
            left: { kind: "ema", period: 2 },
            right: { kind: "ema", period: 4 },
          },
        },
      ],
    };
    const events = createCandleReplayEvents(long());
    const declarative = runReplay({
      events,
      strategy: createDeclarativeStrategy(spec),
    });
    const builtin = runReplay({
      events,
      strategy: createEmaCrossStrategy({ fastPeriod: 2, slowPeriod: 4 }),
    });
    expect(declarative.decisions.map((d) => d.signal)).toEqual(
      builtin.decisions.map((d) => d.signal),
    );
    expect(declarative).toEqual(
      runReplay({ events, strategy: createDeclarativeStrategy(spec) }),
    );
    expect(() =>
      createDeclarativeStrategy({
        name: "code",
        rules: [],
        code: "process.exit()",
      }),
    ).toThrow();
    let condition: unknown = {
      op: "gt",
      left: { kind: "price" },
      right: { kind: "constant", value: 1 },
    };
    for (let i = 0; i < 20; i++)
      condition = { op: "and", conditions: [condition] };
    expect(() =>
      createDeclarativeStrategy({
        name: "deep",
        rules: [{ signal: "BUY", when: condition }],
      }),
    ).toThrow(/levels/);
  });
});
describe("immutable snapshots and common evaluation", () => {
  it("round-trips an immutable snapshot, verifies its hash, and detects tampering", () => {
    const data = snapshot();
    expect(Object.isFrozen(data.fixture.bars[0])).toBe(true);
    expect(validateSnapshot(JSON.parse(JSON.stringify(data)))).toEqual(data);
    const changed = JSON.parse(JSON.stringify(data));
    changed.fixture.bars[0].volume = 999;
    expect(() => validateSnapshot(changed)).toThrow(/hash/);
    changed.id = "0".repeat(64);
    expect(() => validateSnapshot(changed)).toThrow();
  });
  it("uses preceding history without counting it; both strategies share the requested window", () => {
    const data = snapshot();
    const result = runWorkspace({
      snapshot: data,
      baseline: ema,
      candidate: { id: "rsi-cross", params: { period: 14 } },
    });
    expect(result.evaluation.evaluationEvents).toBe(45);
    expect(result.evaluation.warmupEvents).toBe(25);
    expect(result.traces[0]!.map((d) => d.eventId)).toEqual(
      result.traces[1]!.map((d) => d.eventId),
    );
    expect(
      result.traces[1]!.every((d) => d.diagnostics?.warmup === false),
    ).toBe(true);
    expect(result.reportId).toBe(
      runWorkspace(
        JSON.parse(
          JSON.stringify({
            snapshot: data,
            baseline: ema,
            candidate: { id: "rsi-cross", params: { period: 14 } },
          }),
        ),
      ).reportId,
    );
    const warmupChange = JSON.parse(JSON.stringify(data.fixture));
    warmupChange.bars[0].close = 1;
    warmupChange.bars[0].open = 1;
    warmupChange.bars[0].high = 1;
    warmupChange.bars[0].low = 1;
    const changed = createSnapshot(
      validateCandleFixture(warmupChange),
      "historical",
      data.evaluationFromMs,
      data.evaluationToMs,
      25,
    );
    expect(changed.id).not.toBe(data.id);
  });
  it("warns and narrows evaluation for insufficient preceding history", () => {
    const f = long();
    const data = createSnapshot(
      f,
      "historical",
      f.meta.requestedFromMs,
      f.meta.requestedToMs,
    );
    const result = evaluateSnapshot(data, [
      createEmaCrossStrategy({ fastPeriod: 3, slowPeriod: 8 }),
      createRsiCrossStrategy({ period: 14 }),
    ]);
    expect(result.evaluation.evaluationEvents).toBe(55);
    expect(result.results[0]!.warnings.join(" ")).toContain(
      "Insufficient preceding history",
    );
  });
  it("keeps the original demo at 24 differences and allows its incomplete coverage", async () => {
    const fixture = validateCandleFixture(
      JSON.parse(
        await readFile(
          "data/fixtures/candles/sol-5m-1790869255065-1791474055065.json",
          "utf8",
        ),
      ),
    );
    const result = compareStrategies({
      events: createCandleReplayEvents(fixture),
      baseline: createRsiCrossStrategy(),
      candidate: createRsiCrossStrategy({ buyThreshold: 25 }),
    });
    expect(result.changedDecisions).toBe(24);
    expect(result.unchangedDecisions).toBe(1859);
    expect(fixture.meta.integrity.coverage.trailingMissingBars).toBe(132);
    const assertions = checkAssertions(result, {
      maxChangedDecisions: 24,
      maxChangedPercent: 2,
      maxChangedBuy: 24,
      maxChangedSell: 0,
    });
    expect(assertions.passed).toBe(true);
    expect(assertions.metrics.changedBuy).toBe(24);
    expect(
      checkAssertions(result, { exactEquivalence: true, maxChangedPercent: 0 })
        .failures,
    ).toEqual(["maxChangedPercent", "exactEquivalence"]);
  });
});

it("runs lifecycle hooks with fresh state and rejects incompatible declared inputs", async () => {
  const { createBookImbalanceStrategy } = await import("../../src/index.js");
  const events = createCandleReplayEvents(long());
  expect(() =>
    runReplay({ events, strategy: createBookImbalanceStrategy() }),
  ).toThrow("requires orderbook_snapshot");
  const lifecycle: string[] = [];
  const factory = () => {
    let seen = 0;
    return {
      name: "Lifecycle",
      initialize() {
        lifecycle.push("initialize");
      },
      finalize() {
        lifecycle.push(`finalize:${seen}`);
      },
      onEvent() {
        seen++;
        return { signal: "HOLD" as const, diagnostics: { seen } };
      },
    };
  };
  const first = runReplay({ events, strategy: factory });
  expect(runReplay({ events, strategy: factory }).decisions).toEqual(
    first.decisions,
  );
  expect(lifecycle).toEqual([
    "initialize",
    "finalize:70",
    "initialize",
    "finalize:70",
  ]);
});
