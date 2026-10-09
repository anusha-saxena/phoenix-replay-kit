import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createOrderbookFixture, validateOrderbookFixture, loadOrderbookFixture, parseBookLevels,
  createOrderbookReplayEvents, orderbookImbalance, createBookImbalanceStrategy,
  compareStrategies, runReplay,
} from '../../src/index.js';

const snapshot=(timestamp='2026-10-01T10:00:00.000Z',bid=83,ask=17)=>({timestamp,bids:[[10,bid]],asks:[[11,ask]],mid:10.5});

describe('locally sampled books', () => {
  it('validates price/quantity tuples and best-price ordering', () => {
    expect(parseBookLevels([[10,0],[9,2]],'bids')).toEqual([[10,0],[9,2]]);
    for(const value of [[[0,1]],[[10,-1]],[[10,Infinity]],[[10]],[[10,1,2]],[[9,1],[10,1]],[[10,1],[10,2]]]) {
      expect(()=>parseBookLevels(value,'bids')).toThrow();
    }
    expect(()=>createOrderbookFixture([{...snapshot(),asks:[[9,1]]}],'SOL')).toThrow('crossed');
    expect(()=>createOrderbookFixture([{...snapshot(),mid:20}],'SOL')).toThrow('mid');
    expect(()=>createOrderbookFixture([{...snapshot(),timestamp:'bad'}],'SOL')).toThrow('timestamp');
  });

  it('computes top-N base-quantity imbalance and handles zero depth', () => {
    expect(orderbookImbalance([[10,83]],[[11,17]])).toBeCloseTo(0.66);
    expect(orderbookImbalance([[10,0]],[[11,0]])).toBe(0);
    expect(orderbookImbalance([],[])).toBe(0);
    expect(orderbookImbalance([[10,3],[9,100]],[[11,1],[12,1]],1)).toBe(0.5);
    expect(orderbookImbalance([[10,1]],[])).toBe(1);
    expect(orderbookImbalance([],[[11,1]])).toBe(-1);
    expect(()=>orderbookImbalance([],[],0)).toThrow();
  });

  it('sorts snapshots, preserves raw input and reports identical duplicates', () => {
    const later=snapshot('2026-10-01T10:00:01.000Z');
    const raw=[later,snapshot(),snapshot()];
    const before=JSON.stringify(raw);
    const fixture=createOrderbookFixture(raw,'SOL');
    expect(fixture.meta.integrity).toEqual({outOfOrder:1,duplicatesRemoved:1});
    expect(fixture.snapshots[0]!.timestamp).toBe(snapshot().timestamp);
    expect(fixture.rawSnapshots).toEqual(raw);
    expect(JSON.stringify(raw)).toBe(before);
    expect(()=>createOrderbookFixture([snapshot(),snapshot(undefined,84,16)],'SOL')).toThrow('duplicate');
    expect(()=>validateOrderbookFixture({...fixture,meta:{...fixture.meta,snapshotCount:9}})).toThrow();
  });

  it('uses receipt time, remains deterministic and produces controlled threshold differences', () => {
    const fixture=createOrderbookFixture([snapshot()],'SOL');
    const events=createOrderbookReplayEvents(fixture);
    expect(events[0]).toMatchObject({eventTimeMs:Date.parse(snapshot().timestamp),availableAtMs:Date.parse(snapshot().timestamp),sequence:0});
    const baseline=createBookImbalanceStrategy({threshold:0.6});
    const candidate=createBookImbalanceStrategy({threshold:0.7});
    const result=compareStrategies({events,baseline,candidate});
    expect(result.changedDecisions).toBe(1);
    expect(result.diffs[0]!.baseline!.signal).toBe('BUY');
    expect(result.diffs[0]!.candidate!.signal).toBe('HOLD');
    expect(runReplay({events,strategy:baseline})).toEqual(runReplay({events,strategy:baseline}));
    expect(result.warnings[0]).toContain('Intermediate updates are not reconstructed');
  });

  it('loads both the real raw recording and reusable fixture', async () => {
    const fixture=await loadOrderbookFixture('data/fixtures/orderbook/sol-sampled-book.json');
    const raw=createOrderbookFixture(fixture.rawSnapshots,'SOL');
    if (existsSync('data/sol-snapshots.json')) {
      expect(await loadOrderbookFixture('data/sol-snapshots.json','SOL')).toEqual(fixture);
      await expect(loadOrderbookFixture('data/sol-snapshots.json')).rejects.toThrow('explicit symbol');
    }
    expect(raw).toEqual(fixture);
    expect(fixture.snapshots).toHaveLength(60);
    const events=createOrderbookReplayEvents(fixture);
    expect(events).toHaveLength(60);
    expect(events[0]!.availableAtMs).toBe(Date.parse('2026-10-08T14:51:15.761Z'));
    const result=compareStrategies({events,baseline:createBookImbalanceStrategy({threshold:0.6}),candidate:createBookImbalanceStrategy({threshold:0.7})});
    expect(result.changedDecisions).toBe(0);
    expect(result.baseline.counts.HOLD).toBe(60);
  });
});
