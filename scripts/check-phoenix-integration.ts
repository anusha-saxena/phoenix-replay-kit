import { strict as assert } from 'node:assert';
import { discoverCapabilities, validateSnapshot } from '../src/index.js';
import { snapshotCollector } from '../src/workspace/phoenix-data.js';

// test capabilities discovery
const capabilities = await discoverCapabilities();
console.log(JSON.stringify(capabilities, null, 2));

// get rounded timestamp
const now = Date.now();
const interval = 300000;
const toMs = Math.floor(now / interval) * interval;

const oneDayAgo = 24 * 60 * 60 * 1000;
const fromMs = toMs - oneDayAgo;

// collect the snapshot
const snapshot = await snapshotCollector.collect({
  symbol: 'SOL',
  timeframe: '5m',
  mode: 'historical',
  fromMs: fromMs,
  toMs: toMs,
  warmupBars: 21,
});

// serialize and deserialize to test validation
const jsonString = JSON.stringify(snapshot);
const parsedObj = JSON.parse(jsonString);
const restored = validateSnapshot(parsedObj);

// check if ids match
assert.equal(restored.id, snapshot.id);

console.log(
  `Collected ${snapshot.fixture.bars.length} finalized candles; snapshot ${snapshot.id}`,
);