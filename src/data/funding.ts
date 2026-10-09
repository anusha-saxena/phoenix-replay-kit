import { readFile } from 'node:fs/promises';
import type { FundingRatePoint, FundingRateHistoryResponse } from '@ellipsis-labs/rise';
import { isDeepStrictEqual } from 'node:util';
import { integer, record } from './candle-validation.js';

export type FundingRecord = FundingRatePoint;

// types
export interface FundingObservation {
  eventTimeMs: number;
  availableAtMs: number;
  raw: FundingRecord;
  rawFundingRatePercentage: string;
  fundingRatePercentage: number;
}

export interface FundingFixture {
  meta: {
    schemaVersion: 1;
    kind: 'funding';
    symbol: string;
    marketId: number;
    source: 'phoenix_rise_http';
    method: 'funding.getFundingRateHistory';
    fetchedAtMs: number | null;
    fetchedAtKnown: boolean;
    rateUnit: 'percentage_points';
    unitBasis: 'field_name_interpretation';
    availability: { model: 'timestamp_plus_lag'; lagMs: number; assumed: true };
    recordCount: number;
    integrity: { outOfOrder: number; duplicatesRemoved: number };
    coverage: { firstEventMs: number; lastEventMs: number; requestedWindowKnown: false; complete: null };
  };
  records: FundingObservation[];
  rawSource: FundingRateHistoryResponse;
}

// helper function to parse rates
export function parseFundingRate(value: unknown): number {
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
    throw new Error('fundingRatePercentage must be a decimal string');
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error('Funding rate must be finite');
  }

  return number;
}

export function createFundingFixture(input: unknown, lagMs: number, fetchedAtMs: number | null = null): FundingFixture {
  // validation checks
  integer(lagMs, 'funding availability lagMs');

  if (fetchedAtMs !== null) {
    integer(fetchedAtMs, 'funding fetchedAtMs');
  }

  const source = record(input, 'funding response');
  const marketId = integer(source.marketId, 'funding marketId');

  if (typeof source.symbol !== 'string' || !/^[A-Z0-9][A-Z0-9_-]*$/.test(source.symbol)) {
    throw new Error('Invalid funding symbol');
  }

  if (!Array.isArray(source.rates) || !source.rates.length) {
    throw new Error('Funding rates must be a nonempty array');
  }

  // map out raw rates
  const rawRates: FundingRecord[] = source.rates.map((value, index) => {
    const row = record(value, `funding rates[${index}]`);
    const timestamp = integer(row.timestamp, 'funding timestamp (seconds)');

    integer(timestamp * 1000 + lagMs, 'funding availability (milliseconds)');
    parseFundingRate(row.fundingRatePercentage);

    return {
      timestamp: timestamp,
      fundingRatePercentage: row.fundingRatePercentage as string
    };
  });

  // count how many are out of order
  const outOfOrder = rawRates.filter((rate, index) => {
    return index > 0 && rate.timestamp < rawRates[index - 1]!.timestamp;
  }).length;

  const sorted = [...rawRates].sort((a, b) => {
    return a.timestamp - b.timestamp;
  });

  const records: FundingObservation[] = [];
  let duplicatesRemoved = 0;

  for (let i = 0; i < sorted.length; i++) {
    const raw = sorted[i]!;
    const previous = records.at(-1);

    if (previous?.raw.timestamp === raw.timestamp) {
      if (previous.rawFundingRatePercentage !== raw.fundingRatePercentage) {
        throw new Error(`Conflicting funding duplicate: ${raw.timestamp}`);
      }
      duplicatesRemoved++;
      continue;
    }

    records.push({
      eventTimeMs: raw.timestamp * 1000,
      availableAtMs: raw.timestamp * 1000 + lagMs,
      raw: { ...raw },
      rawFundingRatePercentage: raw.fundingRatePercentage,
      fundingRatePercentage: parseFundingRate(raw.fundingRatePercentage)
    });
  }

  // return the final fixture obj
  return {
    meta: {
      schemaVersion: 1,
      kind: 'funding',
      symbol: source.symbol,
      marketId: marketId,
      source: 'phoenix_rise_http',
      method: 'funding.getFundingRateHistory',
      fetchedAtMs: fetchedAtMs,
      fetchedAtKnown: fetchedAtMs !== null,
      rateUnit: 'percentage_points',
      unitBasis: 'field_name_interpretation',
      availability: {
        model: 'timestamp_plus_lag',
        lagMs: lagMs,
        assumed: true
      },
      recordCount: records.length,
      integrity: {
        outOfOrder: outOfOrder,
        duplicatesRemoved: duplicatesRemoved
      },
      coverage: {
        firstEventMs: records[0]!.eventTimeMs,
        lastEventMs: records.at(-1)!.eventTimeMs,
        requestedWindowKnown: false,
        complete: null
      }
    },
    records: records,
    rawSource: {
      marketId: marketId,
      symbol: source.symbol,
      rates: rawRates
    }
  };
}

export function validateFundingFixture(input: unknown): FundingFixture {
  const fixture = record(input, 'funding fixture');
  const meta = record(fixture.meta, 'funding meta');

  if (meta.schemaVersion !== 1 || meta.kind !== 'funding') {
    throw new Error('Unsupported funding fixture schema');
  }

  const availability = record(meta.availability, 'funding availability');
  
  let fetchedAtMsVal: number | null = null;
  if (meta.fetchedAtMs !== null) {
    fetchedAtMsVal = integer(meta.fetchedAtMs, 'fetchedAtMs');
  }

  const expected = createFundingFixture(
    fixture.rawSource,
    integer(availability.lagMs, 'lagMs'),
    fetchedAtMsVal
  );

  if (!isDeepStrictEqual(fixture, expected)) {
    throw new Error('Funding fixture metadata/records do not match raw source and availability model');
  }

  return expected;
}

export async function loadFundingFixture(path: string): Promise<FundingFixture> {
  try {
    const fileData = await readFile(path, 'utf8');
    const parsedData = JSON.parse(fileData) as unknown;
    return validateFundingFixture(parsedData);
  } catch (error) {
    let msg = String(error);
    if (error instanceof Error) {
      msg = error.message;
    }
    throw new Error(`Cannot load funding fixture ${path}: ${msg}`);
  }
}