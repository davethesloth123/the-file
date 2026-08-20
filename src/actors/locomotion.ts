// Speed-blended locomotion with stride locking. One code path for player,
// militia, civilians and NPCs. Natural clip speeds come from the archetype's
// GLB (baked by the generator); blend/clamp/thresholds from tuning.json.
// timeScale = speed / natural means feet never slide at any velocity.
import * as THREE from 'three';
import tuning from '../data/tuning.json';

const L = tuning.locomotion;

export type ClipName = 'idle' | 'walk' | 'jog' | 'crouch';

export class Locomotion {
  private readonly actions: Partial<Record<ClipName, THREE.AnimationAction>> = {};
  private current: ClipName = 'idle';
  /** Set to force a clip (e.g. 'crouch' while servicing a drop); null resumes speed-based selection. */
  forced: ClipName | null = null;

  constructor(
    private readonly mixer: THREE.AnimationMixer,
    clips: THREE.AnimationClip[],
    private readonly naturalSpeeds: Record<string, number>,
  ) {
    for (const clip of clips) {
      this.actions[clip.name as ClipName] = mixer.clipAction(clip);
    }
    this.actions.idle?.play();
  }

  update(speed: number, dt: number): void {
    const want: ClipName =
      this.forced ?? (speed < L.idleBelow ? 'idle' : speed < L.jogAbove ? 'walk' : 'jog');
    if (want !== this.current) {
      const next = this.actions[want];
      const prev = this.actions[this.current];
      if (next && prev) {
        next.reset().setEffectiveWeight(1).play().crossFadeFrom(prev, L.blendTime, false);
      }
      this.current = want;
    }
    const action = this.actions[this.current];
    if (action) {
      const natural = this.naturalSpeeds[this.current] ?? 0;
      const [lo, hi] = L.timeScaleClamp as [number, number];
      action.timeScale = natural > 0 ? THREE.MathUtils.clamp(speed / natural, lo, hi) : 1;
    }
    this.mixer.update(dt);
  }
}
