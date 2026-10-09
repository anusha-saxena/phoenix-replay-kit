// types export
export type {
  Candle,
  CandleWindow,
  Coverage,
  CandleIntegrity,
  CandleFixture,
} from './data/types.js';

// candle validation and loader stuff
export { loadCandleFixture, validateCandleFixture } from './data/candle-loader.js';
export {
  parseTimeframe,
  validateWindow,
  validateCandle,
  analyzeCoverage,
  normalizeCandles,
} from './data/candle-validation.js';

// events and replays
export type { DeepReadonly, CandleClosedEvent, ReplayEvent } from './replay/events.js';
export { EVENT_PRIORITY, compareReplayEvents } from './replay/events.js';
export { createCandleReplayEvents } from './replay/timeline.js';

export type { ReplayDecision, ReplayResult } from './replay/runner.js';
export { runReplay } from './replay/runner.js';

// strategy types
export type {
  Signal,
  DiagnosticValue,
  StrategyDecision,
  StrategyContext,
  Strategy,
  StrategyFactory,
} from './strategy/types.js';

export type { RsiCrossOptions } from './strategy/rsi-cross.js';
export { createRsiCrossStrategy, crossingSignal } from './strategy/rsi-cross.js';
export { WilderRsi } from './indicators/rsi.js';

// comparison utils
export type { DecisionDiff, ComparisonResult } from './compare/types.js';
export { compareStrategies, compareReplayResults } from './compare/compare-replays.js';

// funding data
export type { FundingRecord, FundingObservation, FundingFixture } from './data/funding.js';
export {
  parseFundingRate,
  createFundingFixture,
  validateFundingFixture,
  loadFundingFixture
} from './data/funding.js';

// orderbook stuff
export type { BookLevel, BookSnapshot, OrderbookFixture } from './data/orderbook.js';
export {
  parseBookLevels,
  validateBookSnapshot,
  createOrderbookFixture,
  validateOrderbookFixture,
  loadOrderbookFixture
} from './data/orderbook.js';

export type { CandleProvenance, BookProvenance, ReplayProvenance, FundingRateEvent, OrderbookSnapshotEvent } from './replay/events.js';
export { createFundingReplayEvents, createOrderbookReplayEvents } from './replay/multi-source.js';

// extra strategies
export type { RsiFundingOptions } from './strategy/rsi-funding.js';
export { createRsiFundingStrategy } from './strategy/rsi-funding.js';
export { orderbookImbalance } from './indicators/imbalance.js';
export { createBookImbalanceStrategy } from './strategy/book-imbalance.js';
export { Ema } from './indicators/ema.js';
export { createEmaCrossStrategy, type EmaCrossOptions } from './strategy/ema-cross.js';
export { createBreakoutStrategy, type BreakoutOptions } from './strategy/breakout.js';
export {
  createDeclarativeStrategy,
  parseDeclarativeSpec,
  type DeclarativeSpec,
  type Operand,
  type Condition
} from './strategy/declarative.js';

export {
  listStrategies,
  parseStrategySelection,
  strategyFactory,
  type StrategySelection
} from './strategy/registry.js';

// workspace & snapshot exports
export {
  createSnapshot,
  validateSnapshot,
  snapshotSummary,
  LIMITS,
  type Snapshot
} from './workspace/snapshot.js';

export { runWorkspace, evaluateSnapshot, checkAssertions, ENGINE_VERSION } from './workspace/evaluate.js';

export {
  discoverCapabilities,
  SnapshotCollector,
  dataRequestSchema,
  type DataRequest,
  type DataSource
} from './workspace/phoenix-data.js';

export { datasetIdentity } from './replay/timeline.js';
export type { OrderIntent } from './strategy/types.js';
export type { MarketEventBase } from './replay/events.js';
