import type { z } from "zod";
import { assertionSchema } from "../workspace/evaluate.js";
import { parseArgs } from "node:util";

// commands available
export type Command = "inspect" | "replay" | "compare";

export interface CliOptions {
  command: Command;
  data: string;
  dataKind: "candles" | "orderbook";
  funding?: string;
  symbol?: string;
  strategy?: string;
  baseline?: string;
  candidate?: string;
  format: "text" | "json";
  out?: string;
  maxRows: number;
  maxChangedDecisions?: number;
  assertions: z.output<typeof assertionSchema>;
}

// helper to parse positive ints
function nonnegativeInteger(value: string, flag: string): number {
  const number = Number(value);

  const isValidNumber = /^\d+$/.test(value) && Number.isSafeInteger(number);
  if (!isValidNumber) {
    throw new Error(`${flag} must be a nonnegative integer`);
  }

  return number;
}

// parse cli input args
export function parseCliOptions(args: string[]): CliOptions {
  const command = args[0];

  // make sure command is supported
  if (command !== "inspect" && command !== "replay" && command !== "compare") {
    throw new Error("Use inspect, replay or compare. Run --help for examples.");
  }

  const options: Record<string, { type: "string" | "boolean" }> = {
    data: { type: "string" },
    format: { type: "string" },
    out: { type: "string" },
    "data-kind": { type: "string" },
    funding: { type: "string" },
    symbol: { type: "string" },
  };

  if (command !== "inspect") {
    options["max-rows"] = { type: "string" };
    options["show-all"] = { type: "boolean" };
  }

  if (command === "replay") {
    options.strategy = { type: "string" };
  }

  if (command === "compare") {
    options.baseline = { type: "string" };
    options.candidate = { type: "string" };
    options["max-changed-decisions"] = { type: "string" };

    const assertionKeys = [
      "max-changed-percent",
      "max-changed-buy",
      "max-changed-sell",
    ];

    for (let i = 0; i < assertionKeys.length; i++) {
      const key = assertionKeys[i]!;
      options[key] = { type: "string" };
    }

    options["exact-equivalence"] = { type: "boolean" };
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: options,
    strict: true,
    tokens: true,
  });

  const values = parsed.values;
  const tokens = parsed.tokens;
  const seen = new Set<string>();

  // prevent passing duplicates
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind !== "option") {
      continue;
    }

    if (seen.has(token.name)) {
      throw new Error(`Duplicate option --${token.name}`);
    }
    seen.add(token.name);
  }

  // helper to get required string flags
  function required(key: string): string {
    const value = values[key];

    if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
      throw new Error(`Missing --${key}. Run ${command} --help for usage.`);
    }

    return value;
  }

  let formatVal = values.format;
  if (!formatVal) {
    formatVal = "text";
  }

  if (formatVal !== "text" && formatVal !== "json") {
    throw new Error("--format must be text or json");
  }

  let maxRows = 20;
  if (values["max-rows"] !== undefined) {
    const rawVal = required("max-rows");
    maxRows = nonnegativeInteger(rawVal, "--max-rows");
  }

  if (values["show-all"] && values["max-rows"] !== undefined) {
    throw new Error("Use --show-all or --max-rows, not both");
  }

  let dataKindVal = values["data-kind"];
  if (!dataKindVal) {
    dataKindVal = "candles";
  }

  if (dataKindVal !== "candles" && dataKindVal !== "orderbook") {
    throw new Error("--data-kind must be candles or orderbook");
  }

  if (dataKindVal === "orderbook" && values.funding !== undefined) {
    throw new Error("--funding requires candle input");
  }

  if (dataKindVal === "candles" && values.symbol !== undefined) {
    throw new Error("--symbol is only for raw orderbook input");
  }

  let finalRows = maxRows;
  if (values["show-all"]) {
    finalRows = Infinity;
  }

  const result: CliOptions = {
    command: command,
    assertions: {},
    data: required("data"),
    dataKind: dataKindVal as "candles" | "orderbook",
    format: formatVal as "text" | "json",
    maxRows: finalRows,
  };

  if (command === "replay") {
    result.strategy = required("strategy");
  }

  if (command === "compare") {
    result.baseline = required("baseline");
    result.candidate = required("candidate");
  }

  if (values.funding !== undefined) {
    result.funding = required("funding");
  }

  if (values.symbol !== undefined) {
    result.symbol = required("symbol");
  }

  if (values.out !== undefined) {
    result.out = required("out");
  }

  // checking comparison flags
  const flagsList = [
    ["max-changed-decisions", "maxChangedDecisions"],
    ["max-changed-percent", "maxChangedPercent"],
    ["max-changed-buy", "maxChangedBuy"],
    ["max-changed-sell", "maxChangedSell"],
  ] as const;

  for (let i = 0; i < flagsList.length; i++) {
    const flag = flagsList[i]![0];
    const key = flagsList[i]![1];

    if (values[flag] !== undefined) {
      const raw = required(flag);
      if (!/^\d+(?:\.\d+)?$/.test(raw)) {
        throw new Error(`--${flag} must be numeric`);
      }

      if (key === "maxChangedDecisions") {
        result.assertions[key] = nonnegativeInteger(raw, `--${flag}`);
      } else {
        result.assertions[key] = Number(raw);
      }
    }
  }

  if (values["exact-equivalence"]) {
    result.assertions.exactEquivalence = true;
  }

  result.assertions = assertionSchema.parse(result.assertions);

  if (result.assertions.maxChangedDecisions !== undefined) {
    result.maxChangedDecisions = result.assertions.maxChangedDecisions;
  }

  return result;
}

// help message text
export const HELP = `Strategy Replay Kit built on Phoenix Rise SDK — offline strategy regression testing

Usage:
  phoenix-replay inspect --data PATH
  phoenix-replay replay --data PATH --strategy LOCAL_MODULE
  phoenix-replay compare --data PATH --baseline LOCAL_MODULE --candidate LOCAL_MODULE

Options:
  --data-kind candles|orderbook   Default: candles
  --funding PATH                 Funding fixture with explicit availability model
  --symbol SOL                   Required for raw sampled-book arrays
  --format text|json              Default: text
  --out PATH                      Save report; refuses existing files
  --max-rows N                    Display first N rows (default: 20)
  --show-all                      Display every changed/non-HOLD decision
  --max-changed-decisions N        Compare assertion: exit 1 if exceeded
  --help                          Show usage
  --version                       Show package version

Example (run from the project directory):
  npm run phoenix -- compare \\
    --data data/fixtures/candles/sol-5m-1790869255065-1791474055065.json \\
    --baseline strategies/rsi-v1.ts --candidate strategies/rsi-v2.ts

Workspace commands:
  phoenix-replay strategies                         Discover templates and schemas
  phoenix-replay capabilities                       Discover current Phoenix markets
  phoenix-replay fetch --request request.json --out snapshot.json
  phoenix-replay workspace --manifest manifest.json --out report.json

Replay/compare --strategy/--baseline/--candidate also accept registered strategy IDs.
Compare also supports --max-changed-percent N, --max-changed-buy N,
--max-changed-sell N and --exact-equivalence (exit 1 on failure).

Strategies must default-export a synchronous factory creating fresh state.
Development: .ts through tsx; built CLI: .js/.mjs plug-ins.
Only import trusted local code. Exit codes: 0 success, 1 regression, 2 error.
JSON always contains all differences; row limits affect text only.`;