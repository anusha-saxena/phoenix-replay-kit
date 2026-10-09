import { describe, it, expect } from "vitest";
import { compareDemo } from "../lib/engine";
import { example } from "../lib/config";
import { explainDecision } from "../lib/presentation";

describe("explaining recorded strategy decisions", () => {
  it("explains the real BUY/HOLD disagreement using each decision’s diagnostics", () => {
    const diff = compareDemo(example).report.diffs[0]!;
    expect(explainDecision(diff.baseline, example.baseline)).toContain(
      "28.28 to 37.38",
    );
    expect(explainDecision(diff.baseline, example.baseline)).toContain(
      "BUY threshold of 30",
    );
    expect(explainDecision(diff.candidate, example.candidate)).toContain(
      "did not cross upward through 25",
    );
    expect(explainDecision(diff.candidate, example.candidate)).toContain(
      "generated HOLD",
    );
  });
  it("uses separate indicator values when RSI configurations differ", () => {
    const config = {
      ...example.candidate,
      period: 20,
      priceField: "markClose" as const,
    };
    const diff = compareDemo({
      ...example,
      candidate: config,
    }).report.diffs.find(
      (d) =>
        typeof d.baseline?.diagnostics?.rsi === "number" &&
        typeof d.candidate?.diagnostics?.rsi === "number",
    )!;
    expect(explainDecision(diff.baseline, example.baseline)).toContain(
      (diff.baseline!.diagnostics!.rsi as number).toFixed(2),
    );
    expect(explainDecision(diff.candidate, config)).toContain(
      (diff.candidate!.diagnostics!.rsi as number).toFixed(2),
    );
  });
  it("preserves warm-up reasons and explains skipped observations", () => {
    const decision = compareDemo(example).series.baseline[0]!;
    expect(explainDecision(decision, example.baseline)).toBe(decision.reason);
    expect(explainDecision(null, example.candidate)).toContain(
      "did not produce a decision",
    );
  });
});
