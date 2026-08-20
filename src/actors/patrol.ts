// Militia patrols (bible §5.2): fixed beats, alert rise and fall from
// tuning.json, and the load-bearing rule — a patrol breaks its beat to look
// at you ONLY when conduct is active AND it can see you. A patrol that
// stops for a man walking is a bug, not a tuning problem.
import tuning from '../data/tuning.json';
import { canSee } from '../systems/observation';
import type { CollisionWorld } from '../world/collision';

const V = tuning.vision;
const P = tuning.patrol;

export class Patrol {
  x: number; z: number; yaw = 0;
  px: number; pz: number; pyaw = 0;
  alert = 0;
  private lostFor = Infinity;
  private targetIndex = 1;
  /** actual ground speed this step, for the locomotion blend */
  currentSpeed = 0;
  /** Vera's tip slows every beat (×patrolSlow); informing reverts it. */
  speedFactor = 1;
  /** a diversion: walk toward the noise instead of the beat, briefly */
  private probe: [number, number] | null = null;
  private probeT = 0;

  /** Send the patrol to investigate a noise for `seconds`. */
  investigate(x: number, z: number, seconds: number): void {
    this.probe = [x, z];
    this.probeT = seconds;
  }

  constructor(
    readonly route: [number, number][],
    readonly speed: number,
  ) {
    this.x = this.px = route[0]![0];
    this.z = this.pz = route[0]![1];
  }

  step(
    dt: number,
    targetX: number, targetZ: number,
    conductActive: boolean,
    world: CollisionWorld,
  ): boolean {
    this.px = this.x; this.pz = this.z; this.pyaw = this.yaw;
    const ox = this.x, oz = this.z;

    const sees = canSee(this, targetX, targetZ, world);
    if (sees) {
      this.alert = Math.min(1, this.alert + dt * V.alertRise);
      this.lostFor = 0;
    } else {
      this.lostFor += dt;
      if (this.lostFor > V.loseTime) this.alert = Math.max(0, this.alert - dt * V.alertFall);
    }

    if (sees && conductActive && this.alert > P.alertFaceThreshold) {
      // stop and watch — the beat can wait
      const want = Math.atan2(targetX - this.x, targetZ - this.z);
      const turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += turn * Math.min(1, dt * P.faceRate);
    } else {
      let tx: number, tz: number;
      if (this.probe && (this.probeT -= dt) > 0) {
        [tx, tz] = this.probe;
      } else {
        this.probe = null;
        [tx, tz] = this.route[this.targetIndex]!;
      }
      const dx = tx - this.x, dz = tz - this.z;
      const dist = Math.hypot(dx, dz);
      if (dist < P.waypointRadius) {
        if (!this.probe) this.targetIndex = (this.targetIndex + 1) % this.route.length;
      } else {
        const speed = this.speed * this.speedFactor;
        this.x += (dx / dist) * speed * dt;
        this.z += (dz / dist) * speed * dt;
        const want = Math.atan2(dx, dz);
        const turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        this.yaw += turn * Math.min(1, dt * P.turnRate);
      }
    }
    this.currentSpeed = Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-6);
    return sees;
  }
}
