import { beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeCoverage,
  createCandleReplayEvents,
  runReplay,
  createRsiCrossStrategy,
  loadCandleFixture,
  compareReplayEvents,
  WilderRsi,
  type Candle,
  type CandleFixture,
  type StrategyFactory,
  type ReplayEvent,
} from '../../src/index.js';
import baseline from '../../strategies/rsi-v1.js';
import candidate from '../../strategies/rsi-v2.js';

const step = 300000;

const start = Date.parse('2026-10-01T10:00:00Z');

function synthetic(closes = [10, 9, 8, 10, 11, 9]): CandleFixture {
  const bars: Candle[] = closes.map((close, i) => ({
    time: start + i * step,
    open: close,
    high: close,
    low: close,
    close,
    markOpen: 20,
    markHigh: 20,
    markLow: 20,
    markClose: 20,
    isFinal: true,
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
      sdkVersion: 'synthetic',
      apiUrl: 'https://example.test',
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

const events = () => createCandleReplayEvents(synthetic());

const strategy = createRsiCrossStrategy({ period: 2 });
describe('timeline and replay', () => {
  it('exposes a 10:00 candle at 10:05 with stable zero-based sequence', () => {
    const timeline = events();
    expect(timeline[0]).toMatchObject({
      eventTimeMs: start + step,
      availableAtMs: start + step,
      candleCloseMs: start + step,
      sequence: 0,
      candle: { time: start },
    });
    expect(timeline.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(timeline.map((event) => event.availableAtMs)).toEqual(
      [1, 2, 3, 4, 5, 6].map((i) => start + i * step),
    );
    expect(timeline).toEqual(events());
  });

  it('preserves prices/provenance without mutating or freezing the original fixture', () => {
    const fixture = synthetic();
    const before = JSON.stringify(fixture);
    const timeline = createCandleReplayEvents(fixture);
    expect(JSON.stringify(fixture)).toBe(before);
    expect(Object.isFrozen(fixture.bars[0])).toBe(false);
    expect(timeline[0]!.provenance.meta).toEqual(fixture.meta);
    expect(timeline[0]!.candle).toEqual(fixture.bars[0]);
    fixture.bars[0]!.close = 999;
    expect(timeline[0]!.candle.close).toBe(10);
  });

  it('gives property-order-independent dataset identities', () => {
    const fixture = synthetic();
    const reversed = Object.fromEntries(Object.entries(fixture.meta).reverse());
    const other = { ...fixture, meta: reversed } as CandleFixture;
    expect(createCandleReplayEvents(other)[0]!.provenance.datasetId).toBe(
      events()[0]!.provenance.datasetId,
    );
  });

  it('uses explicit source priority, symbol, source sequence and identity for equal times', () => {
    const event = events()[0]!;
    const a = {
      ...event,
      symbol: 'AAA',
      sourceSequence: 3,
      id: 'a',
    };
    const b = {
      ...event,
      symbol: 'ZZZ',
      sourceSequence: 0,
      id: 'b',
    };
    expect(compareReplayEvents(a, b)).toBeLessThan(0);
    expect(compareReplayEvents({ ...a, sourceSequence: 2 }, a)).toBeLessThan(0);
    expect(compareReplayEvents({ ...a, id: 'b' }, a)).toBeGreaterThan(0);
    expect(compareReplayEvents({ ...a, availableAtMs: a.availableAtMs + 1 }, b)).toBeGreaterThan(0);
  });

  it('rejects non-final, duplicate, unordered and malformed fixture bars', () => {
    for (const change of ['nonfinal', 'duplicate', 'unordered', 'price']) {
      const fixture = synthetic();

      if (change === 'nonfinal') {
        fixture.bars[0]!.isFinal = false;
      }
      if (change === 'duplicate') {
        fixture.bars[1]!.time = fixture.bars[0]!.time;
      }
      if (change === 'unordered') {
        fixture.bars.reverse();
      }
      if (change === 'price') {
        fixture.bars[0]!.close = NaN;
      }
      expect(() => createCandleReplayEvents(fixture)).toThrow();
    }
  });

  it('rejects early availability and altered event identities before strategy execution', () => {
    const timeline = structuredClone(events());

    for (const patch of [
      { availableAtMs: start },
      { id: 'wrong' },
      { sequence: 9 },
      { eventTimeMs: start },
      { candleCloseMs: start },
    ]) {
      let called = false;
      const factory: StrategyFactory = () => {
        called = true;

        return { name: 'unused', onEvent: () => null };
      };
      expect(() =>
        runReplay({
          events: [{ ...timeline[0]!, ...patch }, ...timeline.slice(1)],
          strategy: factory,
        }),
      ).toThrow('timeline');
      expect(called).toBe(false);
    }
    expect(() => runReplay({ events: [timeline[0]!, timeline[0]!], strategy })).toThrow();
  });

  it('returns byte-for-byte identical results with fresh state each run', () => {
    const timeline = events();
    const first = runReplay({ events: timeline, strategy });
    runReplay({ events: timeline, strategy: baseline });
    const second = runReplay({ events: timeline, strategy });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.decisions.slice(0, 2).map((decision) => decision.signal)).toEqual([
      'HOLD',
      'HOLD',
    ]);
    expect(first.decisions[2]!.diagnostics?.rsi).toBe(0);
    expect(first.decisions[2]!.signal).toBe('HOLD');
  });

  it('protects candles, metadata and context against a mutating strategy', () => {
    const timeline = events();
    const before = runReplay({ events: timeline, strategy });
    const mutate: StrategyFactory = () => ({
      name: 'mutation attempt',
      onEvent(event, context) {
        if (event.kind !== 'candle_closed') return null;
        expect(Object.isFrozen(event.candle)).toBe(true);
        expect(Object.isFrozen(event.provenance.meta.integrity.coverage)).toBe(true);
        expect(Object.keys(context)).toEqual(['symbol', 'availableAtMs', 'sequence']);
        expect(() => Object.assign(event.candle, { close: 999 })).toThrow();
        expect(() => Object.assign(event.provenance.meta, { barCount: 0 })).toThrow();
        expect(() => Object.assign(context, { availableAtMs: 0 })).toThrow();

        return { signal: 'HOLD' };
      },
    });
    runReplay({ events: timeline, strategy: mutate });
    expect(runReplay({ events: timeline, strategy })).toEqual(before);
  });

  it('allows null decisions and snapshots reused diagnostics', () => {
    const custom: StrategyFactory = () => {
      const diagnostics = { seen: 0 };

      return {
        name: 'custom',
        onEvent(event) {
        if (event.kind !== 'candle_closed') return null;
          diagnostics.seen++;

          return event.sequence === 0 ? null : { signal: 'HOLD', diagnostics };
        },
      };
    };
    const result = runReplay({ events: events(), strategy: custom });
    expect(result.totalDecisions).toBe(5);
    expect(result.decisions.map((decision) => decision.diagnostics?.seen)).toEqual([2, 3, 4, 5, 6]);
    expect(result.decisions[0]!.eventId).toBe(events()[1]!.id);
  });

  it('defines empty-input results and rejects bad strategies', () => {
    const empty = runReplay({ events: [], strategy });
    expect(empty).toMatchObject({
      symbol: null,
      provenance: null,
      totalEvents: 0,
      totalDecisions: 0,
      counts: {
        BUY: 0,
        SELL: 0,
        HOLD: 0,
      },
      warnings: [],
    });
    const invalid = (() => ({
      name: 'bad',
      onEvent: () => ({ signal: 'WAIT' }),
    })) as unknown as StrategyFactory;
    expect(() => runReplay({ events: events(), strategy: invalid })).toThrow('synchronously');
    const asyncStrategy = (() => ({
      name: 'async',
      onEvent: async () => ({ signal: 'HOLD' }),
    })) as unknown as StrategyFactory;
    expect(() => runReplay({ events: events(), strategy: asyncStrategy })).toThrow('synchronously');
  });

  it('reports actual RSI diagnostics and keeps markClose separate', () => {
    const timeline = events();
    const result = runReplay({ events: timeline, strategy });
    const indicator = new WilderRsi(2);

    for (const [index, event] of timeline.entries()) {
      expect(result.decisions[index]!.diagnostics?.rsi).toBe(indicator.update(event.candle.close));
      expect(result.decisions[index]!.diagnostics).toMatchObject({
        period: 2,
        buyThreshold: 30,
        sellThreshold: 70,
        priceField: 'close',
      });
    }

    const mark = runReplay({
      events: timeline,
      strategy: createRsiCrossStrategy({ period: 2, priceField: 'markClose' }),
    });
    expect(mark.decisions.slice(2).every((decision) => decision.diagnostics?.rsi === 50)).toBe(
      true,
    );
  });

  it('retains internal gaps without inventing events', () => {
    const fixture = synthetic();
    fixture.bars.splice(2, 1);
    fixture.meta.barCount--;
    fixture.meta.integrity.coverage = analyzeCoverage(fixture.bars, fixture.meta);
    const result = runReplay({ events: createCandleReplayEvents(fixture), strategy });
    expect(result.totalEvents).toBe(5);
    expect(result.warnings[0]).toContain('1 internal');
  });
});
describe('real Phoenix offline smoke test', () => {
  let timeline: readonly ReplayEvent[];
  beforeAll(async () => {
    timeline = createCandleReplayEvents(
      await loadCandleFixture('data/fixtures/candles/sol-5m-1790869255065-1791474055065.json'),
    );
  });

  it('runs both examples deterministically and warns about trailing history', () => {
    const before = runReplay({ events: timeline, strategy: baseline });
    const after = runReplay({ events: timeline, strategy: candidate });
    expect(before.totalEvents).toBe(1883);

    for (const result of [before, after]) {
      expect(result.totalDecisions).toBe(1883);
      expect(
        result.decisions.filter((decision) => decision.diagnostics?.warmup === true),
      ).toHaveLength(14);
      expect(result.counts.BUY + result.counts.SELL + result.counts.HOLD).toBe(1883);
      expect(result.warnings[0]).toContain('132 trailing');
    }
    expect(new Date(before.decisions[0]!.availableAtMs).toISOString()).toBe(
      '2026-10-01T15:50:00.000Z',
    );
    expect(new Date(before.decisions.at(-1)!.availableAtMs).toISOString()).toBe(
      '2026-10-08T04:40:00.000Z',
    );
    expect(JSON.stringify(runReplay({ events: timeline, strategy: baseline }))).toBe(
      JSON.stringify(before),
    );
    expect(JSON.stringify(runReplay({ events: timeline, strategy: candidate }))).toBe(
      JSON.stringify(after),
    );
    console.log(
      'Real fixture:',
      JSON.stringify({
        baseline: before.counts,
        candidate: after.counts,
        differingSignals: before.decisions.filter(
          (decision, i) => decision.signal !== after.decisions[i]!.signal,
        ).length,
      }),
    );
  });
});
