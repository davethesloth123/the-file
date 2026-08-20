// Fixed-step simulation clock. CLAUDE.md: the sim advances at exactly 60Hz
// via an accumulator and rendering interpolates, so suspicion accrual is
// byte-identical at 30fps and 144fps. Frame time is clamped so a background
// tab or debugger pause doesn't unleash a burst of catch-up steps.
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

const MAX_FRAME_SECONDS = 0.25;

export class FixedClock {
  private accumulator = 0;
  private lastSeconds: number | null = null;

  /**
   * Advance the simulation zero or more fixed steps for this animation frame.
   * Returns the interpolation alpha in [0, 1): how far the unsimulated
   * remainder sits between the previous and current sim states.
   */
  tick(nowMs: number, step: (dt: number) => void): number {
    const now = nowMs / 1000;
    const frame =
      this.lastSeconds === null
        ? SIM_DT
        : Math.min(now - this.lastSeconds, MAX_FRAME_SECONDS);
    this.lastSeconds = now;

    this.accumulator += frame;
    while (this.accumulator >= SIM_DT) {
      step(SIM_DT);
      this.accumulator -= SIM_DT;
    }
    return this.accumulator / SIM_DT;
  }
}
