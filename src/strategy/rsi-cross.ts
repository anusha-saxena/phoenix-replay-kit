import { WilderRsi, validateRsiPeriod } from '../indicators/rsi.js';
import type { Signal, StrategyFactory } from './types.js';

export interface RsiCrossOptions {
  name?: string;
  period?: number;
  buyThreshold?: number;
  sellThreshold?: number;
  priceField?: 'close' | 'markClose';
}

export function crossingSignal(
  previous: number | null,
  current: number | null,
  buyThreshold: number,
  sellThreshold: number,
): Signal {
  if (previous === null || current === null) {
    return 'HOLD';
  }
  if (previous < buyThreshold && current >= buyThreshold) {
    return 'BUY';
  }
  if (previous > sellThreshold && current <= sellThreshold) {
    return 'SELL';
  }

  return 'HOLD';
}

export function createRsiCrossStrategy(options: RsiCrossOptions = {}): StrategyFactory {
  const period = options.period ?? 14;
  const buyThreshold = options.buyThreshold ?? 30;
  const sellThreshold = options.sellThreshold ?? 70;
  const priceField = options.priceField ?? 'close';
  const name = options.name ?? `rsi-${period}-${buyThreshold}-${sellThreshold}-${priceField}`;
  validateRsiPeriod(period);
  if (
    !Number.isFinite(buyThreshold) ||
    !Number.isFinite(sellThreshold) ||
    buyThreshold < 0 ||
    sellThreshold > 100 ||
    buyThreshold >= sellThreshold
  ) {
    throw new Error('RSI thresholds must satisfy 0 <= buy < sell <= 100');
  }
  if (priceField !== 'close' && priceField !== 'markClose') {
    throw new Error('Unsupported RSI priceField');
  }

  return () => {
    const indicator = new WilderRsi(period);
    let previousRsi: number | null = null;

    return {
      name,
      id: 'rsi-cross',
      version: '1',
      requiredInputs: ['candle_closed'],
      warmupBars: period + 1,
      configuration: Object.freeze({
        period,
        buyThreshold,
        sellThreshold,
        priceField,
      }),
      onEvent(event) {
        if (event.kind !== 'candle_closed') {
          return null;
        }

        const rsi = indicator.update(event.candle[priceField]);
        const signal = crossingSignal(previousRsi, rsi, buyThreshold, sellThreshold);
        let reason = 'No threshold crossing';

        if (rsi === null) {
          reason = `RSI warm-up: need ${period + 1} closes`;
        } else if (previousRsi === null) {
          reason = 'First RSI value: waiting for a second value';
        } else if (signal === 'BUY') {
          reason = 'RSI crossed upward through oversold threshold';
        } else if (signal === 'SELL') {
          reason = 'RSI crossed downward through overbought threshold';
        }

        const diagnostics = {
          rsi,
          previousRsi,
          buyThreshold,
          sellThreshold,
          period,
          priceField,
          warmup: rsi === null,
        };
        previousRsi = rsi;

        return {
          signal,
          reason,
          diagnostics,
        };
      },
    };
  };
}
