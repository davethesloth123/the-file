import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AdditiveBonePose } from './additive-pose';

describe('AdditiveBonePose', () => {
  it('does not accumulate an unkeyed head rotation over thousands of frames', () => {
    const head = new THREE.Object3D();
    head.rotation.set(0.04, -0.08, 0.015);
    const neutral = head.quaternion.clone();
    const offset = new THREE.Euler(0.03, 0.07, 0, 'YXZ');
    const expected = neutral.clone().multiply(new THREE.Quaternion().setFromEuler(offset));
    const layer = new AdditiveBonePose();

    for (let frame = 0; frame < 60 * 60; frame++) {
      layer.remove(head);
      layer.apply(head, offset);
    }

    expect(Math.abs(head.quaternion.dot(expected))).toBeCloseTo(1, 6);
    layer.remove(head);
    expect(Math.abs(head.quaternion.dot(neutral))).toBeCloseTo(1, 6);
  });

  it('replaces the previous offset instead of adding to it', () => {
    const head = new THREE.Object3D();
    const layer = new AdditiveBonePose();
    layer.apply(head, new THREE.Euler(0, 0.4, 0, 'YXZ'));
    layer.remove(head);
    layer.apply(head, new THREE.Euler(0, -0.2, 0, 'YXZ'));

    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion);
    expect(Math.atan2(forward.x, forward.z)).toBeCloseTo(-0.2, 6);
  });
});
