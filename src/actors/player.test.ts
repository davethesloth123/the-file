import { describe, expect, it } from 'vitest';
import tuning from '../data/tuning.json';
import { CollisionWorld } from '../world/collision';
import { PlayerState } from './player';

const STEP = 1 / 60;
const EMPTY_WORLD = new CollisionWorld([], []);

function stairWorld(withRails = false): CollisionWorld {
  const steps = Array.from({ length: 10 }, (_, i) => ({
    kind: 'stair' as const,
    x: 0,
    z: (i + 0.5) * 0.32,
    hw: 0.6,
    hd: 0.165,
    y: (i + 1) * 0.17,
  }));
  return new CollisionWorld(
    withRails ? [
      { x: -0.68, z: 1.6, hw: 0.04, hd: 1.7, y0: 0, y1: 2.7 },
      { x: 0.68, z: 1.6, hw: 0.04, hd: 1.7, y0: 0, y1: 2.7 },
    ] : [],
    [
      { kind: 'flat', x: 0, z: -0.5, hw: 1.2, hd: 0.5, y: 0 },
      ...steps,
      { kind: 'flat', x: 0, z: 3.7, hw: 1.2, hd: 0.5, y: 1.7 },
    ],
  );
}

function moveFor(
  player: PlayerState,
  seconds: number,
  input: { forward: number; strafe: number; hurrying: boolean },
  world = EMPTY_WORLD,
): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    player.step(STEP, input, 0, world);
  }
}

describe('player movement', () => {
  it('accelerates into a camera-relative walk instead of changing speed instantly', () => {
    const player = new PlayerState([0, 0]);
    player.step(STEP, { forward: 1, strafe: 0, hurrying: false }, 0, EMPTY_WORLD);
    expect(player.x).toBeCloseTo(0);
    expect(player.speed).toBeGreaterThan(0);
    expect(player.speed).toBeLessThan(tuning.player.walk);
    moveFor(player, 1, { forward: 1, strafe: 0, hurrying: false });
    expect(player.speed).toBeCloseTo(tuning.player.walk);
  });

  it('normalizes diagonal input so it is not faster', () => {
    const player = new PlayerState([0, 0]);
    moveFor(player, 1, { forward: 1, strafe: 1, hurrying: false });
    expect(player.speed).toBeCloseTo(tuning.player.walk);
  });

  it('coasts briefly and then stops under tuned deceleration', () => {
    const player = new PlayerState([0, 0]);
    moveFor(player, 1, { forward: 1, strafe: 0, hurrying: false });
    player.step(STEP, { forward: 0, strafe: 0, hurrying: false }, 0, EMPTY_WORLD);
    expect(player.speed).toBeGreaterThan(0);
    expect(player.speed).toBeLessThan(tuning.player.walk);
    moveFor(player, 1, { forward: 0, strafe: 0, hurrying: false });
    expect(player.speed).toBe(0);
    expect(player.moving).toBe(false);
  });

  it('brakes through a sharp reversal before moving the other way', () => {
    const player = new PlayerState([0, 0]);
    moveFor(player, 1, { forward: 1, strafe: 0, hurrying: false });
    const before = player.z;
    player.step(STEP, { forward: -1, strafe: 0, hurrying: false }, 0, EMPTY_WORLD);
    expect(player.z).toBeGreaterThan(before);
    moveFor(player, 1, { forward: -1, strafe: 0, hurrying: false });
    expect(player.vz).toBeLessThan(0);
  });

  it('uses actual speed before treating hurried movement as suspicious running', () => {
    const player = new PlayerState([0, 0]);
    player.step(STEP, { forward: 1, strafe: 0, hurrying: true }, 0, EMPTY_WORLD);
    expect(player.hurrying).toBe(false);
    moveFor(player, 1, { forward: 1, strafe: 0, hurrying: true });
    expect(player.hurrying).toBe(true);
  });

  it('resolves against a wall and follows a reachable surface', () => {
    const world = new CollisionWorld(
      [{ x: 0, z: 0.7, hw: 2, hd: 0.2, y0: 0, y1: 3 }],
      [{ kind: 'flat', x: 0, z: 0, hw: 2, hd: 2, y: tuning.player.stepUp }],
    );
    const player = new PlayerState([0, 0]);
    player.step(0.25, { forward: 1, strafe: 0, hurrying: false }, 0, world);
    expect(player.z).toBeCloseTo(0.5 - tuning.player.radius);
    for (let i = 0; i < 60; i++) {
      player.step(1 / 60, { forward: 0, strafe: 0, hurrying: false }, 0, world);
    }
    expect(player.y).toBeCloseTo(tuning.player.stepUp);
  });

  it('stops immediately when an interaction roots the player', () => {
    const player = new PlayerState([0, 0]);
    moveFor(player, 1, { forward: 1, strafe: 0, hurrying: true });
    player.step(STEP, { forward: 1, strafe: 0, hurrying: true }, 0, EMPTY_WORLD, true);
    expect(player.speed).toBe(0);
    expect(player.vx).toBe(0);
    expect(player.vz).toBe(0);
  });

  it('does not convert collision push-out into lasting velocity', () => {
    const world = new CollisionWorld([
      { x: 0, z: 0, hw: 0.4, hd: 0.4, y0: 0, y1: 3 },
    ], []);
    const player = new PlayerState([0, 0]);
    player.step(STEP, { forward: 0, strafe: 0, hurrying: false }, 0, world);
    expect(player.speed).toBe(0);
    expect(player.vx).toBe(0);
    expect(player.vz).toBe(0);
    player.step(STEP, { forward: 0, strafe: 0, hurrying: false }, 0, world);
    expect(player.moving).toBe(false);
  });

  it('walks up discrete stairs, settles halfway, and reverses without snagging', () => {
    const world = stairWorld();
    const player = new PlayerState([0, -0.1]);
    moveFor(player, 0.75, { forward: 1, strafe: 0, hurrying: false }, world);
    const halfwayZ = player.z;
    const halfwayY = player.y;
    expect(halfwayZ).toBeGreaterThan(1);
    expect(halfwayY).toBeGreaterThan(0.4);
    moveFor(player, 0.6, { forward: 0, strafe: 0, hurrying: false }, world);
    expect(player.y).toBeCloseTo(world.groundHeight(player.x, player.z, player.y), 2);
    moveFor(player, 1.4, { forward: -1, strafe: 0, hurrying: false }, world);
    expect(player.z).toBeLessThan(0.2);
    expect(player.y).toBeCloseTo(0, 2);
  });

  it('descends quickly and slides along stair railings instead of getting stuck', () => {
    const world = stairWorld(true);
    const player = new PlayerState([0.2, 3.25]);
    player.y = player.py = 1.7;
    moveFor(player, 1.2, { forward: -1, strafe: 0.65, hurrying: true }, world);
    expect(player.z).toBeLessThan(0.8);
    expect(Math.abs(player.x)).toBeLessThan(0.35);
    moveFor(player, 0.5, { forward: 0, strafe: 0, hurrying: false }, world);
    expect(player.y).toBeLessThan(0.4);
  });
});
