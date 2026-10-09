import { analyzeCoverage, type CandleFixture } from '../../src/index.js';

export function syntheticFixture(closes = [10, 9, 8, 10, 11, 9]): CandleFixture {
  const start = Date.parse('2026-10-01T10:00:00Z');
  const step = 300000;
  const bars = closes.map((close, index) => ({
    time: start + index * step,
    open: close,
    high: close,
    low: close,
    close,
    markOpen: 20,
    markHigh: 20,
    markLow: 20,
    markClose: 20,
    isFinal: true,
    externalSource: 'synthetic_test',
  }));
  const window = {
    symbol: 'SOL',
    timeframe: '5m',
    requestedFromMs: start,
    requestedToMs: start + closes.length * step,
  };

  return {
    meta: {
      ...window,
      schemaVersion: 1,
      source: 'phoenix_rise_http',
      method: 'candles.getCandlesV2',
      sdkPackage: '@ellipsis-labs/rise',
      sdkVersion: 'synthetic-test-only',
      apiUrl: 'https://synthetic.invalid',
      timeframeMs: step,
      timeUnit: 'ms',
      fetchedAtMs: window.requestedToMs,
      evaluationCutoffMs: window.requestedToMs,
      barCount: bars.length,
      pageCount: 1,
      integrity: {
        outOfOrder: 0,
        duplicatesRemoved: 0,
        excludedNonFinal: 0,
        excludedAfterCutoff: 0,
        coverage: analyzeCoverage(bars, window),
      },
    },
    bars,
  };
}
