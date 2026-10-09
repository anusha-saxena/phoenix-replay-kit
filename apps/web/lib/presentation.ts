import type { DeepReadonly, ReplayDecision } from "../../../src/index.js";
import type { StrategyConfig } from "./config";

export const utc = (time: number) =>
  new Date(time).toISOString().slice(0, 16).replace("T", " ");
export const rsiValue = (value: unknown) =>
  typeof value === "number" ? value.toFixed(2) : "not available";

export function explainDecision(
  decision: DeepReadonly<ReplayDecision> | null,
  config: StrategyConfig,
): string {
  if (!decision)
    return "This strategy did not produce a decision for this observation.";
  const previous = decision.diagnostics?.previousRsi;
  const current = decision.diagnostics?.rsi;
  if (typeof previous !== "number" || typeof current !== "number")
    return decision.reason ?? "The indicator is warming up.";
  const movement = `RSI moved from ${rsiValue(previous)} to ${rsiValue(current)}.`;
  if (decision.signal === "BUY")
    return `${movement} It crossed upward through the BUY threshold of ${config.buyThreshold}, generating BUY.`;
  if (decision.signal === "SELL")
    return `${movement} It crossed downward through the SELL threshold of ${config.sellThreshold}, generating SELL.`;
  return `${movement} It did not cross upward through ${config.buyThreshold} or downward through ${config.sellThreshold}, so the strategy generated HOLD.`;
}
