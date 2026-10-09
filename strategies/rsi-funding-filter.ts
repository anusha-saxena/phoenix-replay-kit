import { createRsiFundingStrategy } from "../src/index.js";

export default createRsiFundingStrategy({
  name: "rsi-funding-filter",
  period: 14,
  buyThreshold: 30,
  sellThreshold: 70,
  priceField: "close",
  maxFundingRatePercentage: 0.003,
  missingFundingPolicy: "suppress",
});
