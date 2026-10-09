import { it, expect } from "vitest";
import {
  SnapshotCollector,
  type DataSource,
} from "../../src/workspace/phoenix-data.js";
import { syntheticFixture } from "../helpers/synthetic-fixture.js";
const fixture = syntheticFixture(Array.from({ length: 80 }, (_, i) => 100 + i));
const step = fixture.meta.timeframeMs;
const request = {
  mode: "historical",
  symbol: "SOL",
  timeframe: "5m",
  fromMs: fixture.bars[25]!.time,
  toMs: fixture.meta.requestedToMs,
  warmupBars: 25,
};
function source(): DataSource {
  return {
    markets: async () => [{ symbol: "SOL", marketStatus: "active" }],
    candles: async (_symbol, query) => {
      if (!("from" in query)) throw new Error("Unexpected cursor");
      return {
        symbol: "SOL",
        timeframe: "5m",
        from: query.from!,
        to: query.to!,
        bars: fixture.bars.filter(
          (b) => b.time >= query.from! && b.time < query.to!,
        ),
        page: { hasMore: false },
      };
    },
  };
}
it("collects the SDK window, coalesces historical requests, caches briefly, and refreshes latest snapshots", async () => {
  let now = fixture.meta.requestedToMs + step;
  let calls = 0;
  const sdk = source();
  const fetch = sdk.candles;
  sdk.candles = async (...args) => {
    calls++;
    return fetch(...args);
  };
  const collector = new SnapshotCollector(sdk, () => now);
  const [a, b] = await Promise.all([
    collector.collect(request),
    collector.collect(request),
  ]);
  expect(a.id).toBe(b.id);
  expect(calls).toBe(1);
  expect(a.fixture.bars.length).toBe(80);
  expect((await collector.collect(request)).id).toBe(a.id);
  expect(calls).toBe(1);
  now += 1;
  expect((await collector.collect({ ...request, refresh: true })).id).not.toBe(
    a.id,
  );
  expect(calls).toBe(2);
  const latest = {
    mode: "latest",
    symbol: "SOL",
    timeframe: "5m",
    durationMs: 10 * step,
    warmupBars: 5,
  };
  const c = await collector.collect(latest);
  now += 1;
  const d = await collector.collect(latest);
  expect(c.id).not.toBe(d.id);
  expect(c.mode).toBe("latest");
});
it("rejects invalid windows and unknown canonical symbols without substituting a demo fixture", async () => {
  const collector = new SnapshotCollector(
    source(),
    () => fixture.meta.requestedToMs + step,
  );
  for (const input of [
    { ...request, toMs: request.fromMs },
    { ...request, timeframe: "3m" },
    { ...request, fromMs: request.toMs - 8 * 86400000 },
    { ...request, toMs: request.toMs + 100 * step },
    { ...request, symbol: "SOL-PERP" },
    { ...request, datatype: "spot" },
  ])
    await expect(collector.collect(input)).rejects.toThrow();
  const unavailable = source();
  unavailable.candles = async () => {
    throw new Error("network");
  };
  await expect(
    new SnapshotCollector(unavailable, () => request.toMs).collect(request),
  ).rejects.toThrow("Phoenix data request failed");
});
it("normalizes pagination, out-of-order duplicates, nonfinal bars and reports missing buckets", async () => {
  const sdk = source();
  let page = 0;
  sdk.candles = async () => ({
    symbol: "SOL",
    timeframe: "5m",
    from: fixture.meta.requestedFromMs,
    to: fixture.meta.requestedToMs,
    bars:
      ++page === 1
        ? [fixture.bars[1]!, fixture.bars[0]!, fixture.bars[1]!]
        : [fixture.bars[3]!, { ...fixture.bars[4]!, isFinal: false }],
    page:
      page === 1 ? { hasMore: true, nextCursor: "next" } : { hasMore: false },
  });
  const data = await new SnapshotCollector(sdk, () => request.toMs).collect(
    request,
  );
  expect(data.fixture.bars.map((b) => b.time)).toEqual(
    [0, 1, 3].map((i) => fixture.bars[i]!.time),
  );
  expect(data.fixture.meta.integrity.duplicatesRemoved).toBe(1);
  expect(data.fixture.meta.integrity.excludedNonFinal).toBe(1);
  expect(data.fixture.meta.integrity.coverage.internalMissingBars).toBe(1);
});
it("rejects empty pages, cyclic cursors, malformed responses and incompatible market casing", async () => {
  for (const variant of ["empty", "cycle", "wrong-symbol"] as const) {
    const sdk = source();
    sdk.candles = async () => ({
      symbol: variant === "wrong-symbol" ? "sol" : "SOL",
      timeframe: "5m",
      from: fixture.meta.requestedFromMs,
      to: fixture.meta.requestedToMs,
      bars: variant === "empty" ? [] : [fixture.bars[0]!],
      page:
        variant === "cycle"
          ? { hasMore: true, nextCursor: "same" }
          : { hasMore: false },
    });
    await expect(
      new SnapshotCollector(sdk, () => request.toMs).collect(request),
    ).rejects.toThrow();
  }
});
it("preserves mixed-case canonical market identifiers returned by the SDK", async () => {
  const sdk = source();
  sdk.markets = async () => [{ symbol: "kBONK", marketStatus: "active" }];
  const fetch = sdk.candles;
  sdk.candles = async (...args) => ({
    ...(await fetch(...args)),
    symbol: "kBONK",
  });
  const data = await new SnapshotCollector(sdk, () => request.toMs).collect({
    ...request,
    symbol: "kBONK",
  });
  expect(data.fixture.meta.symbol).toBe("kBONK");
});

it("reports bounded timeouts instead of hanging an SDK operation", async () => {
  const { within } = await import("../../src/workspace/phoenix-data.js");
  await expect(within(new Promise<never>(() => {}), 5)).rejects.toMatchObject({
    code: "TIMEOUT",
  });
});

it("uses the installed SDK candle method and bounds its 429 retry (mock transport, no network)", async () => {
  const { vi } = await import("vitest");
  const { phoenixSource } = await import("../../src/workspace/phoenix-data.js");
  let requests = 0;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) => {
      expect(String(url)).toContain("/v1/candles_v2/SOL");
      if (++requests === 1)
        return Response.json(
          { error: "rate_limited" },
          { status: 429, headers: { "Retry-After": "0" } },
        );
      return Response.json({
        symbol: "SOL",
        timeframe: "5m",
        from: fixture.meta.requestedFromMs,
        to: fixture.meta.requestedToMs,
        bars: fixture.bars.slice(0, 2),
        page: { hasMore: false },
      });
    });
  try {
    const response = await phoenixSource().candles("SOL", {
      timeframe: "5m",
      from: fixture.meta.requestedFromMs,
      to: fixture.meta.requestedToMs,
      includePartial: false,
      limit: 1000,
    });
    expect(response.bars).toHaveLength(2);
    expect(requests).toBe(2);
  } finally {
    fetch.mockRestore();
  }
});
