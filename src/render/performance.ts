export interface FramePerformanceSummary {
  samples: number;
  averageMs: number;
  p95Ms: number;
  p99Ms: number;
  approximateFps: number;
  framesOverBudget: number;
}

/** Small rolling frame profiler used by the browser smoke route. It ignores
 * invalid/paused deltas and keeps a bounded window so instrumentation itself
 * cannot become a performance problem. */
export class FrameProfiler {
  private readonly samples: number[] = [];

  constructor(private readonly capacity = 600) {}

  sample(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 250) return;
    this.samples.push(milliseconds);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get count(): number { return this.samples.length; }

  summary(): FramePerformanceSummary | null {
    if (!this.samples.length) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const percentile = (fraction: number): number => sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
    ]!;
    const averageMs = this.samples.reduce((sum, value) => sum + value, 0) / this.samples.length;
    return {
      samples: this.samples.length,
      averageMs,
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      approximateFps: 1000 / averageMs,
      framesOverBudget: this.samples.filter((value) => value > 16.7).length,
    };
  }
}
