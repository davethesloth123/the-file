import { describe, expect, it } from 'vitest';
import tuning from '../data/tuning.json';
import { CollisionWorld } from '../world/collision';
import { canSee } from './observation';

describe('observation', () => {
  const clear = new CollisionWorld([], []);
  const observer = { x: 0, z: 0, yaw: 0 };

  it('sees a target inside the authored cone', () => {
    expect(canSee(observer, 0, tuning.vision.range - 1, clear)).toBe(true);
  });

  it('does not see outside the authored range or field of view', () => {
    expect(canSee(observer, 0, tuning.vision.range + 1, clear)).toBe(false);
    const angle = (tuning.vision.fovDeg * Math.PI) / 360 + 0.1;
    expect(canSee(observer, Math.sin(angle), Math.cos(angle), clear)).toBe(false);
  });

  it('uses collision walls for occlusion', () => {
    const blocked = new CollisionWorld(
      [{ x: 0, z: 2, hw: 1, hd: 0.2, y0: 0, y1: 3 }],
      [],
    );
    expect(canSee(observer, 0, 4, blocked)).toBe(false);
  });
});
