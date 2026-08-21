import * as THREE from 'three';

/**
 * A removable local-space pose layer for one animated bone. The previous
 * procedural offset is removed before the mixer runs, then a freshly bounded
 * offset is applied afterward. Repeated frames therefore cannot accumulate
 * rotation on bones that are absent from an animation clip.
 */
export class AdditiveBonePose {
  private readonly applied = new THREE.Quaternion();
  private readonly inverse = new THREE.Quaternion();

  remove(target: THREE.Object3D | null): void {
    if (!target) return;
    this.inverse.copy(this.applied).invert();
    target.quaternion.multiply(this.inverse).normalize();
    this.applied.identity();
  }

  apply(target: THREE.Object3D | null, offset: THREE.Euler): void {
    if (!target) return;
    this.applied.setFromEuler(offset);
    target.quaternion.multiply(this.applied).normalize();
  }
}
