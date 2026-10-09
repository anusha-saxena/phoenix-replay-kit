import { describe, expect, it } from "vitest";
import {
  createFundingFixture,
  validateFundingFixture,
  parseFundingRate,
  loadFundingFixture,
  createFundingReplayEvents,
  createRsiCrossStrategy,
  createRsiFundingStrategy,
  compareStrategies,
  runReplay,
  type FundingRateEvent,
} from "../../src/index.js";
import { syntheticFixture } from "../helpers/synthetic-fixture.js";

const start = Date.parse("2026-10-01T10:00:00Z");
const source = (
  rates = [{ timestamp: start / 1000, fundingRatePercentage: "0.004" }],
) => ({ marketId: 1, symbol: "SOL", rates });
const options = {
  period: 2,
  buyThreshold: 30,
  sellThreshold: 70,
  maxFundingRatePercentage: 0.003,
  missingFundingPolicy: "suppress" as const,
};
const baseline = createRsiCrossStrategy({ period: 2 });

describe("funding fixtures and modeled availability", () => {
  it("converts seconds to milliseconds and retains percentage strings without scaling", () => {
    const fixture = createFundingFixture(source(), 3600000);
    expect(fixture.records[0]).toMatchObject({
      eventTimeMs: start,
      availableAtMs: start + 3600000,
      rawFundingRatePercentage: "0.004",
      fundingRatePercentage: 0.004,
    });
    expect(fixture.meta).toMatchObject({
      fetchedAtMs: null,
      fetchedAtKnown: false,
      rateUnit: "percentage_points",
      unitBasis: "field_name_interpretation",
      availability: { assumed: true },
      coverage: { complete: null, requestedWindowKnown: false },
    });
    expect(validateFundingFixture(fixture)).toEqual(fixture);
  });

  it("accepts positive, negative and zero rates and rejects bad strings", () => {
    expect(parseFundingRate("0.003745")).toBe(0.003745);
    expect(parseFundingRate("-0.002553")).toBe(-0.002553);
    expect(parseFundingRate("0")).toBe(0);
    for (const value of [
      "",
      " ",
      "NaN",
      "Infinity",
      "1e3",
      "0.3%",
      "0x10",
      null,
    ])
      expect(() => parseFundingRate(value)).toThrow();
    expect(() => createFundingFixture(source(), -1)).toThrow();
    expect(() =>
      createFundingFixture(
        source([{ timestamp: 1.5, fundingRatePercentage: "0" }]),
        0,
      ),
    ).toThrow();
  });

  it("sorts, reports identical duplicates and rejects conflicts or edited fixtures", () => {
    const input = source([
      { timestamp: start / 1000 + 3600, fundingRatePercentage: "0" },
      { timestamp: start / 1000, fundingRatePercentage: "-0.002" },
      { timestamp: start / 1000, fundingRatePercentage: "-0.002" },
    ]);
    const fixture = createFundingFixture(input, 0);
    expect(fixture.meta.integrity).toEqual({
      outOfOrder: 1,
      duplicatesRemoved: 1,
    });
    expect(fixture.rawSource.rates).toHaveLength(3);
    expect(() =>
      createFundingFixture(
        source([
          { timestamp: 1, fundingRatePercentage: "0" },
          { timestamp: 1, fundingRatePercentage: "1" },
        ]),
        0,
      ),
    ).toThrow("Conflicting");
    expect(() =>
      validateFundingFixture({
        ...fixture,
        meta: { ...fixture.meta, rateUnit: "fraction" },
      }),
    ).toThrow();
  });

  it("applies deterministic same-time funding-before-candle ordering", () => {
    const funding = createFundingFixture(source(), 300000);
    const events = createFundingReplayEvents(syntheticFixture(), funding);
    expect(events.slice(0, 2).map((event) => event.kind)).toEqual([
      "funding_rate",
      "candle_closed",
    ]);
    const result = runReplay({
      events,
      strategy: createRsiFundingStrategy(options),
    });
    expect(result.decisions[0]!.diagnostics?.fundingAvailableAtMs).toBe(
      start + 300000,
    );
  });

  it("does not expose a future funding rate or backfill it into earlier candles", () => {
    const funding = createFundingFixture(source(), 1200000);
    const events = createFundingReplayEvents(syntheticFixture(), funding);
    const result = runReplay({
      events,
      strategy: createRsiFundingStrategy({
        ...options,
        missingFundingPolicy: "allow",
      }),
    });
    expect(
      result.decisions
        .slice(0, 3)
        .every(
          (decision) => decision.diagnostics?.fundingRatePercentage === null,
        ),
    ).toBe(true);
    expect(result.decisions[3]!.diagnostics?.fundingRatePercentage).toBe(0.004);
    const later = createFundingFixture(source(), 3600000);
    expect(
      createFundingReplayEvents(syntheticFixture(), later).some(
        (event) => event.kind === "funding_rate",
      ),
    ).toBe(false);
    const changed = events.map((event) =>
      event.kind === "funding_rate"
        ? { ...event, availableAtMs: event.eventTimeMs }
        : event,
    );
    expect(() => runReplay({ events: changed, strategy: baseline })).toThrow();
  });

  it("updates last-known funding only when the later observation becomes available", () => {
    const funding = createFundingFixture(
      source([
        { timestamp: start / 1000, fundingRatePercentage: "0.004" },
        { timestamp: start / 1000 + 600, fundingRatePercentage: "-0.001" },
      ]),
      300000,
    );
    const result = runReplay({
      events: createFundingReplayEvents(syntheticFixture(), funding),
      strategy: createRsiFundingStrategy(options),
    });
    expect(
      result.decisions.map(
        (decision) => decision.diagnostics?.fundingRatePercentage,
      ),
    ).toEqual([0.004, 0.004, -0.001, -0.001, -0.001, -0.001]);
  });

  it("explicitly allows or suppresses a crossing when funding is missing", () => {
    const future = createFundingFixture(source(), 3600000);
    const events = createFundingReplayEvents(syntheticFixture(), future);
    const allow = runReplay({
      events,
      strategy: createRsiFundingStrategy({
        ...options,
        missingFundingPolicy: "allow",
      }),
    });
    const suppress = runReplay({
      events,
      strategy: createRsiFundingStrategy(options),
    });
    expect(allow.counts.BUY).toBeGreaterThan(0);
    expect(suppress.counts.BUY).toBe(0);
    expect(
      suppress.decisions.some(
        (decision) =>
          decision.reason === "RSI BUY suppressed: funding unavailable",
      ),
    ).toBe(true);
  });

  it("suppresses BUY only, keeps SELL independent and has fresh repeatable state", () => {
    const events = createFundingReplayEvents(
      syntheticFixture(),
      createFundingFixture(source(), 0),
    );
    const comparison = compareStrategies({
      events,
      baseline,
      candidate: createRsiFundingStrategy(options),
    });
    expect(comparison.changedDecisions).toBeGreaterThan(0);
    expect(comparison.baseline.counts.SELL).toBeGreaterThan(0);
    expect(comparison.baseline.counts.SELL).toBe(
      comparison.candidate.counts.SELL,
    );
    const factory = createRsiFundingStrategy(options);
    expect(JSON.stringify(runReplay({ events, strategy: factory }))).toBe(
      JSON.stringify(runReplay({ events, strategy: factory })),
    );
    expect(
      comparison.warnings.some((warning) =>
        warning.includes("Assumption-based funding"),
      ),
    ).toBe(true);
    expect(comparison.diffs[0]!.candidate!.diagnostics).toMatchObject({
      buyCrossing: true,
      buySuppressed: true,
      fundingRatePercentage: 0.004,
      maxFundingRatePercentage: 0.003,
      fundingRateUnit: "percentage_points",
    });
  });

  it("loads the real offline feed with unknown coverage", async () => {
    const fixture = await loadFundingFixture(
      "data/fixtures/funding/sol-funding-assumed-1h.json",
    );
    expect(fixture.records).toHaveLength(168);
    expect(fixture.records[0]!.eventTimeMs).toBe(1790870400000);
    expect(fixture.meta.coverage.complete).toBe(null);
  });
});
