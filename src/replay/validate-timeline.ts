import { isDeepStrictEqual } from 'node:util';
import { integer } from '../data/candle-validation.js';
import { validateCandleFixture } from '../data/candle-loader.js';
import { parseFundingRate } from '../data/funding.js';
import { validateBookSnapshot } from '../data/orderbook.js';
import { compareReplayEvents, freezeDeep, type ReplayEvent } from './events.js';

// prepares and verifies events for timeline replay
export function prepareEvents(events: readonly ReplayEvent[]): readonly ReplayEvent[] {
  if (events.length === 0) {
    return [];
  }

  const first = events[0]!;

  // filter out candles and validate if any exist
  const candles = events.filter((event) => {
    return event.kind === 'candle_closed';
  });

  if (candles.length > 0) {
    const barsList = candles.map((event) => {
      return event.candle;
    });

    validateCandleFixture({
      meta: candles[0]!.provenance.meta,
      bars: barsList,
    });
  }

  // check snapshot count if orderbook
  if (first.kind === 'orderbook_snapshot') {
    if (first.provenance.meta.snapshotCount !== events.length) {
      throw new Error('Orderbook snapshot count mismatch');
    }
  }

  const seen = new Set<string>();
  const sourceCounts = {
    candle_closed: 0,
    funding_rate: 0,
    orderbook_snapshot: 0,
  };

  for (let index = 0; index < events.length; index++) {
    const event = events[index]!;

    // check ordering and provenance integrity
    const badSchema = event.schemaVersion !== 1;
    const badSequence = event.sequence !== index;
    const badSymbol = event.symbol !== first.symbol || event.symbol !== event.provenance.meta.symbol;
    const alreadySeen = seen.has(event.id);
    const outOfOrder = index > 0 && compareReplayEvents(events[index - 1]!, event) > 0;
    const provMismatch = !isDeepStrictEqual(event.provenance, first.provenance);

    if (badSchema || badSequence || badSymbol || alreadySeen || outOfOrder || provMismatch) {
      throw new Error(`Invalid replay timeline at event ${index}`);
    }

    seen.add(event.id);

    const sourceSequence = sourceCounts[event.kind]++;
    let expectedId: string;
    let eventTime: number;
    let availableAt: number;

    // branch by event type
    if (event.kind === 'candle_closed') {
      eventTime = event.candle.time + event.provenance.meta.timeframeMs;
      availableAt = eventTime;
      expectedId = `candle_closed:${event.symbol}:${event.provenance.meta.timeframe}:${event.candle.time}`;

      if (event.candleCloseMs !== eventTime) {
        throw new Error(`Invalid replay timeline candle close at ${index}`);
      }
    } else if (event.kind === 'funding_rate') {
      const model = event.provenance.funding?.availability;

      if (!model || model.model !== 'timestamp_plus_lag' || !model.assumed) {
        throw new Error('Missing funding availability assumption');
      }

      integer(model.lagMs, 'funding lagMs');
      integer(event.funding.raw.timestamp, 'funding seconds');

      eventTime = event.funding.raw.timestamp * 1000;
      availableAt = integer(eventTime + model.lagMs, 'funding availableAtMs');
      expectedId = `funding_rate:${event.symbol}:${eventTime}`;

      const rateMismatch =
        event.funding.eventTimeMs !== eventTime ||
        event.funding.availableAtMs !== availableAt ||
        event.funding.rawFundingRatePercentage !== event.funding.raw.fundingRatePercentage ||
        event.funding.fundingRatePercentage !== parseFundingRate(event.funding.rawFundingRatePercentage);

      if (rateMismatch) {
        throw new Error('Invalid funding observation');
      }
    } else if (event.kind === 'orderbook_snapshot') {
      const snapshot = validateBookSnapshot(event.snapshot);

      if (!isDeepStrictEqual(snapshot, event.snapshot)) {
        throw new Error('Invalid normalized book snapshot');
      }

      eventTime = snapshot.receiptTimeMs;
      availableAt = eventTime;
      expectedId = `orderbook_snapshot:${event.symbol}:${eventTime}`;
    } else {
      throw new Error('Unsupported replay event kind');
    }

    // final check on timestamps and identifiers
    const idMismatch = event.id !== expectedId;
    const timeMismatch = event.eventTimeMs !== eventTime || event.availableAtMs !== availableAt;
    const seqMismatch = event.sourceSequence !== sourceSequence;

    if (idMismatch || timeMismatch || seqMismatch) {
      throw new Error(`Invalid replay timeline at event ${index}`);
    }
  }

  // deep freeze and clone
  const cloned = structuredClone(events);
  return freezeDeep(cloned);
}