import { describe, expect, it } from 'vitest';
import { FrameProfiler } from './performance';

describe('frame performance profiler', () => {
  it('reports bounded average and percentile measurements', () => {
    const profiler = new FrameProfiler(4);
    for (const sample of [5, 10, 15, 20, 25]) profiler.sample(sample);
    expect(profiler.count).toBe(4);
    const summary = profiler.summary()!;
    expect(summary.averageMs).toBe(17.5);
    expect(summary.p95Ms).toBe(20);
    expect(summary.framesOverBudget).toBe(2);
  });

  it('ignores paused or invalid frame deltas', () => {
    const profiler = new FrameProfiler();
    for (const sample of [0, -1, Number.NaN, 300]) profiler.sample(sample);
    expect(profiler.summary()).toBeNull();
  });
});
