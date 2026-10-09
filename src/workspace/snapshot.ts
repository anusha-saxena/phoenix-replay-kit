import { z } from "zod";
import { validateCandleFixture } from "../data/candle-loader.js";
import { analyzeCoverage } from "../data/candle-validation.js";
import { datasetIdentity } from "../replay/timeline.js";
import { freezeDeep } from "../replay/events.js";

// hard limits config
export const LIMITS = {
  maxBars: 5000,
  maxPages: 5,
  maxRangeMs: 7 * 86400000,
  maxBodyBytes: 2_000_000,
  maxWarmupBars: 201,
} as const;

// schema definitions
const ms = z.number().int().min(0).max(8.64e15);

const envelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(["demo", "historical", "latest"]),
    evaluationFromMs: ms,
    evaluationToMs: ms,
    requestedWarmupBars: z.number().int().min(0).max(201),
    observedFromMs: ms,
    observedToMs: ms,
    fixture: z.unknown(),
  })
  .strict();

export function createSnapshot(
  input: unknown,
  mode: "demo" | "historical" | "latest",
  evaluationFromMs: number,
  evaluationToMs: number,
  requestedWarmupBars = 0,
) {
  // make sure fixture is valid first
  const fixture = validateCandleFixture(input);

  if (!fixture.bars.length || fixture.bars.length > LIMITS.maxBars) {
    throw new Error("Snapshot requires 1..5000 finalized candles");
  }

  // check if window bounds make sense
  if (
    evaluationFromMs >= evaluationToMs ||
    evaluationFromMs < fixture.meta.requestedFromMs ||
    evaluationToMs > fixture.meta.requestedToMs
  ) {
    throw new Error("Evaluation window must lie inside the fetched window");
  }

  const observedFrom = fixture.bars[0]!.time;
  const observedTo = fixture.bars.at(-1)!.time + fixture.meta.timeframeMs;

  const content = {
    schemaVersion: 1 as const,
    mode: mode,
    evaluationFromMs: evaluationFromMs,
    evaluationToMs: evaluationToMs,
    requestedWarmupBars: requestedWarmupBars,
    observedFromMs: observedFrom,
    observedToMs: observedTo,
    fixture: fixture,
  };

  // validate schema without id
  const schemaNoId = envelopeSchema.omit({ id: true });
  schemaNoId.parse(content);

  const finalId = datasetIdentity(content);
  const snapshotObj = {
    ...content,
    id: finalId,
  };

  return freezeDeep(snapshotObj);
}

export type Snapshot = ReturnType<typeof createSnapshot>;

export function validateSnapshot(input: unknown): Snapshot {
  const body = envelopeSchema.parse(input);

  // recreate snapshot and compare
  const result = createSnapshot(
    body.fixture,
    body.mode,
    body.evaluationFromMs,
    body.evaluationToMs,
    body.requestedWarmupBars,
  );

  if (
    result.id !== body.id ||
    result.observedFromMs !== body.observedFromMs ||
    result.observedToMs !== body.observedToMs
  ) {
    throw new Error("Snapshot content hash / observed window mismatch");
  }

  return result;
}

export function snapshotSummary(snapshot: Snapshot) {
  const fixture = snapshot.fixture;
  const metadata = {
    schemaVersion: snapshot.schemaVersion,
    id: snapshot.id,
    mode: snapshot.mode,
    evaluationFromMs: snapshot.evaluationFromMs,
    evaluationToMs: snapshot.evaluationToMs,
    requestedWarmupBars: snapshot.requestedWarmupBars,
    observedFromMs: snapshot.observedFromMs,
    observedToMs: snapshot.observedToMs,
  };

  // filter bars that fit inside the window
  const bars = fixture.bars.filter((bar) => {
    const isAfterStart = bar.time >= snapshot.evaluationFromMs;
    const isBeforeEnd = bar.time + fixture.meta.timeframeMs <= snapshot.evaluationToMs;
    return isAfterStart && isBeforeEnd;
  });

  const window = {
    symbol: fixture.meta.symbol,
    timeframe: fixture.meta.timeframe,
    requestedFromMs: snapshot.evaluationFromMs,
    requestedToMs: snapshot.evaluationToMs,
  };

  const cov = analyzeCoverage(
    [...bars],
    window,
    fixture.meta.evaluationCutoffMs,
  );

  return {
    ...metadata,
    source: fixture.meta,
    barCount: fixture.bars.length,
    evaluationBars: bars.length,
    coverage: cov,
  };
}