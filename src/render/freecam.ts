// Dev inspection camera (C): WASD + drag-look free-fly. No pointer lock —
// nothing to get trapped in, per the bible's camera rules. Speeds are dev
// tooling, not gameplay tuning.
import * as THREE from 'three';

const SPEED = 12;
const FAST = 3;
const LOOK = 0.004;

export class FreeCam {
  enabled = false;
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private dragging = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    dom.addEventListener('mousedown', () => (this.dragging = true));
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (!this.dragging || !this.enabled) return;
      this.yaw -= e.movementX * LOOK;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * LOOK, -1.5, 1.5);
    });
  }

  /** Sync yaw/pitch from the camera's current orientation, then take over. */
  enable(): void {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const k = (key: string): number => (this.keys.has(key) ? 1 : 0);
    const speed = SPEED * (this.keys.has('shift') ? FAST : 1) * dt;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.camera.position
      .addScaledVector(forward, (k('w') - k('s')) * speed)
      .addScaledVector(right, (k('d') - k('a')) * speed);
    this.camera.position.y += (k('e') - k('q')) * speed;
  }
}
