// Hold-to-act (bible §19: Act = F, held). One small mechanism used by every
// interaction in the game: proximity decides whether the prompt shows,
// holding advances progress, releasing resets it. Costs are paid over the
// whole hold — letting go early buys nothing back.
import tuning from '../data/tuning.json';

const I = tuning.interaction;

export const PROMPT_RADIUS = I.promptRadius;
export const REACH_RADIUS = I.reachRadius;
export const TALK_HOLD = I.talkHold;

export function within(
  px: number, pz: number, x: number, z: number, radius: number,
): boolean {
  return Math.hypot(px - x, pz - z) < radius;
}

export class HoldToAct {
  /** seconds accumulated toward the current hold */
  t = 0;

  /** Advance the hold. Returns true exactly once, on the tick the hold
   *  completes. Out of range or released → progress resets to zero. */
  step(near: boolean, held: boolean, seconds: number, dt: number): boolean {
    if (!near || !held) {
      this.t = 0;
      return false;
    }
    this.t += dt;
    if (this.t >= seconds) {
      this.t = 0;
      return true;
    }
    return false;
  }

  progress(seconds: number): number {
    return seconds > 0 ? Math.min(1, this.t / seconds) : 0;
  }

  get holding(): boolean {
    return this.t > 0;
  }
}
