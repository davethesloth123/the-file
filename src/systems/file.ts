// The file (bible §5.3). Nothing is ever taken out of it: no decay path
// exists in this class, deliberately — only explicit transactions (the
// clerk, informing) may subtract, and they arrive with the economy system.
// Conduct accrues per second, ONLY while observed; additional observers are
// additive (rate × observers); carrying multiplies.
import tuning from '../data/tuning.json';
import type { ActiveConduct } from './conduct';

const F = tuning.file;

export class FileMeter {
  value = 0;

  /** One fixed-step tick. Zero observers means zero accrual, always. */
  accrue(conduct: ActiveConduct | null, observers: number, multiplier: number, dt: number): void {
    if (!conduct || observers <= 0) return;
    this.value = Math.min(F.max, this.value + conduct.rate * observers * multiplier * dt);
  }

  /** The ONLY reduction path: an explicit player transaction (the clerk,
   *  informing). Nothing else may call this — there is no decay. */
  transact(cut: number): void {
    this.value = Math.max(0, this.value - cut);
  }

  tierLabel(): string {
    let label = F.tiers[0]!.label;
    for (const tier of F.tiers) {
      if (this.value >= tier.at) label = tier.label;
    }
    return label;
  }
}
