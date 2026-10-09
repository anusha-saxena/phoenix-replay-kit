import { createRsiCrossStrategy, type RsiCrossOptions } from './rsi-cross.js';
import type { StrategyFactory } from './types.js';
import type { FundingObservation } from '../data/funding.js';
import type { DeepReadonly } from '../replay/events.js';

export interface RsiFundingOptions extends RsiCrossOptions {
  maxFundingRatePercentage: number;
  missingFundingPolicy: 'allow' | 'suppress';
}

export function createRsiFundingStrategy(options: RsiFundingOptions): StrategyFactory {
  if (!Number.isFinite(options.maxFundingRatePercentage)) throw new Error('Funding threshold must be finite percentage points');
  if (!['allow', 'suppress'].includes(options.missingFundingPolicy)) throw new Error('Choose allow or suppress for missing funding');
  const rsiFactory = createRsiCrossStrategy(options);
  return () => {
    const rsi = rsiFactory();
    let latest: DeepReadonly<FundingObservation> | null = null;
    return {
      name: options.name ?? 'rsi-funding-filter',
      id: 'rsi-funding-filter', version: '1', requiredInputs: ['candle_closed'], warmupBars: rsi.warmupBars ?? 0,
      configuration: { ...rsi.configuration, maxFundingRatePercentage: options.maxFundingRatePercentage,
        missingFundingPolicy: options.missingFundingPolicy, fundingRateUnit: 'percentage_points' },
      onEvent(event, context) {
        if (event.kind === 'funding_rate') { latest = event.funding; return null; }
        const decision = rsi.onEvent(event, context);
        if (!decision) return null;
        const crossing = decision.signal === 'BUY';
        const suppress = crossing && (latest
          ? latest.fundingRatePercentage > options.maxFundingRatePercentage
          : options.missingFundingPolicy === 'suppress');
        return {
          ...decision,
          signal: suppress ? 'HOLD' : decision.signal,
          reason: suppress ? (latest ? 'RSI BUY suppressed: funding above maximum' : 'RSI BUY suppressed: funding unavailable') : decision.reason!,
          diagnostics: { ...decision.diagnostics, buyCrossing: crossing, buySuppressed: suppress,
            fundingRatePercentage: latest?.fundingRatePercentage ?? null,
            rawFundingRatePercentage: latest?.rawFundingRatePercentage ?? null,
            fundingEventTimeMs: latest?.eventTimeMs ?? null, fundingAvailableAtMs: latest?.availableAtMs ?? null,
            maxFundingRatePercentage: options.maxFundingRatePercentage,
            missingFundingPolicy: options.missingFundingPolicy, fundingRateUnit: 'percentage_points' },
        };
      },
    };
  };
}
