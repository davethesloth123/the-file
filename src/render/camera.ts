// Auto-trailing third-person camera, GTA IV lineage (bible §10). Recentre
// behind the player only while forward input is held; manual look suspends
// recentring, then eases back; pull-in against wall boxes; three presets on
// V, FOV opens when jogging. No pointer lock anywhere. All values from
// tuning.json.
import * as THREE from 'three';
import tuning from '../data/tuning.json';
import type { CollisionWorld } from '../world/collision';

const C = tuning.camera;

export interface CameraTargetState {
  x: number; y: number; z: number;
  yaw: number;
  forwardHeld: boolean;
  jogging: boolean;
}

export class TrailingCamera {
  yaw = Math.PI;
  private pitch = C.views[0]!.pitch;
  private view = 0;
  private manualTimer = 0;
  private dragging = false;
  private fov = C.views[0]!.fov;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.addEventListener('mousedown', () => (this.dragging = true));
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = THREE.MathUtils.clamp(this.pitch + e.movementY * 0.004, -0.2, 1.2);
      this.manualTimer = C.manualHold;
    });
    addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'v') this.cycleView();
    });
  }

  private cycleView(): void {
    this.view = (this.view + 1) % C.views.length;
    this.pitch = C.views[this.view]!.pitch;
  }

  update(dt: number, t: CameraTargetState, world: CollisionWorld): void {
    const v = C.views[this.view]!;

    if (this.manualTimer > 0) this.manualTimer -= dt;
    else {
      // recentre behind the player, but only while walking forward
      if (t.forwardHeld) {
        const want = t.yaw + Math.PI;
        const diff = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const step = C.recentreRate * dt;
        this.yaw += THREE.MathUtils.clamp(diff, -step, step);
      }
      this.pitch += (v.pitch - this.pitch) * Math.min(1, dt * 3);
    }

    const focus = new THREE.Vector3(t.x, t.y + v.focus, t.z);
    const back = new THREE.Vector3(
      Math.sin(this.yaw), 0, Math.cos(this.yaw),
    );
    const side = new THREE.Vector3(back.z, 0, -back.x);
    focus.addScaledVector(side, v.shoulder);

    const desired = focus.clone()
      .addScaledVector(back, v.dist * Math.cos(this.pitch));
    desired.y += v.dist * Math.sin(this.pitch);

    const clear = world.rayClear(focus.x, focus.y, focus.z, desired.x, desired.y, desired.z);
    // prefer at least minDist, but never sit inside a wall: when geometry
    // forces the camera closer than minDist, closer wins over clipping
    const unobstructed = v.dist * clear * 0.94;
    const dist = clear >= 1 ? v.dist : Math.max(Math.min(C.minDist, unobstructed), Math.min(unobstructed, v.dist));
    const pos = focus.clone().lerp(desired, Math.max(0.4, dist) / v.dist);

    this.camera.position.copy(pos);
    this.camera.lookAt(focus);

    const wantFov = v.fov + (t.jogging ? C.jogFovBoost : 0);
    this.fov += (wantFov - this.fov) * Math.min(1, dt * 5);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
