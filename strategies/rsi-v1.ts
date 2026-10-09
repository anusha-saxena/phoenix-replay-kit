import { createRsiCrossStrategy } from '../src/index.js';
export default createRsiCrossStrategy({
  name: 'rsi-v1',
  period: 14,
  buyThreshold: 30,
  sellThreshold: 70,
  priceField: 'close',
});
