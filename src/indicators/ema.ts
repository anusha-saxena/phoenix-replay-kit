export function validateEmaPeriod(period: number) {
  if (!Number.isInteger(period) || period < 1 || period > 200) {
    throw new Error("EMA period must be 1..200");
  }
}

export class Ema {
  private count = 0;
  private sum = 0;
  private value: number | null = null;
  constructor(readonly period: number) {
    validateEmaPeriod(period);
  }
  update(price: number): number | null {
    if (!Number.isFinite(price) || price <= 0)
      throw new Error("EMA requires a positive finite price");
    if (this.value === null) {
      this.sum += price;
      if (++this.count === this.period) this.value = this.sum / this.period;
    } else {
      this.value += ((price - this.value) * 2) / (this.period + 1);
    }
    return this.value;
  }
}
