
import { PhoenixHttpClient } from "@ellipsis-labs/rise";
import { mkdir, writeFile } from "node:fs/promises";

const client = new PhoenixHttpClient({
  apiUrl: "https://perp-api.phoenix.trade",
});

async function main() {
  await mkdir("data/inspection", { recursive: true });

  const sources = {
    // fees, tick size, and configuration
    market: () => client.markets().getMarket("SOL"),

    // historical 1-minute candles
    candles: () =>
      client.candles().getCandles("SOL", {
        timeframe: "1m",
        limit: 10,
      }),

    // recent public market fills
    fills: () => client.trades().getMarketFills("SOL"),

    // historical funding rates
    funding: () => client.funding().getFundingRateHistory("SOL"),

    // exchange-wide metadata
    exchange: () => client.exchange().getSnapshot(),
  };

  for (const [name, fetchData] of Object.entries(sources)) {
    console.log(`\nFetching ${name}...`);

    try {
      const data = await fetchData();
      const path = `data/inspection/${name}.json`;

      await writeFile(path, JSON.stringify(data, null, 2), { flag: "wx" });

      console.log(`SUCCESS: ${name}`);
      console.log(`Saved to ${path}`);

      const preview = Array.isArray(data) ? data.slice(0, 2) : data;

      console.log(JSON.stringify(preview, null, 2).slice(0, 1200));
    } catch (error) {
      console.error(`FAILED: ${name}`, error);
    }
  }
}

main().catch(console.error);
