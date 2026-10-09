import { z } from "zod";
import { Ema } from "../indicators/ema.js";
import { WilderRsi } from "../indicators/rsi.js";
import type { StrategyFactory } from "./types.js";
const field = z.enum(["close", "markClose"]).default("close");
const operandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("constant"),
      value: z.number().finite().min(-1e6).max(1e6),
    })
    .strict(),
  z.object({ kind: z.literal("price"), field }).strict(),
  z
    .object({
      kind: z.literal("rsi"),
      period: z.number().int().min(2).max(200),
      field,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ema"),
      period: z.number().int().min(1).max(200),
      field,
    })
    .strict(),
]);
export type Operand = z.output<typeof operandSchema>;
export type Condition =
  | { op: "and" | "or"; conditions: Condition[] }
  | {
      op: "gt" | "lt" | "gte" | "lte" | "crossAbove" | "crossBelow";
      left: Operand;
      right: Operand;
    };
const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z
      .object({
        op: z.enum(["and", "or"]),
        conditions: z.array(conditionSchema).min(1).max(8),
      })
      .strict(),
    z
      .object({
        op: z.enum(["gt", "lt", "gte", "lte", "crossAbove", "crossBelow"]),
        left: operandSchema,
        right: operandSchema,
      })
      .strict(),
  ]),
);
export const declarativeSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    rules: z
      .array(
        z
          .object({
            when: conditionSchema,
            signal: z.enum(["BUY", "SELL", "HOLD"]),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();
export type DeclarativeSpec = z.output<typeof declarativeSchema>;
export function parseDeclarativeSpec(input: unknown): DeclarativeSpec {
  let nodes = 0;
  function visit(value: unknown, depth: number) {
    if (++nodes > 300 || depth > 12)
      throw new Error("Declarative spec exceeds 300 nodes or 12 levels");
    if (value && typeof value === "object")
      for (const item of Object.values(value)) visit(item, depth + 1);
  }
  visit(input, 0);
  return declarativeSchema.parse(input);
}
export function createDeclarativeStrategy(input: unknown): StrategyFactory {
  const spec = parseDeclarativeSpec(input);
  const operands = new Map<string, Operand>();
  let needsPrevious = false;
  function collect(condition: Condition) {
    if (condition.op === "crossAbove" || condition.op === "crossBelow")
      needsPrevious = true;
    if ("conditions" in condition) condition.conditions.forEach(collect);
    else
      for (const operand of [condition.left, condition.right])
        operands.set(JSON.stringify(operand), operand);
  }
  spec.rules.forEach((rule) => collect(rule.when));
  const warmupBars = Math.max(
    needsPrevious ? 1 : 0,
    ...[...operands.values()].map((o) =>
      "period" in o ? o.period + (o.kind === "rsi" ? 1 : 0) : 0,
    ),
  );
  return () => {
    const indicators = new Map(
      [...operands].flatMap(([key, o]) =>
        o.kind === "rsi" || o.kind === "ema"
          ? [
              [
                key,
                o.kind === "rsi" ? new WilderRsi(o.period) : new Ema(o.period),
              ] as const,
            ]
          : [],
      ),
    );
    let previous = new Map<string, number | null>();
    let count = 0;
    return {
      id: "declarative",
      version: "1",
      name: spec.name,
      requiredInputs: ["candle_closed"],
      warmupBars,
      configuration: { spec: JSON.stringify(spec) },
      onEvent(event) {
        if (event.kind !== "candle_closed") return null;
        const current = new Map<string, number | null>();
        for (const [key, o] of operands)
          current.set(
            key,
            o.kind === "constant"
              ? o.value
              : o.kind === "price"
                ? event.candle[o.field]
                : indicators.get(key)!.update(event.candle[o.field]),
          );
        function test(condition: Condition): boolean {
          if ("conditions" in condition)
            return condition.op === "and"
              ? condition.conditions.every(test)
              : condition.conditions.some(test);
          const leftKey = JSON.stringify(condition.left);
          const rightKey = JSON.stringify(condition.right);
          const a = current.get(leftKey);
          const b = current.get(rightKey);
          if (a == null || b == null) return false;
          switch (condition.op) {
            case "gt":
              return a > b;
            case "lt":
              return a < b;
            case "gte":
              return a >= b;
            case "lte":
              return a <= b;
            default: {
              const oldA = previous.get(leftKey);
              const oldB = previous.get(rightKey);
              if (oldA == null || oldB == null) return false;
              return condition.op === "crossAbove"
                ? oldA <= oldB && a > b
                : oldA >= oldB && a < b;
            }
          }
        }
        const warmup = count++ < warmupBars;
        const matched = warmup
          ? -1
          : spec.rules.findIndex((rule) => test(rule.when));
        const signal = matched < 0 ? "HOLD" : spec.rules[matched]!.signal;
        previous = current;
        return {
          signal,
          reason: warmup
            ? "Indicator warm-up"
            : matched < 0
              ? "No rule matched"
              : `Rule ${matched + 1} matched (first match wins)`,
          diagnostics: {
            warmup,
            matchedRule: matched,
            ...Object.fromEntries(current),
          },
        };
      },
    };
  };
}
