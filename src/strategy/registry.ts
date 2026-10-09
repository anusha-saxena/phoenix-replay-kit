import { z } from "zod";
import { createRsiCrossStrategy } from "./rsi-cross.js";
import { createEmaCrossStrategy } from "./ema-cross.js";
import { createBreakoutStrategy } from "./breakout.js";
import {
  createDeclarativeStrategy,
  parseDeclarativeSpec,
} from "./declarative.js";
import type { StrategyFactory } from "./types.js";
const period = z.number().int().min(2).max(200);
const priceField = z.enum(["close", "markClose"]).default("close");
const schemas = {
  "rsi-cross": z
    .object({
      period: period.default(14),
      buyThreshold: z.number().min(0).max(100).default(30),
      sellThreshold: z.number().min(0).max(100).default(70),
      priceField,
    })
    .strict()
    .refine(
      (p) => p.buyThreshold < p.sellThreshold,
      "Buy threshold must be below sell threshold",
    ),
  "ema-cross": z
    .object({
      fastPeriod: period.default(9),
      slowPeriod: period.default(21),
      priceField,
    })
    .strict()
    .refine(
      (p) => p.fastPeriod < p.slowPeriod,
      "Fast period must be below slow period",
    ),
  breakout: z
    .object({
      lookback: period.default(20),
      bufferPercent: z.number().min(0).max(20).default(0),
      priceField,
    })
    .strict(),
};
export type BuiltinId = keyof typeof schemas;
export type StrategySelection =
  | { id: BuiltinId; params: Record<string, number | string> }
  | { id: "declarative"; spec: ReturnType<typeof parseDeclarativeSpec> };
export function listStrategies() {
  return (Object.keys(schemas) as BuiltinId[]).map((id) => ({
    id,
    version: "1",
    name: {
      "rsi-cross": "RSI threshold crossing",
      "ema-cross": "EMA crossover",
      breakout: "Prior-window breakout",
    }[id],
    description: {
      "rsi-cross":
        "Wilder RSI crosses back through oversold / overbought levels.",
      "ema-cross": "Fast EMA crosses the slow EMA; simple-average seeds.",
      breakout:
        "Close breaks the previous N closes. Repeated same-side breaks hold until the side resets.",
    }[id],
    defaults: schemas[id].parse({}),
    parameterSchema: z.toJSONSchema(schemas[id]),
    requiredInputs: ["candle_closed"],
    outputTypes: ["directional_signal"],
  }));
}
export function parseStrategySelection(input: unknown): StrategySelection {
  const body = z
    .object({
      id: z.string(),
      params: z.unknown().optional(),
      spec: z.unknown().optional(),
    })
    .strict()
    .parse(input);
  if (body.id === "declarative") {
    if (body.params !== undefined)
      throw new Error("Declarative selections use spec, not params");
    return { id: "declarative", spec: parseDeclarativeSpec(body.spec) };
  }
  if (!Object.hasOwn(schemas, body.id) || body.spec !== undefined)
    throw new Error(
      "Unknown strategy; public requests accept registered templates or declarative specs",
    );
  const id = body.id as BuiltinId;
  return { id, params: schemas[id].parse(body.params ?? {}) };
}
export function strategyFactory(input: unknown): StrategyFactory {
  const selection = parseStrategySelection(input);
  if (selection.id === "declarative")
    return createDeclarativeStrategy(selection.spec);
  const params = selection.params;
  switch (selection.id) {
    case "rsi-cross":
      return createRsiCrossStrategy(params);
    case "ema-cross":
      return createEmaCrossStrategy(params);
    case "breakout":
      return createBreakoutStrategy(params);
  }
}
