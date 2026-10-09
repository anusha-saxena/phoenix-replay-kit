import { createCandleReplayEvents, loadCandleFixture, compareStrategies, createRsiCrossStrategy } from '../src/index.js';

const fixture = await loadCandleFixture('data/fixtures/candles/sol-5m-1790869255065-1791474055065.json');
const result = compareStrategies({ events: createCandleReplayEvents(fixture), baseline: createRsiCrossStrategy({ buyThreshold: 30 }), candidate: createRsiCrossStrategy({ buyThreshold: 25 }) });
console.log(JSON.stringify(result, null, 2));
