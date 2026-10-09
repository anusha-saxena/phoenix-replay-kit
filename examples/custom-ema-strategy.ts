import { Ema, type Signal, type StrategyFactory } from "../src/index.js";

// ema period settings
const fastPeriod = 5;
const slowPeriod = 15;

const createStrategy: StrategyFactory = () => {
  // make sure fast is smaller than slow
  if (fastPeriod >= slowPeriod) {
    throw new Error("Fast EMA period must be below slow EMA period");
  }

  const fast = new Ema(fastPeriod);
  const slow = new Ema(slowPeriod);
  let previousSpread: number | null = null;

  return {
    id: "custom-ema",
    version: "1",
    name: "My EMA 5/15",
    configuration: {
      fastPeriod: fastPeriod,
      slowPeriod: slowPeriod,
      priceField: "close",
    },
    requiredInputs: ["candle_closed"],
    warmupBars: slowPeriod,

    onEvent(event, context) {
      // only care about candles closing
      if (event.kind !== "candle_closed") {
        return null;
      }

      const closePrice = event.candle.close;
      const fastEma = fast.update(closePrice);
      const slowEma = slow.update(closePrice);

      let spread: number | null = null;
      if (fastEma !== null && slowEma !== null) {
        spread = fastEma - slowEma;
      }

      let signal: Signal = "HOLD";

      // check for crossovers
      if (spread !== null && previousSpread !== null) {
        if (previousSpread <= 0 && spread > 0) {
          signal = "BUY";
        }
        if (previousSpread >= 0 && spread < 0) {
          signal = "SELL";
        }
      }

      let isWarmingUp = false;
      if (spread === null || previousSpread === null) {
        isWarmingUp = true;
      }

      const diagnostics = {
        fastEma: fastEma,
        slowEma: slowEma,
        previousSpread: previousSpread,
        warmup: isWarmingUp,
        availableAtMs: context.availableAtMs,
      };

      previousSpread = spread;

      let reasonText = "No EMA crossing";
      if (signal !== "HOLD") {
        reasonText = `EMA crossover: ${signal}`;
      }

      return {
        signal: signal,
        diagnostics: diagnostics,
        reason: reasonText,
      };
    },
  };
};

export default createStrategy;