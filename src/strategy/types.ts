import type { ReplayEvent } from "../replay/events.js";

export type Signal = "BUY" | "SELL" | "HOLD";

export type DiagnosticValue = string | number | boolean | null;

export interface StrategyDecision {
  signal: Signal;
  reason?: string;
  diagnostics?: Record<string, DiagnosticValue>;
}

export interface StrategyContext {
  readonly symbol: string;
  readonly availableAtMs: number;
  readonly sequence: number;
}

export interface Strategy {
  readonly name: string;
  readonly id?: string;
  readonly version?: string;
  readonly sourceHash?: string;
  readonly requiredInputs?: readonly ReplayEvent["kind"][];
  readonly warmupBars?: number;
  initialize?(): void;
  finalize?(): void;
  readonly configuration?: Readonly<Record<string, DiagnosticValue>>;
  onEvent(
    event: ReplayEvent,
    context: StrategyContext,
  ): StrategyDecision | null;
}

export type StrategyFactory = () => Strategy;

export interface OrderIntent {
  kind: "order_intent";
  side: "buy" | "sell";
  quantity: number;
  limitPrice?: number;
}
