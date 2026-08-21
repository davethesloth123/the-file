import { describe, expect, it } from 'vitest';
import { Patrol } from '../actors/patrol';
import { loadGameContent } from '../data/content';
import { CollisionWorld } from '../world/collision';
import { GameSession } from './session';

const STEP = 1 / 60;

describe('game session integration', () => {
  it('preserves the null case through the real player/patrol/session path', () => {
    const session = new GameSession(
      new CollisionWorld([], []), [0, 5], loadGameContent().mission,
    );
    const patrol = new Patrol([[0, 0], [0, 100]], 2);
    for (let i = 0; i < 60 * 60; i++) {
      session.stepPlayer(STEP, { forward: 1, strafe: 0, hurrying: false }, 0);
      session.stepMission(STEP, false);
      session.stepSurveillance(STEP, [patrol], []);
    }
    expect(session.file.value).toBe(0);
  });

  it('prices observed hurrying through the integrated surveillance phase', () => {
    const session = new GameSession(
      new CollisionWorld([], []), [0, 5], loadGameContent().mission,
    );
    const patrol = new Patrol([[0, 0], [0, 100]], 2);
    for (let i = 0; i < 60; i++) {
      session.stepPlayer(STEP, { forward: 1, strafe: 0, hurrying: true }, 0);
      session.stepMission(STEP, false);
      session.stepSurveillance(STEP, [patrol], []);
    }
    expect(session.file.value).toBeGreaterThan(0);
  });

  it('roots the player while a hold interaction is active', () => {
    const mission = loadGameContent().mission;
    const at = mission.objectives[0]!.checks[0]!.pos!;
    const session = new GameSession(new CollisionWorld([], []), at, mission);
    session.stepMission(STEP, true);
    const before = [session.player.x, session.player.z];
    session.stepPlayer(STEP, { forward: 1, strafe: 0, hurrying: true }, 0);
    expect([session.player.x, session.player.z]).toEqual(before);
  });
});
