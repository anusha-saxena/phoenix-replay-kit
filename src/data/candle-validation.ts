import type { Candle, CandleWindow, Coverage } from './types.js';

export function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function integer(value: unknown, name: string, min = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > 8.64e15
  ) {
    throw new Error(`${name} must be a safe integer >= ${min}`);
  }
  return value;
}

export function parseTimeframe(value: string): number {
  const match = /^([1-9]\d*)([mhd])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid timeframe ${value}: use positive minute/hour/day notation, e.g. 5m, 1h, 1d (server support varies)`);
  }

  const units: Record<string, number> = {
    m: 60000,
    h: 3600000,
    d: 86400000,
  };
  const durationMs = Number(match[1]) * units[match[2]!]!;
  return integer(durationMs, 'timeframeMs', 1);
}

export function validateWindow(window: CandleWindow): number {
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(window.symbol)) {
    throw new Error('symbol must be an uppercase market identifier');
  }

  integer(window.requestedFromMs, 'requestedFromMs');
  integer(window.requestedToMs, 'requestedToMs');
  if (window.requestedFromMs >= window.requestedToMs) {
    throw new Error('from must be earlier than to');
  }

  return parseTimeframe(window.timeframe);
}

export function validateCandle(value: unknown, label: string, step: number): Candle {
  const bar = record(value, label);
  integer(bar.time, `${label}.time`);
  if ((bar.time as number) % step !== 0) {
    throw new Error(`${label}.time is not aligned to UTC timeframe buckets`);
  }
  if (typeof bar.isFinal !== 'boolean') {
    throw new Error(`${label}.isFinal must be boolean`);
  }

  // Check both the trade prices and mark prices.
  for (const prefix of ['', 'mark']) {
    const keys = prefix
      ? ['markOpen', 'markHigh', 'markLow', 'markClose']
      : ['open', 'high', 'low', 'close'];

    for (const key of keys) {
      if (
        typeof bar[key] !== 'number' ||
        !Number.isFinite(bar[key]) ||
        (bar[key] as number) <= 0
      ) {
        throw new Error(`${label}.${key} must be a finite positive price`);
      }
    }

    const [open, high, low, close] = keys.map(key => bar[key] as number) as [
      number, number, number, number,
    ];
    if (low > high || open < low || open > high || close < low || close > high) {
      throw new Error(`${label}: incoherent ${prefix || 'trade'} OHLC`);
    }
  }

  for (const key of ['volume', 'volumeQuote', 'tradeCount']) {
    if (
      bar[key] !== undefined &&
      (typeof bar[key] !== 'number' || !Number.isFinite(bar[key]) || (bar[key] as number) < 0)
    ) {
      throw new Error(`${label}.${key} must be finite and nonnegative`);
    }
  }
  if (bar.tradeCount !== undefined) {
    integer(bar.tradeCount, `${label}.tradeCount`);
  }
  if (
    bar.externalSource !== undefined &&
    (typeof bar.externalSource !== 'string' || !bar.externalSource)
  ) {
    throw new Error(`${label}.externalSource must be a nonempty string`);
  }

  const allowed = new Set([
    'time', 'isFinal',
    'open', 'high', 'low', 'close',
    'markOpen', 'markHigh', 'markLow', 'markClose',
    'volume', 'volumeQuote', 'tradeCount', 'externalSource',
  ]);
  for (const key of Object.keys(bar)) {
    if (!allowed.has(key)) {
      throw new Error(`${label}: unexpected candle field ${key}`);
    }
  }

  return bar as unknown as Candle;
}

export function analyzeCoverage(
  bars: readonly Candle[],
  window: CandleWindow,
  cutoff = window.requestedToMs,
): Coverage {
  const step = validateWindow(window);
  integer(cutoff, 'evaluationCutoffMs');

  const first = Math.ceil(window.requestedFromMs / step) * step;
  const end = Math.max(
    first,
    Math.floor(Math.min(cutoff, window.requestedToMs) / step) * step,
  );
  const expectedBars = (end - first) / step;
  const internalGaps: Coverage['internalGaps'] = [];

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]!;
    if (!bar.isFinal || bar.time < first || bar.time + step > end || bar.time % step) {
      throw new Error(`bar ${i} is non-final or outside fully closed requested buckets`);
    }

    const previousBar = bars[i - 1];
    if (previousBar && bar.time <= previousBar.time) {
      throw new Error(`bar ${i}: duplicate or out-of-order timestamp`);
    }
    if (previousBar && bar.time - previousBar.time > step) {
      internalGaps.push({
        afterMs: previousBar.time,
        beforeMs: bar.time,
        missingBars: (bar.time - previousBar.time) / step - 1,
      });
    }
  }

  const leadingMissingBars = bars.length ? (bars[0]!.time - first) / step : expectedBars;
  const trailingMissingBars = bars.length ? (end - bars.at(-1)!.time - step) / step : 0;
  const internalMissingBars = internalGaps.reduce((sum, gap) => sum + gap.missingBars, 0);
  const missingBars = leadingMissingBars + trailingMissingBars + internalMissingBars;

  return {
    expectedFirstStartMs: first,
    expectedEndExclusiveMs: end,
    expectedBars,
    leadingMissingBars,
    trailingMissingBars,
    internalGaps,
    internalMissingBars,
    missingBars,
    complete: missingBars === 0,
  };
}

export function normalizeCandles(
  values: readonly unknown[],
  window: CandleWindow,
  cutoff: number,
) {
  const step = validateWindow(window);
  let excludedNonFinal = 0;
  let excludedAfterCutoff = 0;
  let outOfOrder = 0;
  let duplicatesRemoved = 0;
  const valid: Candle[] = [];
  let previous: number | undefined;

  for (let i = 0; i < values.length; i++) {
    const bar = validateCandle(values[i], `bars[${i}]`, step);
    if (previous !== undefined && bar.time < previous) {
      outOfOrder++;
    }
    previous = bar.time;

    if (bar.time < window.requestedFromMs || bar.time >= window.requestedToMs) {
      throw new Error(`bars[${i}] outside requested window`);
    }
    if (!bar.isFinal) {
      excludedNonFinal++;
      continue;
    }
    if (bar.time + step > Math.min(cutoff, window.requestedToMs)) {
      excludedAfterCutoff++;
      continue;
    }

    valid.push(bar);
  }

  valid.sort((a, b) => a.time - b.time);
  const bars: Candle[] = [];
  for (const bar of valid) {
    const previousBar = bars.at(-1);
    if (previousBar?.time === bar.time) {
      const keys = new Set([...Object.keys(previousBar), ...Object.keys(bar)]);
      const conflicting = [...keys].some(key =>
        (previousBar as unknown as Record<string, unknown>)[key] !==
        (bar as unknown as Record<string, unknown>)[key],
      );
      if (conflicting) {
        throw new Error(`Conflicting duplicate timestamp ${bar.time}`);
      }
      duplicatesRemoved++;
    } else {
      bars.push(bar);
    }
  }

  return {
    bars,
    integrity: {
      outOfOrder,
      duplicatesRemoved,
      excludedNonFinal,
      excludedAfterCutoff,
      coverage: analyzeCoverage(bars, window, cutoff),
    },
  };
}
