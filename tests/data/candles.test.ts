import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Candle, CandleWindow } from '../../src/index.js';
import { analyzeCoverage, normalizeCandles, parseTimeframe, loadCandleFixture, validateCandleFixture } from '../../src/index.js';
import { collectCandles, saveCandleFixture, type CandleFetcher } from '../../scripts/candle-collector.js';
import { parseOptions, parseUtcDate } from '../../scripts/candle-options.js';
const step = 300000;
const window: CandleWindow = { symbol: 'SOL', timeframe: '5m', requestedFromMs: 0, requestedToMs: step*4 };
const bar = (time: number): Candle => ({ time, open: 10, high: 12, low: 9, close: 11, markOpen: 10, markHigh: 12, markLow: 9, markClose: 11, isFinal: true });
const page = (bars: Candle[], hasMore = false, nextCursor?: string) => ({ symbol: 'SOL', timeframe: '5m', from: 0, to: step*4, bars, page: { hasMore, ...(nextCursor === undefined ? {} : { nextCursor }) } });
const fixture = () => collectCandles(async () => page([bar(0),bar(step),bar(step*2),bar(step*3)]), window, 'synthetic-test', step*4);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir,{recursive:true,force:true}))); });
async function temp() { const dir = await mkdtemp(join(tmpdir(),'phoenix-test-')); dirs.push(dir); return join(dir,'fixture.json'); }
describe('offline fixture', () => {
  it('loads valid saved metadata and refuses overwrite', async () => { const path=await temp(), data=await fixture(); await saveCandleFixture(path,data); expect(await loadCandleFixture(path)).toEqual(data); expect(JSON.parse(await readFile(path,'utf8')).meta.schemaVersion).toBe(1); await expect(saveCandleFixture(path,data)).rejects.toThrow('EEXIST'); await saveCandleFixture(path,data,true); expect(await loadCandleFixture(path)).toEqual(data); });
  it('explains missing files and malformed JSON', async () => { const path=await temp(); await expect(loadCandleFixture(path)).rejects.toThrow('Cannot load candle fixture'); await writeFile(path,'{'); await expect(loadCandleFixture(path)).rejects.toThrow(path); });
  it('rejects schema/provenance/count/timeframe/coverage inconsistencies', async () => { const data=await fixture(); for (const patch of [{schemaVersion:2},{barCount:9},{timeframeMs:1},{sdkPackage:'other'},{integrity:{...data.meta.integrity,coverage:{complete:false}}}]) expect(() => validateCandleFixture({...data,meta:{...data.meta,...patch}})).toThrow(); });
  it('rejects non-final, duplicate and unordered bars on disk', async () => { const data=await fixture(); for (const bars of [[{...bar(0),isFinal:false},...data.bars.slice(1)], [bar(0),bar(0),bar(step*2),bar(step*3)], [...data.bars].reverse()]) expect(() => validateCandleFixture({...data,bars})).toThrow(); });
  it('rejects impossible prices and timestamps', async () => { const data=await fixture(); for (const patch of [{open:0},{high:9},{markLow:13},{volume:-1},{tradeCount:1.5},{time:1},{externalSource:12},{unexpected:true}]) expect(() => validateCandleFixture({...data,bars:[{...bar(0),...patch},...data.bars.slice(1)]})).toThrow(); });
  it('adapts the unchanged real legacy dataset and measures trailing coverage', async () => { const data=await loadCandleFixture('data/fixtures/candles/sol-5m-1790869255065-1791474055065.json'); expect(data.bars).toHaveLength(1883); expect(data.meta.legacyOriginalMeta).toBeDefined(); expect(data.meta.integrity.coverage).toMatchObject({leadingMissingBars:0,internalMissingBars:0,trailingMissingBars:132,complete:false}); });
});
describe('normalization and coverage', () => {
  it('sorts and deduplicates identical bars, rejects conflicting duplicates', () => { expect(normalizeCandles([bar(step),bar(0),bar(0)],window,step*4).integrity).toMatchObject({outOfOrder:1,duplicatesRemoved:1}); expect(() => normalizeCandles([bar(0),{...bar(0),close:10}],window,step*4)).toThrow('Conflicting'); });
  it('reports leading, internal and trailing missing buckets', () => { expect(analyzeCoverage([bar(step),bar(step*3)],window)).toMatchObject({leadingMissingBars:1,internalMissingBars:1,trailingMissingBars:0,missingBars:2}); expect(analyzeCoverage([bar(0),bar(step)],window)).toMatchObject({internalMissingBars:0,trailingMissingBars:2}); });
  it('accounts for partial boundaries, empty windows and cutoff', () => { expect(analyzeCoverage([bar(step)],{...window,requestedFromMs:1,requestedToMs:step*2+1})).toMatchObject({expectedBars:1,complete:true}); expect(analyzeCoverage([],window)).toMatchObject({missingBars:4,leadingMissingBars:4,trailingMissingBars:0}); expect(normalizeCandles([bar(0),bar(step),{...bar(step*2),isFinal:false}],window,step+1).integrity).toMatchObject({excludedAfterCutoff:1,excludedNonFinal:1}); expect(() => normalizeCandles([bar(step*4)],window,step*4)).toThrow('outside'); });
});
describe('pagination', () => {
  it('uses cursor-only requests for subsequent pages', async () => { const fetch=vi.fn<CandleFetcher>().mockResolvedValueOnce(page([bar(0)],true,'a')).mockResolvedValueOnce(page([bar(step)],true,'b')).mockResolvedValueOnce(page([bar(step*2),bar(step*3)])); const data=await collectCandles(fetch,window,'test',step*4); expect(data.meta.pageCount).toBe(3); expect(fetch.mock.calls[0]![1]).toMatchObject({includePartial:false}); expect(fetch.mock.calls[1]![1]).toEqual({cursor:'a'}); expect(fetch.mock.calls[2]![1]).toEqual({cursor:'b'}); });
  it('rejects missing, repeated and cyclic cursors', async () => { for (const cursors of [[undefined],['a','a'],['a','b','a']]) { const fetch=vi.fn<CandleFetcher>(); for(const cursor of cursors) fetch.mockResolvedValueOnce(page([bar(0)],true,cursor)); await expect(collectCandles(fetch,window,'test',step*4)).rejects.toThrow(/cursor/i); } });
  it('rejects page limits, response mismatch and network failures', async () => { await expect(collectCandles(async()=>page([bar(0)],true,'a'),window,'test',step*4,1)).rejects.toThrow('exceeded'); await expect(collectCandles(async()=>({...page([bar(0)]),timeframe:'1m'}),window,'test',step*4)).rejects.toThrow('mismatch'); await expect(collectCandles(async()=>{throw new Error('offline');},window,'test',step*4)).rejects.toThrow('offline'); });
});
describe('CLI and UTC', () => {
  it('parses positive common timeframes', () => { expect(parseTimeframe('5m')).toBe(step); expect(parseTimeframe('2h')).toBe(7200000); expect(parseTimeframe('1d')).toBe(86400000); for(const value of ['0m','-1m','1s','Infinityh']) expect(()=>parseTimeframe(value)).toThrow(); });
  it('requires real UTC dates and paired fixed bounds', () => { expect(parseUtcDate('2026-10-01T00:00:00Z','from')).toBe(1790812800000); for(const value of ['2026-02-30T00:00:00Z','2026-10-01','2026-10-01T00:00:00+00:00']) expect(()=>parseUtcDate(value,'from')).toThrow(); expect(parseOptions(['--hours','24'],86400000).window.requestedFromMs).toBe(0); expect(parseOptions(['--from','2026-10-01T00:00:00Z','--to','2026-10-08T00:00:00Z']).window.requestedToMs).toBe(1791417600000); });
  it('rejects friendly CLI mistakes', () => { for(const args of [['--hours','0'],['--hours','NaN'],['--from','2026-10-01T00:00:00Z'],['--symbol'],['--bogus'],['--hours','1','--hours','2'],['--from','2026-10-08T00:00:00Z','--to','2026-10-01T00:00:00Z'],['--symbol','../SOL']]) expect(()=>parseOptions(args)).toThrow(); });
});


