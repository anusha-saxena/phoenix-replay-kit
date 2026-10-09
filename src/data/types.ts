import type { ApiCandleV2 } from '@ellipsis-labs/rise';

export type Candle = ApiCandleV2;

export interface CandleWindow {
  symbol: string;
  timeframe: string;
  requestedFromMs: number;
  requestedToMs: number;
}

export interface Coverage {
  expectedFirstStartMs: number;
  expectedEndExclusiveMs: number;
  expectedBars: number;
  leadingMissingBars: number;
  trailingMissingBars: number;
  internalGaps: {
    afterMs: number;
    beforeMs: number;
    missingBars: number;
  }[];
  internalMissingBars: number;
  missingBars: number;
  complete: boolean;
}

export interface CandleIntegrity {
  outOfOrder: number;
  duplicatesRemoved: number;
  excludedNonFinal: number;
  excludedAfterCutoff: number;
  coverage: Coverage;
}

export interface CandleFixture {
  meta: CandleWindow & {
    schemaVersion: 1;
    source: 'phoenix_rise_http';
    method: 'candles.getCandlesV2';
    sdkPackage: '@ellipsis-labs/rise';
    sdkVersion: string;
    apiUrl: string;
    timeframeMs: number;
    timeUnit: 'ms';
    fetchedAtMs: number;
    evaluationCutoffMs: number;
    barCount: number;
    pageCount: number;
    integrity: CandleIntegrity;
    legacyOriginalMeta?: Record<string, unknown>;
  };
  bars: Candle[];
}
