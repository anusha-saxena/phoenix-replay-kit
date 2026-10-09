import type { Signal, StrategyFactory } from "./types.js";
export interface BreakoutOptions {
  lookback?: number;
  bufferPercent?: number;
  priceField?: "close" | "markClose";
  name?: string;
}
export function createBreakoutStrategy(
  options: BreakoutOptions = {},
): StrategyFactory {
  const {
    lookback = 20,
    bufferPercent = 0,
    priceField = "close",
    name = "Prior-window breakout",
  } = options;
  if (!Number.isInteger(lookback) || lookback < 2 || lookback > 200)
    throw new Error("lookback must be 2..200");
  if (
    !Number.isFinite(bufferPercent) ||
    bufferPercent < 0 ||
    bufferPercent > 20
  )
    throw new Error("bufferPercent must be 0..20");
  if (!["close", "markClose"].includes(priceField))
    throw new Error("Unsupported priceField");
  return () => {
    const prices: number[] = [];
    let previousSide = 0;
    return {
      id: "breakout",
      version: "1",
      name,
      requiredInputs: ["candle_closed"],
      warmupBars: lookback,
      configuration: { lookback, bufferPercent, priceField },
      onEvent(event) {
        if (event.kind !== "candle_closed") return null;
        const price = event.candle[priceField];
        const high =
          prices.length === lookback
            ? Math.max(...prices) * (1 + bufferPercent / 100)
            : null;
        const low =
          prices.length === lookback
            ? Math.min(...prices) * (1 - bufferPercent / 100)
            : null;
        let side = 0;
        if (high !== null && price > high) side = 1;
        if (low !== null && price < low) side = -1;

        let signal: Signal = "HOLD";
        if (side !== previousSide) {
          if (side === 1) signal = "BUY";
          if (side === -1) signal = "SELL";
        }
        prices.push(price);
        if (prices.length > lookback) prices.shift();
        previousSide = side;
        return {
          signal,
          reason:
            signal === "HOLD"
              ? "No new breakout"
              : "Price broke the prior close range",
          diagnostics: { price, high, low, warmup: high === null },
        };
      },
    };
  };
}
