import type { PhoenixHttpClient } from "@ellipsis-labs/rise";
import sdkPackage from "@ellipsis-labs/rise/package.json" with { type: "json" };
import { z } from "zod";
import {
  collectCandles,
  API_URL,
  type CandleFetcher,
} from "../data/collect-candles.js";
import { parseTimeframe } from "../data/candle-validation.js";
import { createSnapshot, LIMITS, type Snapshot } from "./snapshot.js";

// zod validation for requests
export const dataRequestSchema = z
  .object({
    mode: z.enum(["historical", "latest"]),
    symbol: z.string().min(1).max(32),
    timeframe: z.enum(["1m", "5m", "1h"]),
    fromMs: z.number().int().min(0).optional(),
    toMs: z.number().int().min(0).optional(),
    durationMs: z.number().int().positive().max(LIMITS.maxRangeMs).optional(),
    warmupBars: z.number().int().min(0).max(LIMITS.maxWarmupBars).default(0),
    refresh: z.boolean().default(false),
  })
  .strict();

export type DataRequest = z.input<typeof dataRequestSchema>;

// custom error wrapper
export class DataError extends Error {
  code: "UPSTREAM" | "TIMEOUT" | "UNSUPPORTED" | "BUSY" | "TOO_LARGE";

  constructor(
    code: "UPSTREAM" | "TIMEOUT" | "UNSUPPORTED" | "BUSY" | "TOO_LARGE",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

// simple timeout helper
export async function within<T>(
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeoutPromise = new Promise<never>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new DataError(
            "TIMEOUT",
            "Phoenix request timed out; retry or choose a smaller window",
          ),
        );
      }, Math.max(1, timeoutMs));
    });

    return await Promise.race([task, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

// helper to build client
async function createClient() {
  const { PhoenixHttpClient } = await import("@ellipsis-labs/rise");

  class BoundedClient extends PhoenixHttpClient {
    override async fetch(
      ...args: Parameters<PhoenixHttpClient["fetch"]>
    ): Promise<Response> {
      const response = await super.fetch(...args);
      const reader = response.body?.getReader();

      if (!reader) {
        return response;
      }

      const chunks: Uint8Array[] = [];
      let size = 0;

      const read = async () => {
        while (true) {
          const part = await reader.read();
          if (part.done) {
            break;
          }

          size += part.value.byteLength;
          if (size > 2_000_000) {
            throw new DataError("UPSTREAM", "Phoenix response exceeds 2 MB");
          }
          chunks.push(part.value);
        }

        return new Response(Buffer.concat(chunks), {
          status: response.status,
          headers: response.headers,
        });
      };

      try {
        return await within(read(), 1000);
      } finally {
        await reader.cancel().catch(() => {
          // ignore error on cancel
          return undefined;
        });
      }
    }
  }

  const client = new BoundedClient({
    apiUrl: API_URL,
    timeout: 2500,
    auth: false,
    rateLimitRetry: {
      maxRetries: 1,
      maxTotalWaitMs: 500,
      fallbackDelayMs: 250,
    },
    rateLimitCooldown: false,
  });

  return client;
}

export interface DataSource {
  markets(): Promise<{ symbol: string; marketStatus: string }[]>;
  candles: CandleFetcher;
}

export function phoenixSource(): DataSource {
  let instance: Promise<PhoenixHttpClient> | undefined;

  const sdk = () => {
    if (!instance) {
      instance = createClient();
    }
    return instance;
  };

  return {
    markets: async () => {
      const client = await sdk();
      return client.markets().getMarkets();
    },
    candles: async (symbol, query) => {
      const client = await sdk();
      return client.candles().getCandlesV2(symbol, query);
    },
  };
}

// collector class with cache
export class SnapshotCollector {
  private cache = new Map<string, { expires: number; snapshot: Snapshot }>();
  private active = 0;
  private pending = new Map<string, Promise<Snapshot>>();

  constructor(
    private source: DataSource,
    private now: () => number = Date.now,
  ) {}

  async collect(input: unknown): Promise<Snapshot> {
    const request = dataRequestSchema.parse(input);
    const now = this.now();
    const step = parseTimeframe(request.timeframe);

    // check modes
    if (
      request.mode === "latest" &&
      (request.fromMs !== undefined ||
        request.toMs !== undefined ||
        request.durationMs === undefined)
    ) {
      throw new Error("Latest requires durationMs, without fromMs/toMs");
    }

    if (
      request.mode === "historical" &&
      (request.fromMs === undefined ||
        request.toMs === undefined ||
        request.durationMs !== undefined)
    ) {
      throw new Error("Historical requires fromMs/toMs, without durationMs");
    }

    let to = 0;
    let from = 0;

    if (request.mode === "latest") {
      to = Math.floor(now / step) * step;
      from = to - request.durationMs!;
    } else {
      to = request.toMs!;
      from = request.fromMs!;
    }

    const fetchFrom = Math.ceil(from / step) * step - request.warmupBars * step;

    if (from < 0 || fetchFrom < 0 || from >= to || to > now) {
      throw new Error("Choose a past UTC window with from before to");
    }

    if (
      to - from > LIMITS.maxRangeMs ||
      Math.ceil((to - fetchFrom) / step) > LIMITS.maxBars
    ) {
      throw new Error(
        "Window exceeds the app limit: 7 days / 5000 bars including warm-up",
      );
    }

    const key = JSON.stringify({
      symbol: request.symbol,
      timeframe: request.timeframe,
      from: from,
      to: to,
      warmup: request.warmupBars,
    });

    const cached = this.cache.get(key);
    if (
      request.mode === "historical" &&
      !request.refresh &&
      cached &&
      cached.expires > now
    ) {
      return cached.snapshot;
    }

    const existing = this.pending.get(key);
    if (existing && request.mode === "historical" && !request.refresh) {
      return existing;
    }

    if (this.active >= 3) {
      throw new DataError("BUSY", "Data collection is busy; retry shortly");
    }

    const fetch = async () => {
      const deadline = Date.now() + 25000;

      try {
        const timeoutLeft = Math.min(5000, deadline - Date.now());
        const markets = await within(this.source.markets(), timeoutLeft);

        const found = markets.some((m) => {
          return m.symbol === request.symbol;
        });

        if (!found) {
          throw new DataError(
            "UNSUPPORTED",
            "Choose a canonical symbol from Phoenix market discovery",
          );
        }

        let rawBars = 0;

        const fixture = await collectCandles(
          async (symbol, query) => {
            if (Date.now() >= deadline) {
              throw new DataError(
                "TIMEOUT",
                "Phoenix collection exceeded 25 seconds",
              );
            }

            const page = await within(
              this.source.candles(symbol, query),
              Math.min(5000, deadline - Date.now()),
            );

            rawBars += page.bars.length;

            if (page.bars.length > 1000 || rawBars > LIMITS.maxBars) {
              throw new DataError(
                "UPSTREAM",
                "Upstream exceeded the requested bar limit",
              );
            }

            return page;
          },
          {
            symbol: request.symbol,
            timeframe: request.timeframe,
            requestedFromMs: fetchFrom,
            requestedToMs: to,
          },
          sdkPackage.version,
          now,
          LIMITS.maxPages,
        );

        const snapshot = createSnapshot(
          fixture,
          request.mode,
          from,
          to,
          request.warmupBars,
        );

        // manage cache size
        if (request.mode === "historical") {
          if (this.cache.size >= 8) {
            const firstKey = this.cache.keys().next().value!;
            this.cache.delete(firstKey);
          }
          this.cache.set(key, {
            expires: this.now() + 300000,
            snapshot: snapshot,
          });
        }

        return snapshot;
      } catch (error) {
        if (error instanceof DataError) {
          throw error;
        }

        let message = "";
        if (error instanceof Error) {
          message = error.message;
        }

        let code: "TIMEOUT" | "UPSTREAM" = "UPSTREAM";
        if (/abort|timeout/i.test(message)) {
          code = "TIMEOUT";
        }

        let errText = "Phoenix data request failed; retry or choose another window";
        if (/No finalized/.test(message)) {
          errText = "Phoenix returned no finalized candles for this window";
        }

        throw new DataError(code, errText);
      }
    };

    this.active++;
    const task = fetch();
    this.pending.set(key, task);

    try {
      return await task;
    } finally {
      this.active--;
      if (this.pending.get(key) === task) {
        this.pending.delete(key);
      }
    }
  }
}

export const snapshotCollector = new SnapshotCollector(phoenixSource());

// market cache storage
let marketCache:
  | { expires: number; markets: Awaited<ReturnType<DataSource["markets"]>> }
  | undefined;
let marketRequest: ReturnType<DataSource["markets"]> | undefined;

async function currentMarkets() {
  if (marketCache && marketCache.expires > Date.now()) {
    return marketCache.markets;
  }

  if (marketRequest) {
    return marketRequest;
  }

  marketRequest = within(phoenixSource().markets(), 5000);

  try {
    const markets = await marketRequest;
    marketCache = {
      markets: markets,
      expires: Date.now() + 60000,
    };
    return markets;
  } finally {
    marketRequest = undefined;
  }
}

// capabilities discovery endpoint
export async function discoverCapabilities() {
  try {
    const markets = await currentMarkets();

    const formattedMarkets = markets
      .map((m) => {
        return {
          symbol: m.symbol,
          status: m.marketStatus,
        };
      })
      .sort((a, b) => {
        return a.symbol.localeCompare(b.symbol);
      });

    return {
      venue: "Phoenix perpetuals",
      source: API_URL,
      sdkPackage: "@ellipsis-labs/rise",
      sdkVersion: sdkPackage.version,
      markets: formattedMarkets,
      timeframes: ["1m", "5m", "1h"],
      limits: LIMITS,
      timeUnit: "milliseconds",
      timezone: "UTC",
      dataTypes: [
        { id: "candles", supported: true },
        {
          id: "funding",
          supported: false,
          reason:
            "Offline fixture CLI only; explicit publication-lag assumptions required",
        },
        {
          id: "orderbook",
          supported: false,
          reason:
            "Offline sampled snapshots CLI only; historical L2 reconstruction unavailable",
        },
        {
          id: "trades",
          supported: false,
          reason: "Not integrated as replay input",
        },
        {
          id: "spot",
          supported: false,
          reason: "This adapter uses Phoenix perpetuals, not spot",
        },
      ],
      freshness:
        "Latest fetches recent finalized candles. No live streaming. Retention is not guaranteed.",
      discoveredAtMs: Date.now(),
    };
  } catch {
    throw new DataError(
      "UPSTREAM",
      "Phoenix market discovery failed; retry shortly",
    );
  }
}