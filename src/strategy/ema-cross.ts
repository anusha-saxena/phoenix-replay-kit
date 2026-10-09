import { Ema, validateEmaPeriod } from "../indicators/ema.js";
import type { Signal, StrategyFactory } from "./types.js";
export interface EmaCrossOptions {
  fastPeriod?: number;
  slowPeriod?: number;
  priceField?: "close" | "markClose";
  name?: string;
}
export function createEmaCrossStrategy(
  options: EmaCrossOptions = {},
): StrategyFactory {
  const {
    fastPeriod = 9,
    slowPeriod = 21,
    priceField = "close",
    name = "EMA crossover",
  } = options;
  validateEmaPeriod(fastPeriod);
  validateEmaPeriod(slowPeriod);
  if (fastPeriod >= slowPeriod)
    throw new Error("fastPeriod must be less than slowPeriod");
  if (!["close", "markClose"].includes(priceField))
    throw new Error("Unsupported priceField");
  return () => {
    const fast = new Ema(fastPeriod);
    const slow = new Ema(slowPeriod);
    let previousSpread: number | null = null;
    return {
      id: "ema-cross",
      version: "1",
      name,
      requiredInputs: ["candle_closed"],
      warmupBars: slowPeriod,
      configuration: { fastPeriod, slowPeriod, priceField },
      onEvent(event) {
        if (event.kind !== "candle_closed") return null;
        const fastEma = fast.update(event.candle[priceField]);
        const slowEma = slow.update(event.candle[priceField]);
        const spread =
          fastEma === null || slowEma === null ? null : fastEma - slowEma;
        let signal: Signal = "HOLD";
        if (spread !== null && previousSpread !== null) {
          if (previousSpread <= 0 && spread > 0) signal = "BUY";
          if (previousSpread >= 0 && spread < 0) signal = "SELL";
        }
        const diagnostics = {
          fastEma,
          slowEma,
          previousSpread,
          warmup: spread === null || previousSpread === null,
        };
        previousSpread = spread;
        return {
          signal,
          diagnostics,
          reason:
            signal === "HOLD"
              ? "No EMA crossing"
              : `Fast EMA crossed ${signal === "BUY" ? "above" : "below"} slow EMA`,
        };
      },
    };
  };
}
