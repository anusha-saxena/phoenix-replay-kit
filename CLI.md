# Phoenix Replay Kit CLI

Use the CLI to inspect saved market data, replay a strategy, and compare two strategy versions against the same events. It reports BUY, SELL, and HOLD decisions; it does not place trades, simulate fills, or calculate P&L.

## Setup

Use Node.js 22.18+, 24, or 26 (supported versions). From the `phoenix-replay-kit/` directory:

```bash
npm ci
npm run build
node dist/src/cli.js --help
```

The examples below use the bundled historical SOL-PERP dataset:

```bash
DATA=data/fixtures/candles/sol-5m-1790869255065-1791474055065.json
```

## Compare two strategies

Compare the original RSI threshold of 30 with the updated threshold of 25:

```bash
node dist/src/cli.js compare --data "$DATA" \
  --baseline dist/strategies/rsi-v1.js \
  --candidate dist/strategies/rsi-v2.js \
  --max-rows 5
```

The bundled example produces **24 changed decisions and 1,859 unchanged decisions** across 1,883 candle events. The report shows counts, disagreement timestamps, and each strategy's recorded diagnostics.

A change means different signals or a decision missing from one version. Differences in explanation text alone do not count as decision changes.

## Inspect data or replay one strategy

```bash
# Inspect metadata, timing, and coverage warnings
node dist/src/cli.js inspect --data "$DATA"

# Replay a single strategy
node dist/src/cli.js replay --data "$DATA" \
  --strategy dist/strategies/rsi-v1.js
```

The bundled dataset has 132 missing trailing five-minute candles. Replay uses available finalized candles without filling missing data.

## Export JSON

Add `--format json` and `--out` to an inspect, replay, or compare command:

```bash
node dist/src/cli.js compare --data "$DATA" \
  --baseline dist/strategies/rsi-v1.js \
  --candidate dist/strategies/rsi-v2.js \
  --format json --out reports/comparison.json
```

JSON includes every difference. `--max-rows` limits text output only. Existing output files are not overwritten; choose a new filename for another export.

## Check for regressions

Set an allowed number of changed decisions:

```bash
node dist/src/cli.js compare --data "$DATA" \
  --baseline dist/strategies/rsi-v1.js \
  --candidate dist/strategies/rsi-v2.js \
  --max-changed-decisions 0
```

This example exits with code `1`, because the strategies differ at 24 events. Comparing the same strategy on both sides produces zero changes.

| Exit code | Meaning |
| --- | --- |
| `0` | Completed successfully and passed any comparison limits |
| `1` | A comparison limit was exceeded |
| `2` | Invalid arguments, strategy, or data |

Additional comparison limits: `--max-changed-percent`, `--max-changed-buy`, `--max-changed-sell`, and `--exact-equivalence`.

## Replay a Developer Workspace export

Download a **replay manifest** from the [Developer Workspace](https://phoenix-replay-kit.vercel.app/workspace), then run:

```bash
node dist/src/cli.js workspace \
  --manifest /path/to/phoenix-replay-manifest.json \
  --out reports/workspace-replay.json
```

The manifest includes the snapshot and strategy configuration needed to reproduce the replay offline. A comparison-report JSON download is a different artifact; use the replay manifest for this command.

## Strategies and useful options

```bash
# List built-in strategy templates and their configuration schemas
node dist/src/cli.js strategies

# Run a trusted local TypeScript strategy during development
npm run phoenix -- replay --data "$DATA" --strategy strategies/rsi-v1.ts
```

Custom strategies default-export a synchronous factory that creates fresh state for each replay. The built CLI loads `.js` and `.mjs` modules; TypeScript modules use the development command above. Local strategy modules execute code, so use trusted files.

| Option | Purpose |
| --- | --- |
| `--max-rows N` | Limit displayed rows; default is 20 |
| `--show-all` | Show every changed or non-HOLD decision; use instead of `--max-rows` |
| `--format text\|json` | Choose output format; default is text |
| `--out PATH` | Save output to a new file |
| `--funding PATH` | Add a funding fixture to candle replay with explicit timing assumptions |
| `--data-kind orderbook` | Use a sampled order-book fixture instead of candles |
| `--symbol SOL` | Supply the symbol for a raw order-book array |

Inspect, replay, and compare use saved data offline. `capabilities` and `fetch` retrieve new Phoenix market data and require network access. Run `node dist/src/cli.js --help` for command usage, and see [the project README](README.md) for the overview.
