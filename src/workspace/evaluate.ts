import { z } from "zod";
import { validateCandleFixture } from "../data/candle-loader.js";
import {
  createCandleReplayEvents,
  datasetIdentity,
} from "../replay/timeline.js";
import { runReplay, type ReplayResult } from "../replay/runner.js";
import { compareReplayResults } from "../compare/compare-replays.js";
import { freezeDeep } from "../replay/events.js";
import {
  strategyFactory,
  parseStrategySelection,
} from "../strategy/registry.js";
import { validateSnapshot, snapshotSummary } from "./snapshot.js";
import type { StrategyFactory } from "../strategy/types.js";
import type { ComparisonResult } from "../compare/types.js";

// assertion thresholds schema
export const assertionSchema = z
  .object({
    maxChangedDecisions: z.number().int().min(0).optional(),
    maxChangedPercent: z.number().min(0).max(100).optional(),
    maxChangedBuy: z.number().int().min(0).optional(),
    maxChangedSell: z.number().int().min(0).optional(),
    exactEquivalence: z.boolean().optional(),
  })
  .strict();

// checks if comparison metrics pass assertion tests
export function checkAssertions(report: ComparisonResult, input: unknown = {}) {
  const limits = assertionSchema.parse(input);

  const unionCount =
    report.comparableDecisions +
    report.missingBaseline +
    report.missingCandidate;

  let changedPct = 0;
  if (unionCount) {
    changedPct = (report.changedDecisions * 100) / unionCount;
  }

  // count changes for buy and sell
  let buyChanges = 0;
  let sellChanges = 0;
  for (let i = 0; i < report.diffs.length; i++) {
    const d = report.diffs[i]!;
    if (d.baseline?.signal === "BUY" || d.candidate?.signal === "BUY") {
      buyChanges++;
    }
    if (d.baseline?.signal === "SELL" || d.candidate?.signal === "SELL") {
      sellChanges++;
    }
  }

  const metrics = {
    changedDecisions: report.changedDecisions,
    changedPercent: changedPct,
    changedBuy: buyChanges,
    changedSell: sellChanges,
  };

  const failures: string[] = [];

  if (
    limits.maxChangedDecisions !== undefined &&
    metrics.changedDecisions > limits.maxChangedDecisions
  ) {
    failures.push("maxChangedDecisions");
  }

  if (
    limits.maxChangedPercent !== undefined &&
    metrics.changedPercent > limits.maxChangedPercent
  ) {
    failures.push("maxChangedPercent");
  }

  if (
    limits.maxChangedBuy !== undefined &&
    metrics.changedBuy > limits.maxChangedBuy
  ) {
    failures.push("maxChangedBuy");
  }

  if (
    limits.maxChangedSell !== undefined &&
    metrics.changedSell > limits.maxChangedSell
  ) {
    failures.push("maxChangedSell");
  }

  if (limits.exactEquivalence && metrics.changedDecisions !== 0) {
    failures.push("exactEquivalence");
  }

  let passed = false;
  if (!failures.length) {
    passed = true;
  }

  return {
    limits: limits,
    metrics: metrics,
    passed: passed,
    failures: failures,
  };
}

export const workspaceRequestSchema = z
  .object({
    snapshot: z.unknown(),
    baseline: z.unknown(),
    candidate: z.unknown().optional(),
    assertions: assertionSchema.optional(),
  })
  .strict();

export const ENGINE_VERSION = "1.1.0";

// evaluates snapshot across one or two strategy instances
export function evaluateSnapshot(
  snapshotInput: unknown,
  factories: readonly StrategyFactory[],
) {
  const snapshot = validateSnapshot(snapshotInput);

  if (factories.length < 1 || factories.length > 2) {
    throw new Error("Provide one or two strategies");
  }

  const validCandles = validateCandleFixture(snapshot.fixture);
  const events = createCandleReplayEvents(validCandles);
  const instances = factories.map((factory) => factory());

  // calculate required warmup bars
  const warmupList: number[] = [];
  for (let i = 0; i < instances.length; i++) {
    const bars = instances[i]!.warmupBars ?? 0;
    warmupList.push(bars);
  }
  const warmupBars = Math.max(...warmupList);

  if (!Number.isInteger(warmupBars) || warmupBars < 0 || warmupBars > 201) {
    throw new Error("warmupBars must be 0..201");
  }

  // filter only eligible events after warmup
  const eligible = events.filter((event, index) => {
    const afterWarmup = index >= warmupBars;
    const afterStart = event.candle.time >= snapshot.evaluationFromMs;
    const beforeEnd = event.candleCloseMs <= snapshot.evaluationToMs;
    return afterWarmup && afterStart && beforeEnd;
  });

  if (!eligible.length) {
    throw new Error("No common evaluation candles after strategy warm-up");
  }

  const ids = new Set(eligible.map((e) => e.id));
  const readyFromMs = eligible[0]!.candle.time;
  const warnings: string[] = [];

  const roundedEvalStart =
    Math.ceil(snapshot.evaluationFromMs / snapshot.fixture.meta.timeframeMs) *
    snapshot.fixture.meta.timeframeMs;

  if (readyFromMs > roundedEvalStart) {
    warnings.push(
      "Insufficient preceding history: the common evaluation window starts later than requested.",
    );
  }

  const covSummary = snapshotSummary(snapshot);
  if (!covSummary.coverage.complete) {
    warnings.push(
      "Requested evaluation coverage is incomplete; only recorded finalized candles are evaluated.",
    );
  }

  const results = factories.map((factory) => {
    const rawResult = runReplay({ events: events, strategy: factory });
    const result = structuredClone(rawResult) as ReplayResult;

    // keep decisions that belong to the eligible window
    result.decisions = result.decisions.filter((decision) => {
      return ids.has(decision.eventId);
    });

    result.totalEvents = eligible.length;
    result.eventCounts.candle_closed = eligible.length;
    result.totalDecisions = result.decisions.length;
    result.counts = { BUY: 0, SELL: 0, HOLD: 0 };

    for (let i = 0; i < result.decisions.length; i++) {
      const decision = result.decisions[i]!;
      result.counts[decision.signal]++;
    }

    result.warnings.push(...warnings);
    return freezeDeep(result);
  });

  const identities = instances.map(strategyIdentity);

  // count warm up events
  const warmupEventsCount = events.filter((e) => {
    return e.candle.time < readyFromMs;
  }).length;

  return {
    snapshot: snapshot,
    identities: identities,
    results: results,
    evaluation: {
      requestedFromMs: snapshot.evaluationFromMs,
      requestedToMs: snapshot.evaluationToMs,
      actualFromMs: readyFromMs,
      actualToMs: eligible.at(-1)!.candleCloseMs,
      warmupBars: warmupBars,
      warmupEvents: warmupEventsCount,
      evaluationEvents: eligible.length,
      policy:
        "Recorded bars; common warm-up; no gap filling; no trade execution or fill simulation",
    },
  };
}

// metadata extraction helper
export function strategyIdentity(instance: ReturnType<StrategyFactory>) {
  const configuration = { ...instance.configuration };

  let stratId = instance.id;
  if (!stratId) {
    stratId = "trusted-local";
  }

  let stratVersion = instance.version;
  if (!stratVersion) {
    stratVersion = "unversioned";
  }

  return {
    id: stratId,
    version: stratVersion,
    name: instance.name,
    sourceHash: instance.sourceHash ?? null,
    configuration: configuration,
    configId: datasetIdentity(configuration),
    requiredInputs: instance.requiredInputs ?? [],
    warmupBars: instance.warmupBars ?? 0,
  };
}

export function runWorkspace(input: unknown) {
  const request = workspaceRequestSchema.parse(input);
  const baseline = parseStrategySelection(request.baseline);

  let candidate = undefined;
  if (request.candidate !== undefined) {
    candidate = parseStrategySelection(request.candidate);
  }

  if (!candidate && request.assertions !== undefined) {
    throw new Error("Assertions require a comparison");
  }

  // list of strategy factories
  const strategyList = [strategyFactory(baseline)];
  if (candidate) {
    strategyList.push(strategyFactory(candidate));
  }

  const evaluated = evaluateSnapshot(request.snapshot, strategyList);

  let report;
  if (candidate) {
    report = compareReplayResults(evaluated.results[0]!, evaluated.results[1]!);
  } else {
    report = evaluated.results[0]!;
  }

  let assertion = null;
  if (candidate) {
    assertion = checkAssertions(report as ComparisonResult, request.assertions);
  }

  const manifest = {
    schemaVersion: 1,
    snapshot: evaluated.snapshot,
    baseline: baseline,
    ...(candidate ? { candidate: candidate } : {}),
    ...(request.assertions ? { assertions: request.assertions } : {}),
  };

  const content = {
    schemaVersion: 1,
    engineVersion: ENGINE_VERSION,
    snapshot: snapshotSummary(evaluated.snapshot),
    strategies: evaluated.identities,
    evaluation: evaluated.evaluation,
    report: report,
    assertion: assertion,
    traces: evaluated.results.map((r) => r.decisions),
  };

  const finalReportId = datasetIdentity(content);

  return freezeDeep({
    ...content,
    reportId: finalReportId,
    manifest: manifest,
  });
}