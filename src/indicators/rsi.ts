// checks if rsi period is valid
export function validateRsiPeriod(period: number): void {
  if (!Number.isSafeInteger(period) || period < 1) {
    throw new Error('RSI period must be a positive integer');
  }
}

// calculates wilder rsi values
export class WilderRsi {
  private previousClose: number | null = null;
  private changes = 0;
  private averageGain = 0;
  private averageLoss = 0;

  constructor(readonly period = 14) {
    validateRsiPeriod(period);
  }

  update(close: number): number | null {
    // validation for incoming close price
    if (!Number.isFinite(close) || close <= 0) {
      throw new Error('RSI close must be a finite positive price');
    }

    // first candle check
    if (this.previousClose === null) {
      this.previousClose = close;
      return null;
    }

    const delta = close - this.previousClose;
    this.previousClose = close;

    let gain = 0;
    if (delta > 0) {
      gain = delta;
    }

    let loss = 0;
    if (delta < 0) {
      loss = -delta;
    }

    this.changes++;

    // warming up initial periods
    if (this.changes <= this.period) {
      this.averageGain = this.averageGain + gain / this.period;
      this.averageLoss = this.averageLoss + loss / this.period;

      if (this.changes < this.period) {
        return null;
      }
    } else {
      // smoothed wilder moving average
      const weight = (this.period - 1) / this.period;
      this.averageGain = this.averageGain * weight + gain / this.period;
      this.averageLoss = this.averageLoss * weight + loss / this.period;
    }

    // edge cases
    if (this.averageGain === 0 && this.averageLoss === 0) {
      return 50;
    }
    if (this.averageLoss === 0) {
      return 100;
    }
    if (this.averageGain === 0) {
      return 0;
    }

    const rs = this.averageGain / this.averageLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }
}