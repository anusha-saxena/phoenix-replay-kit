import { orderbookImbalance } from '../indicators/imbalance.js';
import type { StrategyFactory } from './types.js';

export function createBookImbalanceStrategy({ threshold = 0.6, topLevels = 5, name = 'book-imbalance' } = {}): StrategyFactory {
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) throw new Error('Imbalance threshold must be in (0,1]');
  if (!Number.isSafeInteger(topLevels) || topLevels < 1) throw new Error('topLevels must be positive');
  return () => ({
    name, id: 'book-imbalance', version: '1', requiredInputs: ['orderbook_snapshot'], warmupBars: 0, configuration: { threshold, topLevels },
    onEvent(event) {
      if (event.kind !== 'orderbook_snapshot') return null;
      const imbalance = orderbookImbalance(event.snapshot.bids, event.snapshot.asks, topLevels);
      return {
        signal: imbalance >= threshold ? 'BUY' : imbalance <= -threshold ? 'SELL' : 'HOLD',
        reason: 'Sampled top-N base-quantity imbalance',
        diagnostics: { imbalance, threshold, topLevels },
      };
    },
  });
}
