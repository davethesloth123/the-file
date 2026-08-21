import type { PlayerInput } from '../actors/player';

export interface DriveStage extends PlayerInput {
  duration: number;
}

/** Parse `forward,strafe,hurry,seconds;...` from the existing review-query
 *  surface. Invalid stages are ignored so a typo can never break the game. */
export function parseDriveStages(value: string | null): DriveStage[] {
  if (!value) return [];
  const stages: DriveStage[] = [];
  for (const token of value.split(';')) {
    const [rawForward, rawStrafe, rawHurry, rawDuration] = token.split(',').map(Number);
    if (
      !Number.isFinite(rawForward) || !Number.isFinite(rawStrafe)
      || !Number.isFinite(rawHurry) || !Number.isFinite(rawDuration)
      || rawDuration! <= 0
    ) continue;
    stages.push({
      forward: Math.max(-1, Math.min(1, rawForward!)),
      strafe: Math.max(-1, Math.min(1, rawStrafe!)),
      hurrying: rawHurry! > 0,
      duration: rawDuration!,
    });
  }
  return stages;
}

export class DriveSequence {
  private index = 0;
  private elapsed = 0;

  constructor(private readonly stages: readonly DriveStage[]) {}

  status(): { index: number; elapsed: number; complete: boolean } {
    return {
      index: this.index,
      elapsed: this.elapsed,
      complete: this.index >= this.stages.length,
    };
  }

  sample(dt: number): PlayerInput | null {
    let stage = this.stages[this.index];
    if (!stage) return null;
    this.elapsed += dt;
    while (stage && this.elapsed >= stage.duration) {
      this.elapsed -= stage.duration;
      stage = this.stages[++this.index];
    }
    if (!stage) return null;
    return {
      forward: stage.forward,
      strafe: stage.strafe,
      hurrying: stage.hurrying,
    };
  }
}
