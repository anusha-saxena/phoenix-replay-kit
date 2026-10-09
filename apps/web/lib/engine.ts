import rawFixture from "./demo-fixture.json";
import {
  validateCandleFixture,
  createCandleReplayEvents,
  runReplay,
  createRsiCrossStrategy,
  compareReplayResults,
} from "../../../src/index.js";
import { parseConfig } from "./config";

const fixture = validateCandleFixture(rawFixture);
const events = createCandleReplayEvents(fixture);
export function getDemo() {
  return {
    meta: fixture.meta,
    datasetId: events[0]!.provenance.datasetId,
    candles: fixture.bars,
    replayStartMs: events[0]!.availableAtMs,
    replayEndMs: events.at(-1)!.availableAtMs,
  };
}
export function compareDemo(input: unknown) {
  if (!input || typeof input !== "object")
    throw new Error("Provide baseline and candidate configurations");
  const body = input as Record<string, unknown>;
  const configs = {
    baseline: parseConfig(body.baseline, "Baseline"),
    candidate: parseConfig(body.candidate, "Candidate"),
  };
  const baseline = runReplay({
    events,
    strategy: createRsiCrossStrategy({ ...configs.baseline, name: "Baseline" }),
  });
  const candidate = runReplay({
    events,
    strategy: createRsiCrossStrategy({
      ...configs.candidate,
      name: "Candidate",
    }),
  });
  return {
    configs,
    report: compareReplayResults(baseline, candidate),
    series: { baseline: baseline.decisions, candidate: candidate.decisions },
  };
}
export type DemoData = ReturnType<typeof getDemo>;
export type CompareData = ReturnType<typeof compareDemo>;
