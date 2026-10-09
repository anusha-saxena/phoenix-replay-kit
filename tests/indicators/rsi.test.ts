import { describe, expect, it } from 'vitest';
import { WilderRsi, crossingSignal, createRsiCrossStrategy } from '../../src/index.js';

function calculate(closes: number[], period = 14) {
  const indicator = new WilderRsi(period);

  return closes.map((close) => indicator.update(close));
}
describe('Wilder RSI', () => {
  it('requires 15 closes for RSI(14)', () => {
    const values = calculate(Array.from({ length: 16 }, (_, i) => 100 + i));
    expect(values.slice(0, 14)).toEqual(Array(14).fill(null));
    expect(values[14]).toBe(100);
    expect(values[15]).toBe(100);
  });

  it('matches hand-calculated initial averages and Wilder smoothing within 1e-10', () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 108, 107, 106, 105, 104, 106];
    const values = calculate(closes);
    expect(Math.abs(values[14]! - (100 * 9) / 14)).toBeLessThan(1e-10);
    expect(Math.abs(values[15]! - (100 * 145) / 210)).toBeLessThan(1e-10);
  });

  it('generalizes smoothing to another period', () => {
    const values = calculate([10, 13, 12, 14, 12], 3);
    expect(values[3]).toBeCloseTo((100 * 5) / 6, 10);
    expect(values[4]).toBeCloseTo((100 * 10) / 18, 10);
  });

  it('uses 50 for flat prices, 100 for rising prices and 0 for declining prices', () => {
    expect(calculate(Array(20).fill(10)).slice(14)).toEqual(Array(6).fill(50));
    expect(calculate(Array.from({ length: 20 }, (_, i) => 10 + i)).slice(14)).toEqual(
      Array(6).fill(100),
    );
    expect(calculate(Array.from({ length: 20 }, (_, i) => 30 - i)).slice(14)).toEqual(
      Array(6).fill(0),
    );
  });

  it('rejects invalid prices and periods without poisoning state', () => {
    for (const value of [0, -1, NaN, Infinity, -Infinity]) {
      const indicator = new WilderRsi(1);
      indicator.update(10);
      expect(() => indicator.update(value)).toThrow('finite positive');
      expect(indicator.update(11)).toBe(100);
    }

    for (const period of [0, -1, 1.5, NaN, Infinity]) {
      expect(() => new WilderRsi(period)).toThrow('period');
    }
  });

  it('is repeatable and stays in range including period one', () => {
    const closes = Array.from({ length: 500 }, (_, i) => 100 + Math.sin(i) * 15);

    for (const period of [1, 2, 14, 30]) {
      const values = calculate(closes, period);
      expect(values).toEqual(calculate(closes, period));

      for (const value of values) {
        if (value !== null) {
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
describe('threshold crossings (synthetic RSI values, not inferred prices)', () => {
  it('distinguishes the 25 and 30 upward crossings', () => {
    expect(crossingSignal(22, 27, 25, 70)).toBe('BUY');
    expect(crossingSignal(22, 27, 30, 70)).toBe('HOLD');
    expect(crossingSignal(27, 31, 30, 70)).toBe('BUY');
    expect(crossingSignal(27, 31, 25, 70)).toBe('HOLD');
  });

  it('does not buy repeatedly below or above a threshold', () => {
    for (const [previous, current] of [
      [20, 22],
      [22, 24],
      [26, 27],
      [30, 31],
    ]) {
      expect(crossingSignal(previous!, current!, 25, 70)).toBe('HOLD');
    }
  });

  it('uses strict previous and inclusive current equality', () => {
    expect(crossingSignal(24, 25, 25, 70)).toBe('BUY');
    expect(crossingSignal(25, 26, 25, 70)).toBe('HOLD');
    expect(crossingSignal(71, 70, 25, 70)).toBe('SELL');
    expect(crossingSignal(70, 69, 25, 70)).toBe('HOLD');
    expect(crossingSignal(75, 69, 25, 70)).toBe('SELL');
  });

  it('holds when either RSI value is unavailable', () => {
    expect(crossingSignal(null, 31, 30, 70)).toBe('HOLD');
    expect(crossingSignal(20, null, 30, 70)).toBe('HOLD');
  });

  it('validates strategy configuration', () => {
    for (const options of [
      { period: 0 },
      { buyThreshold: -1 },
      { sellThreshold: 101 },
      { buyThreshold: 70 },
      { buyThreshold: NaN },
    ]) {
      expect(() => createRsiCrossStrategy(options)).toThrow();
    }
  });
});
