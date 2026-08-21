// Player movement: camera-relative WASD, Shift to hurry, collision resolve
// and walkable-surface height from the collision world. Fixed-step; the
// renderer interpolates. Speeds and radius from tuning.json (bible §16).
import tuning from '../data/tuning.json';
import type { CollisionWorld } from '../world/collision';

const P = tuning.player;

export interface PlayerInput {
  forward: number;   // -1..1
  strafe: number;    // -1..1
  hurrying: boolean;
}

export class PlayerState {
  x: number; y = 0; z: number; yaw = Math.PI;
  px: number; py = 0; pz: number; pyaw = Math.PI;
  vx = 0;
  vz = 0;
  speed = 0;
  acceleration = 0;
  yawRate = 0;
  moving = false;
  hurrying = false;
  onStairs = false;
  private stairGrace = 0;

  constructor(spawn: [number, number]) {
    this.x = this.px = spawn[0];
    this.z = this.pz = spawn[1];
    this.y = this.py = 0;
  }

  /** Conversation/interaction steering. Called after the regular movement
   * step, so the previous yaw is already captured for render interpolation. */
  faceToward(x: number, z: number, dt: number): void {
    const dx = x - this.x;
    const dz = z - this.z;
    if (Math.hypot(dx, dz) < 0.001) return;
    const want = Math.atan2(dx, dz);
    const turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const applied = Math.max(-P.turnRateIdle * dt, Math.min(P.turnRateIdle * dt, turn));
    this.yaw += applied;
    this.yawRate = applied / Math.max(dt, Number.EPSILON);
  }

  step(
    dt: number,
    input: PlayerInput,
    cameraYaw: number,
    world: CollisionWorld,
    motionLocked = false,
  ): void {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.pyaw = this.yaw;
    const previousSpeed = this.speed;
    const supportBeforeMove = world.groundInfo(this.x, this.z, this.y);
    this.onStairs = supportBeforeMove.kind === 'stair';
    this.stairGrace = this.onStairs
      ? P.stairGraceSeconds
      : Math.max(0, this.stairGrace - dt);
    const inputLength = Math.hypot(input.forward, input.strafe);
    let wx = 0;
    let wz = 0;
    if (inputLength > 0 && !motionLocked) {
      const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
      const rx = -Math.cos(cameraYaw), rz = Math.sin(cameraYaw);
      wx = fx * input.forward + rx * input.strafe;
      wz = fz * input.forward + rz * input.strafe;
      const len = Math.hypot(wx, wz) || 1;
      wx /= len; wz /= len;
    }

    if (motionLocked) {
      this.vx = 0;
      this.vz = 0;
    } else {
      const stairScale = this.onStairs
        ? (input.hurrying ? P.stairJogScale : P.stairWalkScale)
        : 1;
      const targetSpeed = inputLength > 0
        ? (input.hurrying ? P.jog : P.walk) * stairScale
        : 0;
      const targetX = wx * targetSpeed;
      const targetZ = wz * targetSpeed;
      const velocityLength = Math.hypot(this.vx, this.vz);
      const directionDot = velocityLength > 0 && inputLength > 0
        ? (this.vx * wx + this.vz * wz) / velocityLength
        : 1;
      const response = inputLength === 0
        ? P.deceleration
        : directionDot < P.pivotDot
          ? P.reverseBrake
          : directionDot < P.cornerDot
            ? this.stairGrace > 0 ? P.stairCornerAcceleration : P.cornerAcceleration
          : input.hurrying ? P.jogAcceleration : P.walkAcceleration;
      const maxChange = response * dt;
      const changeX = targetX - this.vx;
      const changeZ = targetZ - this.vz;
      const changeLength = Math.hypot(changeX, changeZ);
      if (changeLength <= maxChange || changeLength === 0) {
        this.vx = targetX;
        this.vz = targetZ;
      } else {
        this.vx += (changeX / changeLength) * maxChange;
        this.vz += (changeZ / changeLength) * maxChange;
      }
    }

    const desiredX = this.x + this.vx * dt;
    const desiredZ = this.z + this.vz * dt;
    const [nextX, nextZ] = world.resolve(desiredX, desiredZ, this.y);
    this.x = nextX;
    this.z = nextZ;
    // A collision solver may push an overlapping capsule back to the nearest
    // legal point. That correction is not momentum: feeding it back into the
    // velocity used to launch the player out of walls (and could persist for
    // many seconds after a constrained dev spawn).
    if (Math.abs(nextX - desiredX) > P.collisionEpsilon) this.vx = 0;
    if (Math.abs(nextZ - desiredZ) > P.collisionEpsilon) this.vz = 0;

    this.speed = Math.hypot(this.vx, this.vz);
    this.moving = this.speed > P.movingThreshold;
    this.hurrying = input.hurrying && this.speed > P.hurryThreshold && !motionLocked;
    this.acceleration = (this.speed - previousSpeed) / Math.max(dt, Number.EPSILON);

    const facingSpeed = Math.hypot(this.vx, this.vz);
    if (facingSpeed > P.movingThreshold) {
      const want = Math.atan2(this.vx, this.vz);
      const turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const walkBlend = Math.min(1, facingSpeed / P.walk);
      const jogBlend = Math.max(0, Math.min(1, (facingSpeed - P.walk) / (P.jog - P.walk)));
      const turnRate = P.turnRateIdle
        + (P.turnRateWalk - P.turnRateIdle) * walkBlend
        + (P.turnRateJog - P.turnRateWalk) * jogBlend;
      const applied = Math.max(-turnRate * dt, Math.min(turnRate * dt, turn));
      this.yaw += applied;
      this.yawRate = applied / Math.max(dt, Number.EPSILON);
    } else {
      this.yawRate = 0;
    }

    const support = world.groundInfo(this.x, this.z, this.y);
    const target = support.height;
    this.onStairs = support.kind === 'stair';
    const stairTransition = this.onStairs || supportBeforeMove.kind === 'stair';
    const response = stairTransition
      ? target >= this.y ? P.stairRiseFollowRate : P.stairFallFollowRate
      : P.groundFollowRate;
    // Follow discrete treads without teleport pops. Ascending is slightly
    // more responsive than descending so feet clear risers while the camera
    // receives a stable, monotonic elevation signal.
    this.y += (target - this.y) * Math.min(1, dt * response);
    if (Math.abs(target - this.y) < P.groundSnapDistance) this.y = target;
  }
}
