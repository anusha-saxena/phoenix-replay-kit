export interface StrategyConfig {
  period: number;
  buyThreshold: number;
  sellThreshold: number;
  priceField: "close" | "markClose";
}
export const example: { baseline: StrategyConfig; candidate: StrategyConfig } =
  {
    baseline: {
      period: 14,
      buyThreshold: 30,
      sellThreshold: 70,
      priceField: "close",
    },
    candidate: {
      period: 14,
      buyThreshold: 25,
      sellThreshold: 70,
      priceField: "close",
    },
  };

export function parseConfig(value: unknown, label: string): StrategyConfig {
  if (!value || typeof value !== "object")
    throw new Error(`${label}: provide a strategy configuration`);
  const { period, buyThreshold, sellThreshold, priceField } =
    value as StrategyConfig;
  if (!Number.isInteger(period) || period < 2 || period > 200)
    throw new Error(`${label}: RSI period must be an integer from 2 to 200`);
  if (
    typeof buyThreshold !== "number" ||
    typeof sellThreshold !== "number" ||
    !Number.isFinite(buyThreshold) ||
    !Number.isFinite(sellThreshold) ||
    buyThreshold < 0 ||
    sellThreshold > 100 ||
    buyThreshold >= sellThreshold
  )
    throw new Error(`${label}: thresholds must satisfy 0 ≤ BUY < SELL ≤ 100`);
  if (priceField !== "close" && priceField !== "markClose")
    throw new Error(`${label}: price field must be close or markClose`);
  return { period, buyThreshold, sellThreshold, priceField };
}
