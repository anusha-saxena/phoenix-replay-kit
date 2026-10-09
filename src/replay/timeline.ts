import { createHash } from 'node:crypto';
import { validateCandleFixture } from '../data/candle-loader.js';
import type { CandleFixture } from '../data/types.js';
import { freezeDeep, type CandleClosedEvent } from './events.js';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const entries: string[] = [];

    for (const key of Object.keys(object).sort()) {
      entries.push(`${JSON.stringify(key)}:${stableJson(object[key])}`);
    }

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

export function datasetIdentity(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function createCandleReplayEvents(input: CandleFixture): readonly CandleClosedEvent[] {
  const fixture = validateCandleFixture(input);
  const datasetId = datasetIdentity(fixture);
  const provenance = freezeDeep(structuredClone({ datasetId, meta: fixture.meta }));
  const events: CandleClosedEvent[] = fixture.bars.map((candle, index) => {
    const closeMs = candle.time + fixture.meta.timeframeMs;

    return {
      kind: 'candle_closed',
      schemaVersion: 1,
      id: `candle_closed:${fixture.meta.symbol}:${fixture.meta.timeframe}:${candle.time}`,
      symbol: fixture.meta.symbol,
      eventTimeMs: closeMs,
      availableAtMs: closeMs,
      candleCloseMs: closeMs,
      sequence: index,
      sourceSequence: index,
      candle: { ...candle },
      provenance,
    };
  });

  return freezeDeep(events);
}
