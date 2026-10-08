
import { PhoenixHttpClient } from "@ellipsis-labs/rise";

const client = new PhoenixHttpClient({
  apiUrl: "https://perp-api.phoenix.trade",
});

async function main() {
  const to = Date.now();
  const from = to - 24 * 60 * 60 * 1000;

  const response = await client.candles().getCandlesV2("SOL", {
    timeframe: "1m",
    from,
    to,
    limit: 1000,
    includePartial: false,
  });

  console.log(JSON.stringify(response, null, 2).slice(0, 5000));
}

main().catch(console.error);
