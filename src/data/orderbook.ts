import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { record } from "./candle-validation.js";

// types
export type BookLevel = readonly [price: number, quantity: number];

export interface BookSnapshot {
  timestamp: string;
  receiptTimeMs: number;
  bids: BookLevel[];
  asks: BookLevel[];
  mid: number | null;
}

export interface OrderbookFixture {
  meta: {
    schemaVersion: 1;
    kind: "orderbook";
    source: "phoenix_rise_http_sampled";
    method: "orderbook.getOrderbook";
    symbol: string;
    symbolBasis: "adapter_argument";
    timeframe: null;
    timeUnit: "ms";
    availability: "local_receipt_time";
    fidelity: "sampled_snapshots";
    snapshotCount: number;
    firstReceiptMs: number;
    lastReceiptMs: number;
    integrity: {
      outOfOrder: number;
      duplicatesRemoved: number;
      coverage?: never;
    };
  };
  snapshots: BookSnapshot[];
  rawSnapshots: unknown[];
}

// parsing the book levels
export function parseBookLevels(
  value: unknown,
  side: "bids" | "asks",
): BookLevel[] {
  if (!Array.isArray(value)) {
    throw new Error(`${side} must be an array`);
  }

  const levels: BookLevel[] = value.map((level, index) => {
    if (!Array.isArray(level) || level.length !== 2) {
      throw new Error(`${side}[${index}] must be [price, quantity]`);
    }

    const [price, quantity] = level as unknown[];

    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      throw new Error(`${side}[${index}] price must be positive`);
    }

    if (
      typeof quantity !== "number" ||
      !Number.isFinite(quantity) ||
      quantity < 0
    ) {
      throw new Error(`${side}[${index}] quantity must be nonnegative`);
    }

    return [price, quantity];
  });

  // check sorting
  for (let i = 1; i < levels.length; i++) {
    const previous = levels[i - 1]![0];
    const current = levels[i]![0];

    if (side === "bids" ? current >= previous : current <= previous) {
      throw new Error(`${side} must be strictly best-price first`);
    }
  }

  return levels;
}

export function validateBookSnapshot(value: unknown): BookSnapshot {
  const raw = record(value, "book snapshot");

  if (
    typeof raw.timestamp !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw.timestamp)
  ) {
    throw new Error("Snapshot timestamp must be a UTC ISO receipt time");
  }

  const receiptTimeMs = Date.parse(raw.timestamp);

  if (
    !Number.isSafeInteger(receiptTimeMs) ||
    receiptTimeMs < 0 ||
    new Date(receiptTimeMs).toISOString() !== raw.timestamp
  ) {
    throw new Error("Invalid book receipt timestamp");
  }

  const bids = parseBookLevels(raw.bids, "bids");
  const asks = parseBookLevels(raw.asks, "asks");

  if (bids[0] && asks[0] && bids[0][0] >= asks[0][0]) {
    throw new Error("Book is crossed or locked");
  }

  let mid = raw.mid ?? null;

  if (
    mid !== null &&
    (typeof mid !== "number" || !Number.isFinite(mid) || mid <= 0)
  ) {
    throw new Error("Invalid book mid");
  }

  if (
    typeof mid === "number" &&
    bids[0] &&
    asks[0] &&
    (mid < bids[0][0] || mid > asks[0][0])
  ) {
    throw new Error("Book mid outside best bid/ask");
  }

  return {
    timestamp: raw.timestamp,
    receiptTimeMs: receiptTimeMs,
    bids: bids,
    asks: asks,
    mid: mid as number | null,
  };
}

export function createOrderbookFixture(
  input: unknown,
  symbol: string,
): OrderbookFixture {
  // basic checks
  if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(symbol)) {
    throw new Error("Invalid orderbook symbol");
  }

  if (!Array.isArray(input) || !input.length) {
    throw new Error("Snapshots must be a nonempty array");
  }

  const parsed = input.map(validateBookSnapshot);

  // find out of order snapshots
  let outOfOrder = 0;
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i]!.receiptTimeMs < parsed[i - 1]!.receiptTimeMs) {
      outOfOrder++;
    }
  }

  // sort them in place
  parsed.sort((a, b) => {
    return a.receiptTimeMs - b.receiptTimeMs;
  });

  const snapshots: BookSnapshot[] = [];
  let duplicatesRemoved = 0;

  for (let i = 0; i < parsed.length; i++) {
    const snapshot = parsed[i]!;
    const previous = snapshots.at(-1);

    if (previous?.receiptTimeMs === snapshot.receiptTimeMs) {
      if (!isDeepStrictEqual(previous, snapshot)) {
        throw new Error("Conflicting duplicate book receipt timestamp");
      }
      duplicatesRemoved++;
    } else {
      snapshots.push(snapshot);
    }
  }

  // return the final fixture object
  return {
    meta: {
      schemaVersion: 1,
      kind: "orderbook",
      source: "phoenix_rise_http_sampled",
      method: "orderbook.getOrderbook",
      symbol: symbol,
      symbolBasis: "adapter_argument",
      timeframe: null,
      timeUnit: "ms",
      availability: "local_receipt_time",
      fidelity: "sampled_snapshots",
      snapshotCount: snapshots.length,
      firstReceiptMs: snapshots[0]!.receiptTimeMs,
      lastReceiptMs: snapshots.at(-1)!.receiptTimeMs,
      integrity: {
        outOfOrder: outOfOrder,
        duplicatesRemoved: duplicatesRemoved,
      },
    },
    snapshots: snapshots,
    rawSnapshots: structuredClone(input),
  };
}

export function validateOrderbookFixture(input: unknown): OrderbookFixture {
  const fixture = record(input, "orderbook fixture");
  const meta = record(fixture.meta, "orderbook meta");

  if (
    meta.schemaVersion !== 1 ||
    meta.kind !== "orderbook" ||
    typeof meta.symbol !== "string"
  ) {
    throw new Error("Unsupported orderbook fixture schema");
  }

  const expected = createOrderbookFixture(fixture.rawSnapshots, meta.symbol);

  if (!isDeepStrictEqual(fixture, expected)) {
    throw new Error("Orderbook fixture does not match raw snapshots");
  }

  return expected;
}

export async function loadOrderbookFixture(
  path: string,
  symbol?: string,
): Promise<OrderbookFixture> {
  try {
    const fileContents = await readFile(path, "utf8");
    const value: unknown = JSON.parse(fileContents);

    if (Array.isArray(value)) {
      if (!symbol) {
        throw new Error("Raw recordings need an explicit symbol");
      }
      return createOrderbookFixture(value, symbol);
    }

    return validateOrderbookFixture(value);
  } catch (error) {
    let msg = String(error);
    if (error instanceof Error) {
      msg = error.message;
    }
    throw new Error(`Cannot load orderbook fixture ${path}: ${msg}`);
  }
}