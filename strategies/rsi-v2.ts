import { createRsiCrossStrategy } from '../src/index.js';
export default createRsiCrossStrategy({
  name: 'rsi-v2',
  period: 14,
  buyThreshold: 25,
  sellThreshold: 70,
  priceField: 'close',
});
