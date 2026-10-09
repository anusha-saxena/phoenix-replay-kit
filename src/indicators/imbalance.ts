import type { BookLevel } from "../data/orderbook.js";

// calculate imbalance between bids and asks
export function orderbookImbalance(
  bids: readonly BookLevel[],
  asks: readonly BookLevel[],
  topLevels = 5,
): number {
  // make sure topLevels makes sense
  if (!Number.isSafeInteger(topLevels) || topLevels < 1) {
    throw new Error("topLevels must be a positive integer");
  }

  // helper to sum depth
  const depth = (levels: readonly BookLevel[]) => {
    let sum = 0;
    const sliced = levels.slice(0, topLevels);
    for (let i = 0; i < sliced.length; i++) {
      const level = sliced[i]!;
      sum = sum + level[1];
    }
    return sum;
  };

  const bid = depth(bids);
  const ask = depth(asks);

  const total = bid + ask;
  if (!Number.isFinite(total)) {
    throw new Error("Orderbook depth overflow");
  }

  if (total === 0) {
    return 0;
  }

  const diff = bid - ask;
  return diff / total;
}