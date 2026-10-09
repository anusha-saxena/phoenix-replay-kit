import type { CandleFixture } from "../data/types.js";
import {
  validateFundingFixture,
  type FundingFixture,
} from "../data/funding.js";
import {
  validateOrderbookFixture,
  type OrderbookFixture,
} from "../data/orderbook.js";
import { createCandleReplayEvents, datasetIdentity } from "./timeline.js";
import {
  compareReplayEvents,
  freezeDeep,
  type ReplayEvent,
  type OrderbookSnapshotEvent,
} from "./events.js";

// converts candle and funding fixtures into a merged list of replay events
export function createFundingReplayEvents(
  candles: CandleFixture,
  input: FundingFixture,
): readonly ReplayEvent[] {
  const funding = validateFundingFixture(input);
  const candleEvents = createCandleReplayEvents(candles);

  // make sure symbols match up
  if (candles.meta.symbol !== funding.meta.symbol) {
    throw new Error("Candle/funding symbol mismatch");
  }

  const provenance = freezeDeep({
    datasetId: datasetIdentity({
      candleDataset: candleEvents[0]!.provenance.datasetId,
      funding: funding,
    }),
    meta: structuredClone(candleEvents[0]!.provenance.meta),
    funding: structuredClone(funding.meta),
  });

  const lastCandleClose = candleEvents.at(-1)!.availableAtMs;

  const events: ReplayEvent[] = [];

  // copy candle events with updated provenance
  for (let i = 0; i < candleEvents.length; i++) {
    const event = candleEvents[i]!;
    events.push({
      ...event,
      provenance: provenance,
    });
  }

  // filter and push funding rates
  const filteredRates = funding.records.filter((rate) => {
    return rate.availableAtMs <= lastCandleClose;
  });

  for (let index = 0; index < filteredRates.length; index++) {
    const rate = filteredRates[index]!;
    const rateId = `funding_rate:${funding.meta.symbol}:${rate.eventTimeMs}`;

    events.push({
      kind: "funding_rate",
      schemaVersion: 1,
      id: rateId,
      symbol: funding.meta.symbol,
      eventTimeMs: rate.eventTimeMs,
      availableAtMs: rate.availableAtMs,
      sequence: 0,
      sourceSequence: index,
      funding: structuredClone(rate),
      provenance: provenance,
    });
  }

  // sort timeline
  events.sort(compareReplayEvents);

  // update sequences
  const sequencedEvents = events.map((event, sequence) => {
    return {
      ...event,
      sequence: sequence,
    };
  });

  return freezeDeep(sequencedEvents);
}

// turns orderbook fixture into replay events
export function createOrderbookReplayEvents(
  input: OrderbookFixture,
): readonly OrderbookSnapshotEvent[] {
  const fixture = validateOrderbookFixture(input);

  const provenance = freezeDeep({
    datasetId: datasetIdentity(fixture),
    meta: structuredClone(fixture.meta),
  });

  const events: OrderbookSnapshotEvent[] = [];

  for (let index = 0; index < fixture.snapshots.length; index++) {
    const snapshot = fixture.snapshots[index]!;
    const snapshotId = `orderbook_snapshot:${fixture.meta.symbol}:${snapshot.receiptTimeMs}`;

    events.push({
      kind: "orderbook_snapshot" as const,
      schemaVersion: 1 as const,
      id: snapshotId,
      symbol: fixture.meta.symbol,
      eventTimeMs: snapshot.receiptTimeMs,
      availableAtMs: snapshot.receiptTimeMs,
      sequence: index,
      sourceSequence: index,
      snapshot: structuredClone(snapshot),
      provenance: provenance,
    });
  }

  return freezeDeep(events);
}