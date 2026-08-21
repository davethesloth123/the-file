import { describe, expect, it } from 'vitest';
import { CollisionWorld } from './collision';

describe('collision world', () => {
  it('can open a named dynamic door without rebuilding the world', () => {
    const world = new CollisionWorld([
      { id: 'staff_door', x: 0, z: 0, hw: 0.8, hd: 0.1, y0: 0, y1: 2.6 },
    ], []);
    expect(world.resolve(0, 0, 0)).not.toEqual([0, 0]);
    expect(world.setWallEnabled('staff_door', false)).toBe(true);
    expect(world.resolve(0, 0, 0)).toEqual([0, 0]);
  });

  it('pushes a body out of an overlapping wall band', () => {
    const world = new CollisionWorld(
      [{ x: 0, z: 0, hw: 1, hd: 1, y0: 0, y1: 3 }],
      [],
    );
    const [x, z] = world.resolve(0.5, 0, 0, 0.5);
    expect(Math.abs(x) > 1 || Math.abs(z) > 1).toBe(true);
  });

  it('selects the highest reachable floor and evaluates ramps', () => {
    const world = new CollisionWorld([], [
      { kind: 'flat', x: 0, z: 0, hw: 2, hd: 2, y: 0.4 },
      { kind: 'flat', x: 0, z: 0, hw: 2, hd: 2, y: 2 },
      { kind: 'ramp', x: 4, z: 0, hw: 2, hd: 1, axis: 'x', y0: 0, y1: 1 },
    ]);
    expect(world.groundHeight(0, 0, 0.1)).toBe(0.4);
    expect(world.groundHeight(4, 0, 0.5)).toBeCloseTo(0.5);
  });

  it('returns the first blocking fraction for line-of-sight rays', () => {
    const world = new CollisionWorld(
      [{ x: 0, z: 5, hw: 1, hd: 0.5, y0: 0, y1: 3 }],
      [],
    );
    expect(world.rayClear(0, 1, 0, 0, 1, 10)).toBeCloseTo(0.45);
    expect(world.rayClear(3, 1, 0, 3, 1, 10)).toBe(1);
  });

  it('identifies authored treads separately from ordinary floors', () => {
    const world = new CollisionWorld([], [
      { kind: 'stair', x: 0, z: 0, hw: 1, hd: 1, y: 0.17 },
    ]);
    expect(world.groundInfo(0, 0, 0)).toEqual({ height: 0.17, kind: 'stair' });
  });

  it('uses padded camera-only obstacles without changing body collision', () => {
    const cameraBox = { x: 0, z: 5, hw: 0.5, hd: 0.5, y0: 0, y1: 3 };
    const world = new CollisionWorld([], [], [cameraBox]);
    expect(world.resolve(0, 5, 0)).toEqual([0, 5]);
    const clear = world.rayClear(0, 1, 0, 0, 1, 10, 0.25);
    expect(clear).toBeCloseTo(0.425);
  });
});
