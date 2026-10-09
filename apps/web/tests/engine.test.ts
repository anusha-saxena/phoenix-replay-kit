import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getDemo, compareDemo } from "../lib/engine";
import { example } from "../lib/config";
import { POST } from "../app/api/compare/route";
import { GET } from "../app/api/demo/route";

describe("Studio uses the real shared engine", () => {
  it("reproduces the reference comparison and coverage warning", () => {
    const result = compareDemo(example);
    expect(result.report.changedDecisions).toBe(24);
    expect(result.report.unchangedDecisions).toBe(1859);
    expect(result.report.baseline.counts).toEqual({
      BUY: 22,
      SELL: 23,
      HOLD: 1838,
    });
    expect(result.report.candidate.counts).toEqual({
      BUY: 8,
      SELL: 23,
      HOLD: 1852,
    });
    expect(result.report.warnings.join(" ")).toContain("132 trailing");
    expect(getDemo().meta.integrity.coverage.trailingMissingBars).toBe(132);
  });
  it("recomputes different inputs and returns zero for identical strategies", () => {
    expect(
      compareDemo({ baseline: example.baseline, candidate: example.baseline })
        .report.changedDecisions,
    ).toBe(0);
    expect(
      compareDemo({
        ...example,
        candidate: { ...example.candidate, buyThreshold: 20 },
      }).report.diffs,
    ).not.toEqual(compareDemo(example).report.diffs);
  });
  it("is deterministic and aligns RSI diagnostics and diffs by event", () => {
    const a = compareDemo(example);
    expect(compareDemo(example)).toEqual(a);
    expect(
      a.series.baseline.slice(0, 14).every((d) => d.diagnostics?.rsi === null),
    ).toBe(true);
    for (const diff of a.report.diffs) {
      expect(a.series.baseline.find((d) => d.eventId === diff.eventId)).toEqual(
        diff.baseline,
      );
      expect(diff.timestampMs).toBe(
        diff.baseline!.candleStartMs! + getDemo().meta.timeframeMs,
      );
    }
  });
  it("keeps separate indicator traces for different periods and price fields", () => {
    const result = compareDemo({
      ...example,
      candidate: { ...example.candidate, period: 20, priceField: "markClose" },
    });
    expect(
      result.series.candidate
        .slice(0, 20)
        .every((d) => d.diagnostics?.rsi === null),
    ).toBe(true);
    expect(result.series.candidate[20]!.diagnostics?.rsi).toEqual(
      expect.any(Number),
    );
    expect(result.series.candidate[20]!.diagnostics?.rsi).not.toBe(
      result.series.baseline[20]!.diagnostics?.rsi,
    );
    expect(result.report.candidate.configuration).toMatchObject({
      period: 20,
      priceField: "markClose",
    });
  });
  it("bundles unchanged canonical prices in chronological order", () => {
    const canonical = readFileSync(
      new URL(
        "../../../data/fixtures/candles/sol-5m-1790869255065-1791474055065.json",
        import.meta.url,
      ),
    );
    const bundled = readFileSync(
      new URL("../lib/demo-fixture.json", import.meta.url),
    );
    expect(bundled.equals(canonical)).toBe(true);
    const demo = getDemo();
    expect(demo.candles).toHaveLength(1883);
    expect(
      demo.candles.every((c, i) => !i || c.time > demo.candles[i - 1]!.time),
    ).toBe(true);
    expect(demo.candles[0]).toEqual(JSON.parse(canonical.toString()).bars[0]);
  });
  it("serves actual metadata and comparison via route handlers", async () => {
    expect((await GET().json()).candles).toHaveLength(1883);
    const response = await POST(
      new Request("http://localhost/api/compare", {
        method: "POST",
        body: JSON.stringify(example),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).report.changedDecisions).toBe(24);
  });
  it.each([
    { period: 1 },
    { period: 201 },
    { period: 2.5 },
    { buyThreshold: 90 },
    { buyThreshold: "25" },
    { sellThreshold: 101 },
    { priceField: "module.ts" },
  ])("rejects invalid public configuration %j", async (invalid) => {
    const response = await POST(
      new Request("http://localhost/api/compare", {
        method: "POST",
        body: JSON.stringify({
          ...example,
          candidate: { ...example.candidate, ...invalid },
        }),
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  });
  it("rejects malformed JSON without exposing a stack", async () => {
    const response = await POST(
      new Request("http://localhost/api/compare", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("stack");
  });
});
