import type { DeepReadonly } from '../replay/events.js';
import type { ReplayDecision, ReplayResult } from '../replay/runner.js';
import type { Signal } from '../strategy/types.js';

export interface DecisionDiff {
  eventId: string;
  symbol: string;
  sequence: number;
  timestampMs: number;
  timestampUtc: string;
  baseline: DeepReadonly<ReplayDecision> | null;
  candidate: DeepReadonly<ReplayDecision> | null;
  change: 'signal_changed' | 'missing_baseline' | 'missing_candidate';
  signalChanged: boolean;
}

export interface ComparisonResult {
  schemaVersion: 1;
  dataset: ReplayResult['provenance'];
  symbol: string | null;
  inputEvents: number;
  eventCounts: ReplayResult['eventCounts'];
  baseline: {
    name: string;
    configuration: ReplayResult['configuration'];
    decisionCount: number;
    counts: Record<Signal, number>;
  };
  candidate: ComparisonResult['baseline'];
  comparableDecisions: number;
  unchangedDecisions: number;
  changedDecisions: number;
  signalChanges: number;
  missingBaseline: number;
  missingCandidate: number;
  categories: Record<string, number>;
  diffs: DecisionDiff[];
  warnings: string[];
}
