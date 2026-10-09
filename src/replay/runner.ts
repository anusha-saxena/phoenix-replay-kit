import { prepareEvents } from './validate-timeline.js';
import { freezeDeep, type DeepReadonly, type ReplayEvent } from './events.js';
import type {
  DiagnosticValue,
  Signal,
  StrategyDecision,
  StrategyFactory,
} from '../strategy/types.js';

// interface for decisions in replay
export interface ReplayDecision extends StrategyDecision {
  eventId: string;
  sequence: number;
  symbol: string;
  eventTimeMs: number;
  availableAtMs: number;
  eventKind: ReplayEvent['kind'];
  candleStartMs: number | null;
}

// container for the final results
export interface ReplayResult {
  strategyName: string;
  configuration: Record<string, DiagnosticValue>;
  provenance: ReplayEvent['provenance'] | null;
  symbol: string | null;
  totalEvents: number;
  eventCounts: Record<ReplayEvent['kind'], number>;
  totalDecisions: number;
  counts: Record<Signal, number>;
  warnings: string[];
  decisions: ReplayDecision[];
}

export function runReplay(params: {
  events: readonly ReplayEvent[];
  strategy: StrategyFactory;
}): DeepReadonly<ReplayResult> {
  // get inputs out of params
  const events = params.events;
  const strategy = params.strategy;

  const timeline = prepareEvents(events);
  const instance = strategy();

  // grab event types to make sure strategy can run
  const kinds = new Set(timeline.map(event => event.kind));
  const required = instance.requiredInputs ?? [];
  for (let i = 0; i < required.length; i++) {
    const kind = required[i]!;
    if (timeline.length && !kinds.has(kind)) {
      throw new Error(`Strategy requires ${kind} input`);
    }
  }

  if (instance.initialize) {
    instance.initialize();
  }

  const configuration = { ...instance.configuration };

  // set up default stats
  const result: ReplayResult = {
    strategyName: instance.name,
    configuration: configuration,
    provenance: timeline[0]?.provenance ?? null,
    symbol: timeline[0]?.symbol ?? null,
    totalEvents: timeline.length,
    eventCounts: {
      candle_closed: 0,
      funding_rate: 0,
      orderbook_snapshot: 0,
    },
    totalDecisions: 0,
    counts: {
      BUY: 0,
      SELL: 0,
      HOLD: 0,
    },
    warnings: [],
    decisions: [],
  };

  // check coverage warnings
  const coverage = result.provenance?.meta.integrity.coverage;
  if (coverage && !coverage.complete) {
    result.warnings.push(
      `Incomplete coverage: ${coverage.leadingMissingBars} leading, ${coverage.internalMissingBars} internal, ${coverage.trailingMissingBars} trailing buckets missing. Replaying only recorded candles.`,
    );
  }

  const provenance = timeline[0]?.provenance;
  if (provenance && 'funding' in provenance && provenance.funding) {
    result.warnings.push(
      `Assumption-based funding replay: timestamp + ${provenance.funding.availability.lagMs}ms lag; units interpreted as percentage points from field name; publication times and historical coverage are unknown.`,
    );
  }

  if (provenance?.meta.source === 'phoenix_rise_http_sampled') {
    result.warnings.push(
      'Locally sampled HTTP order books; receipt time is not exchange event time. Intermediate updates are not reconstructed.',
    );
  }

  // main replay loop
  for (let i = 0; i < timeline.length; i++) {
    const event = timeline[i]!;
    result.eventCounts[event.kind]++;

    const context = Object.freeze({
      symbol: event.symbol,
      availableAtMs: event.availableAtMs,
      sequence: event.sequence,
    });

    const decision = instance.onEvent(event, context);

    if (decision === null) {
      continue;
    }

    if (!decision || !['BUY', 'SELL', 'HOLD'].includes(decision.signal)) {
      throw new Error('Strategy must return BUY, SELL, HOLD or null synchronously');
    }

    let candleStartMs: number | null = null;
    if (event.kind === 'candle_closed') {
      candleStartMs = event.candle.time;
    }

    result.decisions.push({
      ...structuredClone(decision),
      eventId: event.id,
      sequence: event.sequence,
      symbol: event.symbol,
      eventTimeMs: event.eventTimeMs,
      availableAtMs: event.availableAtMs,
      eventKind: event.kind,
      candleStartMs: candleStartMs,
    });

    result.counts[decision.signal]++;
  }

  if (instance.finalize) {
    instance.finalize();
  }

  result.totalDecisions = result.decisions.length;

  return freezeDeep(result);
}