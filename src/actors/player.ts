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
  speed = 0;
  moving = false;
  hurrying = false;

  constructor(spawn: [number, number]) {
    this.x = this.px = spawn[0];
    this.z = this.pz = spawn[1];
    this.y = this.py = 0;
  }

  step(dt: number, input: PlayerInput, cameraYaw: number, world: CollisionWorld): void {
    this.px = this.x; this.py = this.y; this.pz = this.z; this.pyaw = this.yaw;
    this.moving = !!(input.forward || input.strafe);
    this.hurrying = input.hurrying;

    const ox = this.x, oz = this.z;
    if (this.moving) {
      const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
      const rx = -Math.cos(cameraYaw), rz = Math.sin(cameraYaw);
      let wx = fx * input.forward + rx * input.strafe;
      let wz = fz * input.forward + rz * input.strafe;
      const len = Math.hypot(wx, wz) || 1;
      wx /= len; wz /= len;
      const spd = input.hurrying ? P.jog : P.walk;
      const [nx, nz] = world.resolve(this.x + wx * spd * dt, this.z + wz * spd * dt, this.y);
      this.x = nx; this.z = nz;
      const want = Math.atan2(wx, wz);
      const turn = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.yaw += turn * Math.min(1, dt * P.turnRate);
    }

    const target = world.groundHeight(this.x, this.z, this.y);
    // follow floors and stairs briskly but without teleport pops
    this.y += (target - this.y) * Math.min(1, dt * 14);
    if (Math.abs(target - this.y) < 0.01) this.y = target;

    this.speed = Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-6);
  }
}
