// Handler confidence (bible §5.4). Rises slowly through clean work; falls
// only through explicit transactions (they arrive with the economy).
//
// The release valve: five seconds without accruing to the file starts
// confidence recovering at cleanRate. Without this the two meters are a
// one-way slide; with it the campaign has a rhythm.
//
// Confidence gates QUANTITY of intel, never accuracy (pillar III). What it
// gates here is whether patrol cones are *rendered* — the detection maths
// never reads this class.
import tuning from '../data/tuning.json';

const C = tuning.confidence;

export type IntelTier = 'none' | 'partial' | 'full';

export class ConfidenceMeter {
  value = C.start;
  private clean = 0;

  /** One fixed-step tick. `accruing` = the file is rising this instant
   *  (conduct active AND observed). Any accrual resets the clean clock. */
  tick(accruing: boolean, dt: number): void {
    if (accruing) {
      this.clean = 0;
      return;
    }
    this.clean += dt;
    if (this.clean > C.cleanDelay) {
      this.value = Math.min(C.max, this.value + C.cleanRate * dt);
    }
  }

  /** Explicit transaction (informing, selling equipment — economy system). */
  spend(amount: number): void {
    this.value = Math.max(0, this.value - amount);
  }

  intel(): IntelTier {
    let tier: IntelTier = 'none';
    for (const t of C.tiers) {
      if (this.value >= t.at) tier = t.intel as IntelTier;
    }
    return tier;
  }
}
