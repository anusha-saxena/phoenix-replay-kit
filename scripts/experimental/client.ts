import { PhoenixHttpClient } from "@ellipsis-labs/rise";
import { writeFileSync, mkdirSync } from "node:fs";

const client = new PhoenixHttpClient({
  apiUrl: "https://perp-api.phoenix.trade",
});

type Book = Awaited<ReturnType<ReturnType<PhoenixHttpClient['orderbook']>['getOrderbook']>>;
const snapshots: {
  timestamp: string;
  bids: Book['bids'];
  asks: Book['asks'];
  mid: Book['mid'];
}[] = [];

mkdirSync("data/raw", { recursive: true });

async function main() {
  console.log("Recording Phoenix SOL order book...");

  for (let i = 0; i < 60; i++) {
    try {
      const book = await client.orderbook().getOrderbook("SOL");
      snapshots.push({
        timestamp: new Date().toISOString(),
        bids: book.bids,
        asks: book.asks,
        mid: book.mid,
      });

      console.log(
        `[${i + 1}/60] Captured snapshot at ${new Date().toLocaleTimeString()}`
      );
    } catch (error) {
      console.error("Snapshot failed:", error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  writeFileSync(
    `data/raw/sol-snapshots-${Date.now()}.json`,
    JSON.stringify(snapshots, null, 2)
  );

  console.log(`Saved ${snapshots.length} snapshots!`);
}

main();