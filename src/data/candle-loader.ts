import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import type { CandleFixture, CandleWindow } from './types.js';
import {
  analyzeCoverage,
  integer,
  record,
  validateCandle,
  validateWindow,
} from './candle-validation.js';

export function validateCandleFixture(value: unknown): CandleFixture {
  const root = record(value, 'fixture');
  const meta = record(root.meta, 'meta');
  const legacy = !Object.hasOwn(meta, 'schemaVersion');

  if (!legacy && meta.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion ${String(meta.schemaVersion)}`);
  }
  if (
    meta.source !== 'phoenix_rise_http' ||
    meta.method !== 'candles.getCandlesV2' ||
    meta.timeUnit !== 'ms'
  ) {
    throw new Error('Unsupported source, method or timeUnit');
  }
  if (typeof meta.symbol !== 'string' || typeof meta.timeframe !== 'string') {
    throw new Error('meta.symbol/timeframe must be strings');
  }

  const window: CandleWindow = {
    symbol: meta.symbol,
    timeframe: meta.timeframe,
    requestedFromMs: integer(meta.requestedFromMs, 'requestedFromMs'),
    requestedToMs: integer(meta.requestedToMs, 'requestedToMs'),
  };
  const step = validateWindow(window);

  if (meta.timeframeMs !== step) {
    throw new Error('timeframe/timeframeMs mismatch');
  }

  const fetchedAtMs = integer(meta.fetchedAtMs, 'fetchedAtMs');
  const cutoff = legacy
    ? Math.min(fetchedAtMs, window.requestedToMs)
    : integer(meta.evaluationCutoffMs, 'evaluationCutoffMs');

  if (cutoff > Math.min(fetchedAtMs, window.requestedToMs)) {
    throw new Error('evaluationCutoffMs exceeds requested end or fetch time');
  }

  const pageCount = integer(meta.pageCount, 'pageCount', 1);

  if (!Array.isArray(root.bars) || !root.bars.length) {
    throw new Error('bars must be a nonempty array');
  }

  const bars = root.bars.map((bar, i) => validateCandle(bar, `bars[${i}]`, step));

  if (integer(meta.barCount, 'barCount') !== bars.length) {
    throw new Error('barCount mismatch');
  }

  const coverage = analyzeCoverage(bars, window, cutoff);
  const original = record(meta.integrity, 'meta.integrity');
  const integrity = {
    outOfOrder: integer(original.outOfOrder, 'integrity.outOfOrder'),
    duplicatesRemoved: legacy
      ? integer(original.duplicates, 'integrity.duplicates')
      : integer(original.duplicatesRemoved, 'integrity.duplicatesRemoved'),
    excludedNonFinal: integer(original.excludedNonFinal, 'integrity.excludedNonFinal'),
    excludedAfterCutoff: legacy
      ? 0
      : integer(original.excludedAfterCutoff, 'integrity.excludedAfterCutoff'),
    coverage,
  };

  if (!legacy && !isDeepStrictEqual(original.coverage, coverage)) {
    throw new Error('Stored integrity.coverage does not match bars/window');
  }
  if (
    legacy &&
    (original.gaps !== coverage.internalGaps.length ||
      original.estimatedMissingBars !== coverage.internalMissingBars)
  ) {
    throw new Error('Legacy internal gap metadata mismatch');
  }
  if (
    !legacy &&
    (meta.sdkPackage !== '@ellipsis-labs/rise' ||
      typeof meta.sdkVersion !== 'string' ||
      !meta.sdkVersion ||
      typeof meta.apiUrl !== 'string' ||
      !/^https?:\/\//.test(meta.apiUrl))
  ) {
    throw new Error('Invalid SDK/API provenance');
  }

  let legacyOriginalMeta: Record<string, unknown> | undefined;

  if (legacy) {
    legacyOriginalMeta = meta;
  } else if (meta.legacyOriginalMeta !== undefined) {
    legacyOriginalMeta = record(meta.legacyOriginalMeta, 'legacyOriginalMeta');
  }

  return {
    meta: {
      ...window,
      schemaVersion: 1,
      source: 'phoenix_rise_http',
      method: 'candles.getCandlesV2',
      sdkPackage: '@ellipsis-labs/rise',
      sdkVersion: legacy ? 'unknown (legacy)' : (meta.sdkVersion as string),
      apiUrl: legacy ? 'https://perp-api.phoenix.trade' : (meta.apiUrl as string),
      timeframeMs: step,
      timeUnit: 'ms',
      fetchedAtMs,
      evaluationCutoffMs: cutoff,
      barCount: bars.length,
      pageCount,
      integrity,
      ...(legacyOriginalMeta ? { legacyOriginalMeta } : {}),
    },
    bars,
  };
}
export async function loadCandleFixture(filePath: string): Promise<CandleFixture> {
  try {
    const content = await readFile(filePath, 'utf8');

    return validateCandleFixture(JSON.parse(content) as unknown);
  } catch (error) {
    throw new Error(
      `Cannot load candle fixture ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}
