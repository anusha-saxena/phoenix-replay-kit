import { isDeepStrictEqual } from 'node:util';
import { runReplay, type ReplayDecision, type ReplayResult } from '../replay/runner.js';
import type { DeepReadonly, ReplayEvent } from '../replay/events.js';
import type { StrategyFactory } from '../strategy/types.js';
import type { ComparisonResult, DecisionDiff } from './types.js';

function decisionMap(decisions: readonly DeepReadonly<ReplayDecision>[]) {
  const map = new Map<string, DeepReadonly<ReplayDecision>>();

  for (const decision of decisions) {
    if (map.has(decision.eventId)) {
      throw new Error(`Duplicate decision: ${decision.eventId}`);
    }
    map.set(decision.eventId, decision);
  }

  return map;
}

export function compareReplayResults(
  baseline: DeepReadonly<ReplayResult>,
  candidate: DeepReadonly<ReplayResult>,
): ComparisonResult {
  if (
    baseline.symbol !== candidate.symbol ||
    baseline.totalEvents !== candidate.totalEvents ||
    !isDeepStrictEqual(baseline.provenance, candidate.provenance)
  ) {
    throw new Error('Cannot compare replays from different datasets or input timelines');
  }

  const before = decisionMap(baseline.decisions);
  const after = decisionMap(candidate.decisions);
  const keys = new Set([...before.keys(), ...after.keys()]);
  const diffs: DecisionDiff[] = [];
  const categories: Record<string, number> = {};
  let comparableDecisions = 0;
  let unchangedDecisions = 0;
  let signalChanges = 0;
  let missingBaseline = 0;
  let missingCandidate = 0;

  for (const eventId of keys) {
    const left = before.get(eventId) ?? null;
    const right = after.get(eventId) ?? null;
    const decision = left ?? right!;
    let change: DecisionDiff['change'];

    if (left && right) {
      if (
        left.sequence !== right.sequence ||
        left.symbol !== right.symbol ||
        left.availableAtMs !== right.availableAtMs ||
        left.eventTimeMs !== right.eventTimeMs ||
        left.candleStartMs !== right.candleStartMs || left.eventKind !== right.eventKind
      ) {
        throw new Error(`Decision event identity/timestamp mismatch: ${eventId}`);
      }
      comparableDecisions++;
      if (left.signal === right.signal) {
        unchangedDecisions++;
        continue;
      }
      signalChanges++;
      change = 'signal_changed';
    } else if (!left) {
      missingBaseline++;
      change = 'missing_baseline';
    } else {
      missingCandidate++;
      change = 'missing_candidate';
    }

    const category = `${left?.signal ?? 'NO_DECISION'} -> ${right?.signal ?? 'NO_DECISION'}`;
    categories[category] = (categories[category] ?? 0) + 1;
    diffs.push({
      eventId,
      symbol: decision.symbol,
      sequence: decision.sequence,
      timestampMs: decision.availableAtMs,
      timestampUtc: new Date(decision.availableAtMs).toISOString(),
      baseline: left,
      candidate: right,
      change,
      signalChanged: change === 'signal_changed',
    });
  }
  diffs.sort(
    (a, b) =>
      a.timestampMs - b.timestampMs ||
      a.sequence - b.sequence ||
      (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0),
  );
  const summary = (result: DeepReadonly<ReplayResult>) => ({
    name: result.strategyName,
    configuration: { ...result.configuration },
    decisionCount: result.totalDecisions,
    counts: { ...result.counts },
  });

  return {
    schemaVersion: 1,
    dataset: baseline.provenance,
    symbol: baseline.symbol,
    inputEvents: baseline.totalEvents,
    eventCounts: { ...baseline.eventCounts },
    baseline: summary(baseline),
    candidate: summary(candidate),
    comparableDecisions,
    unchangedDecisions,
    changedDecisions: diffs.length,
    signalChanges,
    missingBaseline,
    missingCandidate,
    categories,
    diffs,
    warnings: [...new Set([...baseline.warnings, ...candidate.warnings])],
  };
}

export function compareStrategies({
  events,
  baseline,
  candidate,
}: {
  events: readonly ReplayEvent[];
  baseline: StrategyFactory;
  candidate: StrategyFactory;
}): ComparisonResult {
  const before = runReplay({ events, strategy: baseline });
  const after = runReplay({ events, strategy: candidate });

  return compareReplayResults(before, after);
}
