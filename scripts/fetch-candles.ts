import { PhoenixHttpClient } from '@ellipsis-labs/rise';
import { createRequire } from 'node:module';
import { access } from 'node:fs/promises';
import { parseOptions } from './candle-options.js';
import { API_URL, collectCandles, saveCandleFixture } from './candle-collector.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: tsx scripts/fetch-candles.ts [--symbol SOL] [--timeframe 5m] [--hours 24 | --from UTC_ISO --to UTC_ISO] [--out PATH] [--force]');
    return;
  }

  const { window, out, force } = parseOptions(args);
  if (!force) {
    const exists = await access(out).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return false;
        }
        throw error;
      },
    );
    if (exists) {
      throw new Error(`File already exists: ${out}. Use --force to overwrite.`);
    }
  }

  const sdk = createRequire(import.meta.url)('@ellipsis-labs/rise/package.json') as {
    version: string;
  };
  const client = new PhoenixHttpClient({ apiUrl: API_URL });
  console.log(`Fetching ${window.symbol} ${window.timeframe}: ${new Date(window.requestedFromMs).toISOString()} -> ${new Date(window.requestedToMs).toISOString()}`);

  const fixture = await collectCandles(
    (symbol, query) => client.candles().getCandlesV2(symbol, query),
    window,
    sdk.version,
  );
  await saveCandleFixture(out, fixture, force);

  console.log(JSON.stringify({
    saved: out,
    bars: fixture.meta.barCount,
    pages: fixture.meta.pageCount,
    first: new Date(fixture.bars[0]!.time).toISOString(),
    last: new Date(fixture.bars.at(-1)!.time).toISOString(),
    integrity: fixture.meta.integrity,
  }, null, 2));

  if (!fixture.meta.integrity.coverage.complete) {
    console.warn('Incomplete requested coverage; no candles were invented.');
  }
}

main().catch((error: unknown) => {
  console.error(`Collection failed: ${error instanceof Error ? error.message : String(error)}. No successful fixture was produced. Check server timeframe support if the API rejected the query.`);
  process.exitCode = 1;
});
