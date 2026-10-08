import type { CandlesV2Response, TradingCandlesV2Query } from '@ellipsis-labs/rise';
import { mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizeCandles, record, validateWindow } from '../src/data/candle-validation.js';
import { validateCandleFixture } from '../src/data/candle-loader.js';
import type { CandleFixture, CandleWindow } from '../src/data/types.js';

export type CandleFetcher = (
  symbol: string,
  query: TradingCandlesV2Query,
) => Promise<CandlesV2Response>;

export const API_URL = 'https://perp-api.phoenix.trade';

export async function collectCandles(
  fetchPage: CandleFetcher,
  window: CandleWindow,
  sdkVersion: string,
  now = Date.now(),
  maxPages = 100,
): Promise<CandleFixture> {
  const timeframeMs = validateWindow(window);

  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    throw new Error('maxPages must be positive');
  }

  const values: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pageCount = 0;

  while (true) {
    if (pageCount >= maxPages) {
      throw new Error(`Pagination exceeded ${maxPages} pages`);
    }

    let query: TradingCandlesV2Query;
    if (cursor) {
      query = { cursor };
    } else {
      query = {
        timeframe: window.timeframe,
        from: window.requestedFromMs,
        to: window.requestedToMs,
        limit: 1000,
        includePartial: false,
      };
    }
    const response = await fetchPage(window.symbol, query);
    pageCount++;

    const raw = record(response, 'API response');
    if (
      raw.symbol !== window.symbol ||
      raw.timeframe !== window.timeframe ||
      raw.from !== window.requestedFromMs ||
      raw.to !== window.requestedToMs
    ) {
      throw new Error('API response symbol/timeframe/window mismatch; timeframe acceptance is server-dependent');
    }
    if (!Array.isArray(raw.bars)) {
      throw new Error('API bars must be an array');
    }

    const page = record(raw.page, 'API page');
    if (
      typeof page.hasMore !== 'boolean' ||
      (page.nextCursor !== undefined && typeof page.nextCursor !== 'string')
    ) {
      throw new Error('Malformed API pagination schema');
    }

    values.push(...raw.bars);
    if (!page.hasMore) {
      break;
    }
    if (typeof page.nextCursor !== 'string' || !page.nextCursor.trim()) {
      throw new Error('API hasMore=true but nextCursor is missing');
    }
    if (seenCursors.has(page.nextCursor)) {
      throw new Error('Repeated or cyclic pagination cursor');
    }

    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  const evaluationCutoffMs = Math.min(now, window.requestedToMs);
  const { bars, integrity } = normalizeCandles(values, window, evaluationCutoffMs);
  if (!bars.length) {
    throw new Error('No finalized, fully closed candles returned');
  }

  return validateCandleFixture({
    meta: {
      ...window,
      schemaVersion: 1,
      source: 'phoenix_rise_http',
      method: 'candles.getCandlesV2',
      sdkPackage: '@ellipsis-labs/rise',
      sdkVersion,
      apiUrl: API_URL,
      timeframeMs,
      timeUnit: 'ms',
      fetchedAtMs: now,
      evaluationCutoffMs,
      barCount: bars.length,
      pageCount,
      integrity,
    },
    bars,
  });
}

export async function saveCandleFixture(
  path: string,
  fixture: CandleFixture,
  force = false,
): Promise<void> {
  const content = JSON.stringify(validateCandleFixture(fixture), null, 2) + '\n';
  await mkdir(dirname(path), { recursive: true });

  if (!force) {
    await writeFile(path, content, { flag: 'wx' });
    return;
  }

  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { flag: 'wx' });
    await rename(temp, path);
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
