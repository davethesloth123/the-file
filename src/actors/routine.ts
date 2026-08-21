// Reusable civilian/NPC routine movement. A route is a schedule of places and
// authored waits, not an endless detection-device loop. Temporary events can
// interrupt the schedule; once the event is over, the actor returns to the
// next scheduled place and resumes normal life.
import tuning from '../data/tuning.json';
import type { CollisionWorld } from '../world/collision';

const R = tuning.npcRoutine;

export type RoutineState = 'moving' | 'waiting' | 'interrupted' | 'returning';

export interface RoutineStop {
  pos: [number, number];
  waitSeconds: number;
}

interface Interruption {
  reason: string;
  target: [number, number] | null;
  remaining: number;
}

export class RoutineAgent {
  x: number;
  z: number;
  yaw: number;
  px: number;
  pz: number;
  pyaw: number;
  currentSpeed = 0;
  state: RoutineState;
  interruptionReason: string | null = null;

  private targetIndex: number;
  private waitRemaining: number;
  private interruption: Interruption | null = null;
  private readonly pauses = new Set<string>();

  constructor(
    readonly stops: readonly RoutineStop[],
    startIndex: number,
    readonly speed: number,
    startYaw = 0,
  ) {
    const start = stops[startIndex];
    if (!start || stops.length < 2) throw new Error('A routine requires two or more stops');
    this.x = this.px = start.pos[0];
    this.z = this.pz = start.pos[1];
    this.yaw = this.pyaw = startYaw;
    this.targetIndex = (startIndex + 1) % stops.length;
    this.waitRemaining = start.waitSeconds;
    this.state = this.waitRemaining > 0 ? 'waiting' : 'moving';
  }

  /** Pause, converse, investigate, or move temporarily toward an event. */
  interrupt(reason: string, seconds: number, target: [number, number] | null = null): void {
    this.interruption = { reason, target, remaining: seconds };
    this.interruptionReason = reason;
    this.state = 'interrupted';
  }

  clearInterruption(): void {
    this.interruption = null;
    this.interruptionReason = null;
    this.state = 'returning';
  }

  pause(reason: string): void {
    this.pauses.add(reason);
    this.currentSpeed = 0;
  }

  resume(reason: string): void {
    this.pauses.delete(reason);
  }

  get paused(): boolean {
    return this.pauses.size > 0;
  }

  step(dt: number, world?: CollisionWorld): void {
    this.px = this.x;
    this.pz = this.z;
    this.pyaw = this.yaw;

    if (this.paused) {
      this.currentSpeed = 0;
      return;
    }

    if (this.interruption) {
      const target = this.interruption.target;
      const arrived = !target || this.moveToward(target, dt, world);
      if (arrived) {
        this.currentSpeed = 0;
        this.interruption.remaining -= dt;
        if (this.interruption.remaining <= 0) this.clearInterruption();
      }
      return;
    }

    if (this.state === 'waiting') {
      this.currentSpeed = 0;
      this.waitRemaining -= dt;
      if (this.waitRemaining <= 0) this.state = 'moving';
      return;
    }

    const arrived = this.moveToward(this.stops[this.targetIndex]!.pos, dt, world);
    if (!arrived) return;

    this.currentSpeed = 0;
    this.waitRemaining = this.stops[this.targetIndex]!.waitSeconds;
    this.targetIndex = (this.targetIndex + 1) % this.stops.length;
    this.state = this.waitRemaining > 0 ? 'waiting' : 'moving';
  }

  private moveToward(target: [number, number], dt: number, world?: CollisionWorld): boolean {
    const dx = target[0] - this.x;
    const dz = target[1] - this.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= R.arrivalRadius) {
      this.x = target[0];
      this.z = target[1];
      return true;
    }

    const brakingSpeed = Math.sqrt(2 * R.deceleration * distance);
    const desiredSpeed = Math.min(this.speed, brakingSpeed);
    const response = desiredSpeed > this.currentSpeed ? R.acceleration : R.deceleration;
    const speedChange = Math.min(Math.abs(desiredSpeed - this.currentSpeed), response * dt);
    this.currentSpeed += Math.sign(desiredSpeed - this.currentSpeed) * speedChange;
    const stepDistance = Math.min(distance, this.currentSpeed * dt);
    const desiredX = this.x + (dx / distance) * stepDistance;
    const desiredZ = this.z + (dz / distance) * stepDistance;
    const [nextX, nextZ] = world
      ? world.resolve(desiredX, desiredZ, 0)
      : [desiredX, desiredZ];
    const actualDistance = Math.hypot(nextX - this.x, nextZ - this.z);
    this.x = nextX;
    this.z = nextZ;
    this.currentSpeed = actualDistance / Math.max(dt, Number.EPSILON);

    const want = Math.atan2(dx, dz);
    const turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const applied = Math.max(-R.turnRate * dt, Math.min(R.turnRate * dt, turn));
    this.yaw += applied;
    return Math.hypot(target[0] - this.x, target[1] - this.z) <= R.arrivalRadius;
  }
}
