import { loadCandleFixture } from '../src/index.js';

const path = process.argv[2];
if (!path) {
  throw new Error('Usage: tsx scripts/validate-candles.ts PATH');
}

const fixture = await loadCandleFixture(path);
console.log(JSON.stringify({
  path,
  bars: fixture.meta.barCount,
  first: new Date(fixture.bars[0]!.time).toISOString(),
  last: new Date(fixture.bars.at(-1)!.time).toISOString(),
  integrity: fixture.meta.integrity,
  legacy: Boolean(fixture.meta.legacyOriginalMeta),
}, null, 2));
