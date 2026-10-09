import type { Candle, CandleFixture } from "../data/types.js";
import type { FundingFixture, FundingObservation } from "../data/funding.js";
import type { BookSnapshot, OrderbookFixture } from "../data/orderbook.js";

export type DeepReadonly<T> = T extends object
  ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
  : T;

export interface CandleProvenance {
  datasetId: string;
  meta: CandleFixture["meta"];
  funding?: FundingFixture["meta"];
}
export interface BookProvenance {
  datasetId: string;
  meta: OrderbookFixture["meta"];
}
export type ReplayProvenance = DeepReadonly<CandleProvenance | BookProvenance>;

export interface MarketEventBase {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly symbol: string;
  readonly eventTimeMs: number;
  readonly availableAtMs: number;
  readonly sequence: number;
  readonly sourceSequence: number;
}
export interface CandleClosedEvent extends MarketEventBase {
  readonly kind: "candle_closed";
  readonly candle: Readonly<Candle>;
  readonly candleCloseMs: number;
  readonly provenance: DeepReadonly<CandleProvenance>;
}
export interface FundingRateEvent extends MarketEventBase {
  readonly kind: "funding_rate";
  readonly funding: DeepReadonly<FundingObservation>;
  readonly provenance: DeepReadonly<CandleProvenance>;
}
export interface OrderbookSnapshotEvent extends MarketEventBase {
  readonly kind: "orderbook_snapshot";
  readonly snapshot: DeepReadonly<BookSnapshot>;
  readonly provenance: DeepReadonly<BookProvenance>;
}
export type ReplayEvent =
  CandleClosedEvent | FundingRateEvent | OrderbookSnapshotEvent;

export const EVENT_PRIORITY: Readonly<Record<ReplayEvent["kind"], number>> =
  Object.freeze({
    funding_rate: 0,
    candle_closed: 1,
    orderbook_snapshot: 2,
  });
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function compareReplayEvents(a: ReplayEvent, b: ReplayEvent): number {
  return (
    a.availableAtMs - b.availableAtMs ||
    EVENT_PRIORITY[a.kind] - EVENT_PRIORITY[b.kind] ||
    compareText(a.symbol, b.symbol) ||
    a.sourceSequence - b.sourceSequence ||
    compareText(a.id, b.id)
  );
}
export function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}
