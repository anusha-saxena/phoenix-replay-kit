# Phoenix Replay Kit

Independent, unofficial developer tool for repeatable, offline historical strategy
regression testing on Phoenix perpetuals using `@ellipsis-labs/rise`.
**In development:** Stage 1 implements candle collection, validation and offline
loading. Strategy replay and BUY/SELL/HOLD comparison come later. This compares
strategy intentions; it does not execute trades or simulate fills or P&L.
No wallet, private keys or trading credentials are required.

Run from this directory (not the parent workspace):

```bash
npm ci
npm run typecheck
npm test
npm run validate:candles -- data/fixtures/candles/sol-5m-1790869255065-1791474055065.json
npm run fetch:candles -- --symbol SOL --timeframe 5m --hours 24
```

Explicit, repeatable request window:

```bash
npx tsx scripts/fetch-candles.ts --symbol SOL --timeframe 5m \
  --from 2026-10-01T00:00:00Z --to 2026-10-08T00:00:00Z \
  --out data/fixtures/candles/sol-5m-demo.json
```

The equivalent `npm run fetch:candles -- ...` uses `node --import tsx`, which
avoids the tsx CLI IPC socket restriction in some sandboxes. Collection requires
public network access; tests and validation work offline. Existing output is
refused unless `--force` is supplied. API errors abort without saving a successful
partial collection. Incomplete coverage is saved with an explicit report and warning.
Timeframes accept positive integer `m`, `h`, `d` notation; actual API acceptance is
server-dependent. UTC timestamps must end in `Z`. Rolling windows default to 168 hours.

`build` is a compatibility alias for `typecheck`; neither emits a distribution.
No new dependencies were added. MIT license, copyright 2026 Anusha Saxena.

## Layout and public API

- `src/data/types.ts`: typed version 1 fixture and integrity contracts.
- `src/data/candle-validation.ts`: runtime validation and coverage math.
- `src/data/candle-loader.ts`: strict offline JSON loader and legacy adapter.
- `src/index.ts`: Stage 2 library exports.
- `scripts/fetch-candles.ts`: network CLI; `candle-collector.ts` is injectable for tests.
- `scripts/validate-candles.ts`: offline report CLI.
- `scripts/experimental/`: preserved recorder, inspection and probe scripts.
- `tests/data/`: synthetic unit tests plus offline validation of the real dataset.
- `data/fixtures/candles/`: historical fixtures; ordinary collection never replaces them.
- `data/raw/`, `data/inspection/`: ignored recordings and exploratory responses.

The existing 60-snapshot recording remains at `data/sol-snapshots.json` and is
ignored to avoid accidentally committing large raw data. Experiments run from the
project root. The recorder now writes timestamped raw paths; inspection uses
exclusive creation so it cannot overwrite the existing JSON.

See [fixture contract](docs/candle-fixtures.md) and [Stage 1 audit](docs/stage-1-audit.md).
