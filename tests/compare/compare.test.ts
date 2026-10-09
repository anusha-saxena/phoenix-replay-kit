import { describe, expect, it } from 'vitest';
import {
  compareStrategies,
  compareReplayResults,
  createCandleReplayEvents,
  runReplay,
  createRsiCrossStrategy,
  type StrategyFactory,
} from '../../src/index.js';
import { syntheticFixture } from '../helpers/synthetic-fixture.js';

const events = () => createCandleReplayEvents(syntheticFixture());

const fixed =
  (signal: 'BUY' | 'SELL' | 'HOLD', detail = 1): StrategyFactory =>
  () => ({
    name: `fixed-${signal}`,
    onEvent: () => ({ signal, diagnostics: { detail } }),
  });
describe('comparison', () => {
  it('matches identical signals even when diagnostics differ', () => {
    const result = compareStrategies({
      events: events(),
      baseline: fixed('HOLD', 1),
      candidate: fixed('HOLD', 2),
    });
    expect(result).toMatchObject({
      changedDecisions: 0,
      comparableDecisions: 6,
      unchangedDecisions: 6,
      diffs: [],
    });
  });

  it('returns exact keys, times, categories, reasons and diagnostics', () => {
    const timeline = events();
    const result = compareStrategies({
      events: timeline,
      baseline: fixed('HOLD'),
      candidate: fixed('BUY'),
    });
    expect(result.changedDecisions).toBe(6);
    expect(result.categories).toEqual({ 'HOLD -> BUY': 6 });
    expect(result.diffs[0]).toMatchObject({
      eventId: timeline[0]!.id,
      symbol: 'SOL',
      sequence: 0,
      timestampMs: timeline[0]!.availableAtMs,
      timestampUtc: '2026-10-01T10:05:00.000Z',
      signalChanged: true,
      change: 'signal_changed',
      baseline: { signal: 'HOLD', diagnostics: { detail: 1 } },
      candidate: { signal: 'BUY', diagnostics: { detail: 1 } },
    });
  });

  it('aligns sparse decisions by identity and counts absence explicitly', () => {
    const sparse: StrategyFactory = () => ({
      name: 'sparse',
      onEvent: (event) => (event.sequence % 2 ? { signal: 'HOLD' } : null),
    });
    const result = compareStrategies({
      events: events(),
      baseline: fixed('HOLD'),
      candidate: sparse,
    });
    expect(result).toMatchObject({
      comparableDecisions: 3,
      unchangedDecisions: 3,
      changedDecisions: 3,
      signalChanges: 0,
      missingCandidate: 3,
      missingBaseline: 0,
    });
    expect(result.diffs.map((diff) => diff.sequence)).toEqual([0, 2, 4]);
    expect(result.diffs.every((diff) => diff.candidate === null && !diff.signalChanged)).toBe(true);
    const reversed = compareStrategies({
      events: events(),
      baseline: sparse,
      candidate: fixed('HOLD'),
    });
    expect(reversed.missingBaseline).toBe(3);
  });

  it('rejects different datasets and event timing mismatches', () => {
    const left = runReplay({ events: events(), strategy: fixed('HOLD') });
    const other = createCandleReplayEvents(syntheticFixture([11, 9, 8, 10, 11, 9]));
    expect(() =>
      compareReplayResults(left, runReplay({ events: other, strategy: fixed('HOLD') })),
    ).toThrow('different datasets');
    const changed = {
      ...left,
      decisions: left.decisions.map((decision, index) => ({
        ...decision,
        availableAtMs: decision.availableAtMs + (index === 0 ? 1 : 0),
      })),
    };
    expect(() => compareReplayResults(left, changed)).toThrow('timestamp mismatch');
  });

  it('does not rely on decision array positions', () => {
    const left = runReplay({ events: events(), strategy: fixed('HOLD') });
    const shuffled = { ...left, decisions: [...left.decisions].reverse() };
    expect(compareReplayResults(left, shuffled).changedDecisions).toBe(0);
    expect(() =>
      compareReplayResults(left, { ...left, decisions: [left.decisions[0]!, left.decisions[0]!] }),
    ).toThrow('Duplicate');
  });

  it('is reproducible and independent of strategy order', () => {
    const timeline = events();
    const rsi = createRsiCrossStrategy({ period: 2 });
    const first = compareStrategies({
      events: timeline,
      baseline: rsi,
      candidate: fixed('BUY'),
    });
    const reverse = compareStrategies({
      events: timeline,
      baseline: fixed('BUY'),
      candidate: rsi,
    });
    expect(first.baseline).toEqual(reverse.candidate);
    expect(first.candidate).toEqual(reverse.baseline);
    expect(
      JSON.stringify(
        compareStrategies({
          events: timeline,
          baseline: rsi,
          candidate: fixed('BUY'),
        }),
      ),
    ).toBe(JSON.stringify(first));
    expect(first.diffs.map((diff) => diff.timestampMs)).toEqual(
      first.diffs.map((diff) => diff.timestampMs).sort((a, b) => a - b),
    );
  });

  it('keeps warm-up HOLD decisions comparable', () => {
    const result = compareStrategies({
      events: events(),
      baseline: createRsiCrossStrategy({ buyThreshold: 30 }),
      candidate: createRsiCrossStrategy({ buyThreshold: 25 }),
    });
    expect(result.changedDecisions).toBe(0);
    expect(result.baseline.counts.HOLD).toBe(6);
    expect(result.comparableDecisions).toBe(6);
  });

  it('protects shared input and reports coverage separately from signal changes', () => {
    const fixture = syntheticFixture();
    fixture.meta.requestedToMs += 300000;
    fixture.meta.fetchedAtMs += 300000;
    fixture.meta.evaluationCutoffMs += 300000;
    fixture.meta.integrity.coverage.expectedEndExclusiveMs += 300000;
    fixture.meta.integrity.coverage.expectedBars++;
    fixture.meta.integrity.coverage.trailingMissingBars++;
    fixture.meta.integrity.coverage.missingBars++;
    fixture.meta.integrity.coverage.complete = false;
    const timeline = createCandleReplayEvents(fixture);
    const mutator: StrategyFactory = () => ({
      name: 'mutator',
      onEvent(event) {
        if (event.kind !== 'candle_closed') return null;
        expect(() => Object.assign(event.candle, { close: 999 })).toThrow();

        return { signal: 'HOLD' };
      },
    });
    const result = compareStrategies({
      events: timeline,
      baseline: mutator,
      candidate: fixed('HOLD'),
    });
    expect(result.changedDecisions).toBe(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('1 trailing');
  });
});
