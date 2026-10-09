# Phoenix Replay Kit

**Change your strategy. Replay the same market data. See which decisions changed.**

A TypeScript library, CLI, and interactive web app for **deterministic trading-strategy replay and regression testing**, built using historical market data collected through the Ellipsis Labs Phoenix Rise SDK.

Run an original and updated strategy against the same saved market data, compare their BUY / SELL / HOLD decisions, and inspect exactly where their behavior differs.

**[Try the live demo](https://phoenix-replay-kit.vercel.app)** · **[Developer Workspace](https://phoenix-replay-kit.vercel.app/workspace)**

## Why this exists

Small changes to a trading strategy can cause unexpected changes in its decisions. Reviewing the code alone doesn't always reveal where those differences occur.

Phoenix Replay Kit makes those changes reproducible and inspectable by running both strategy versions against identical historical inputs.

For example, changing an RSI buy threshold from **30 to 25** produces **24 changed decisions across 1,883 SOL-PERP candle events** in the included dataset.

You can inspect each disagreement, see the indicator values behind it, and use comparison thresholds to detect regressions in CI.

## Try it locally

**Requirements:** Node.js 22.18+, 24, or 26 (supported versions).

From the `phoenix-replay-kit/` directory:

```bash
npm ci
npm run web:dev
```

Open [http://localhost:3000](http://localhost:3000).

| Interface | What you can do |
| --- | --- |
| [Interactive Demo](/) | Adjust RSI thresholds, compare strategy decisions, explore historical charts, and download results. |
| [Developer Workspace](/workspace) | Test RSI, EMA crossover, breakout, and declarative strategies. Run or compare strategies and export replay manifests. |

The included datasets support offline replay. Fetching new Phoenix market data requires network access.

## Command-line usage

Build the CLI and compare the included RSI strategies:

```bash
npm run build

DATA=data/fixtures/candles/sol-5m-1790869255065-1791474055065.json

node dist/src/cli.js compare --data "$DATA" \
  --baseline dist/strategies/rsi-v1.js \
  --candidate dist/strategies/rsi-v2.js \
  --max-rows 3
```

### Example results

Using the included SOL-PERP dataset:

| Decision | Original: RSI 30 | Updated: RSI 25 |
| --- | ---: | ---: |
| BUY | 22 | 8 |
| SELL | 23 | 23 |
| HOLD | 1,838 | 1,852 |

**24 changed decisions · 1,859 unchanged decisions**

The comparison counts disagreements at individual events, so the number of changed decisions can differ from the difference in total BUY signals.

### Other commands

```bash
# Inspect a dataset and its coverage
node dist/src/cli.js inspect --data "$DATA"

# Replay a single strategy
node dist/src/cli.js replay --data "$DATA" \
  --strategy dist/strategies/rsi-v1.js

# Discover built-in strategies
npm run phoenix -- strategies

# View available CLI options
node dist/src/cli.js --help
```

To export a full comparison report, add:

```bash
--format json --out reports/comparison.json
```

Existing report files are not overwritten.

## Catch regressions in CI

Use a comparison budget to enforce expected behavior:

```bash
node dist/src/cli.js compare --data "$DATA" \
  --baseline dist/strategies/rsi-v1.js \
  --candidate dist/strategies/rsi-v2.js \
  --max-changed-decisions 0
```

When no decision changes are expected, `--max-changed-decisions 0` makes unexpected differences fail the check.

| Exit code | Meaning |
| --- | --- |
| `0` | Comparison completed and passed any configured budget |
| `1` | Comparison exceeded the allowed decision-change budget |
| `2` | Invalid command, configuration, or input data |

Without a configured budget, strategy differences are reported without failing the command.

Signals and missing decisions count as changes. Differences in explanation text alone do not. Data-quality warnings are reported separately.

## Bring your own strategy

Phoenix Replay Kit supports custom strategies through a TypeScript strategy interface.

A custom strategy default-exports a factory that creates fresh strategy state for each replay.

Start with:

`examples/custom-ema-strategy.ts`

During development, use `npm run phoenix -- ...` to work with TypeScript strategy modules. The built CLI loads JavaScript (`.js` / `.mjs`) modules.

Built-in strategy examples include RSI threshold crossing, EMA crossover, breakout rules, funding-filtered RSI, and order-book imbalance.

## How it works

1. **Collect data.** Historical Phoenix market data is collected through the Rise SDK and saved as reproducible fixtures.
2. **Replay strategies.** The TypeScript replay engine processes the same ordered data through independent strategy instances.
3. **Compare decisions.** The comparison engine matches events and identifies BUY / SELL / HOLD disagreements.
4. **Inspect and test.** The web app explains differences interactively, while the CLI supports automated regression checks.

The CLI and web app reuse the same core replay and comparison logic.

## Data provenance and limitations

The included datasets support repeatable experiments, but they have important coverage and timing limitations.

- **Candles:** The included SOL-PERP dataset contains 1,883 finalized five-minute candles, with 132 missing trailing expected candle buckets. Coverage warnings remain visible.
- **Funding:** An optional RSI funding filter uses an explicit, assumed one-hour availability lag. Actual publication timing has not been verified.
- **Order books:** The included data contains 60 sampled snapshots timestamped using local receipt times. It cannot reconstruct updates between samples.

Replay uses explicit event-timing assumptions and compares **strategy decisions**, not executed trades.

**This project does not execute orders, simulate fills, calculate P&L, or estimate profitability.** No wallet or trading credentials are required.

Phoenix Replay Kit is an independent developer project, not an official Ellipsis Labs product.

## Development

```bash
# Check TypeScript types
npm run typecheck

# Run automated tests
npm test

# Build the project
npm run build
```

For browser-level testing and deployment configuration, see the web application under `apps/web/`.

## Built with

**TypeScript · Node.js · Next.js · React · Phoenix Rise SDK · Vitest · Playwright**