import { validateWindow } from '../src/data/candle-validation.js';
import type { CandleWindow } from '../src/data/types.js';

export function parseUtcDate(value: string, name: string): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new Error(`--${name} requires a UTC ISO timestamp ending in Z`);
  }

  const result = Date.parse(value);
  const normalizedDate = value.replace(
    /(?:\.(\d{1,3}))?Z$/,
    (_, digits: string | undefined) => `.${(digits ?? '').padEnd(3, '0')}Z`,
  );
  if (!Number.isFinite(result) || new Date(result).toISOString() !== normalizedDate) {
    throw new Error(`Invalid --${name} date: ${value}`);
  }

  return result;
}

export function parseOptions(
  args: string[],
  now = Date.now(),
): { window: CandleWindow; out: string; force: boolean } {
  const options = new Map<string, string>();
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === '--force') {
      if (force) {
        throw new Error('Duplicate --force');
      }
      force = true;
      continue;
    }

    if (!['--symbol', '--timeframe', '--hours', '--from', '--to', '--out'].includes(key)) {
      throw new Error(`Unknown option ${key}`);
    }
    if (options.has(key)) {
      throw new Error(`Duplicate option ${key}`);
    }

    i++;
    const value = args[i];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }
    options.set(key, value);
  }

  const from = options.get('--from');
  const to = options.get('--to');
  if (Boolean(from) !== Boolean(to)) {
    throw new Error('Use --from and --to together');
  }
  if (from && options.has('--hours')) {
    throw new Error('Use --hours or --from/--to, not both');
  }

  const hours = Number(options.get('--hours') ?? 168);
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isSafeInteger(hours * 3600000)) {
    throw new Error('--hours must be a positive duration in whole milliseconds');
  }

  const durationMs = hours * 3600000;
  const requestedToMs = to ? parseUtcDate(to, 'to') : now;
  const window = {
    symbol: (options.get('--symbol') ?? 'SOL').toUpperCase(),
    timeframe: options.get('--timeframe') ?? '5m',
    requestedFromMs: from
      ? parseUtcDate(from, 'from')
      : requestedToMs - durationMs,
    requestedToMs,
  };
  validateWindow(window);

  return {
    window,
    force,
    out: options.get('--out') ??
      `data/fixtures/candles/${window.symbol.toLowerCase()}-${window.timeframe}-${window.requestedFromMs}-${window.requestedToMs}.json`,
  };
}
