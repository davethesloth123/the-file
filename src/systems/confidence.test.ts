// Confidence (bible §5.4): the release valve and the intel gate.
import { describe, expect, it } from 'vitest';
import tuning from '../data/tuning.json';
import { ConfidenceMeter } from './confidence';

const C = tuning.confidence;
const STEP = 1 / 60;

function tick(meter: ConfidenceMeter, accruing: boolean, seconds: number): void {
  for (let t = 0; t < seconds; t += STEP) meter.tick(accruing, STEP);
}

describe('confidence', () => {
  it('starts at the tuned value with full intel', () => {
    const m = new ConfidenceMeter();
    expect(m.value).toBe(C.start);
    expect(m.intel()).toBe('full');
  });

  it('does not recover before the clean delay', () => {
    const m = new ConfidenceMeter();
    m.spend(50);
    tick(m, false, C.cleanDelay - 0.5);
    expect(m.value).toBe(C.start - 50);
  });

  it('recovers at cleanRate once the clean delay passes', () => {
    const m = new ConfidenceMeter();
    m.spend(50);
    tick(m, false, C.cleanDelay + 10);
    // ~10 seconds of recovery at cleanRate
    expect(m.value).toBeCloseTo(C.start - 50 + 10 * C.cleanRate, 0);
  });

  it('any accrual resets the clean clock', () => {
    const m = new ConfidenceMeter();
    m.spend(50);
    tick(m, false, C.cleanDelay - 1);
    m.tick(true, STEP); // one observed instant
    tick(m, false, C.cleanDelay - 1);
    expect(m.value).toBe(C.start - 50);
  });

  it('never exceeds the maximum', () => {
    const m = new ConfidenceMeter();
    tick(m, false, 60);
    expect(m.value).toBe(C.max);
  });

  it('maps value to intel tiers from tuning', () => {
    const m = new ConfidenceMeter();
    m.spend(C.start - 40); // 40 → partial
    expect(m.intel()).toBe('partial');
    m.spend(40); // 0 → none
    expect(m.intel()).toBe('none');
  });
});
