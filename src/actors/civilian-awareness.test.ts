import { describe, expect, it } from 'vitest';
import { CivilianAwareness } from './civilian-awareness';

const base = {
  seesPlayer: true,
  unusualConduct: false,
  distance: 4,
  playerX: 0,
  playerZ: 4,
  playerMoving: true,
  npcMoving: false,
};

describe('civilian social awareness', () => {
  it('briefly acknowledges an ordinary nearby player without treating them as suspicious', () => {
    const awareness = new CivilianAwareness(0);
    const reaction = awareness.step(1 / 60, base);
    expect(reaction.state).toBe('glancing');
    expect(reaction.lookWeight).toBeGreaterThan(0);
    expect(awareness.attention.concern).toBe(0);
  });

  it('yields once when two moving people nearly collide', () => {
    const awareness = new CivilianAwareness(0);
    const close = { ...base, distance: 0.7, npcMoving: true };
    expect(awareness.step(1 / 60, close).stepAside).toBe(true);
    expect(awareness.step(1 / 60, close).stepAside).toBe(false);
  });

  it('watches and reports sustained unusual conduct only once per escalation', () => {
    const awareness = new CivilianAwareness(0);
    const unusual = { ...base, unusualConduct: true, distance: 1 };
    let reports = 0;
    let state = awareness.step(0, unusual).state;
    for (let i = 0; i < 260; i++) {
      const reaction = awareness.step(1 / 60, unusual);
      state = reaction.state;
      if (reaction.report) reports++;
    }
    expect(state).toBe('reporting');
    expect(reports).toBe(1);
  });

  it('returns attention to neutral after behavior normalizes', () => {
    const awareness = new CivilianAwareness(0);
    for (let i = 0; i < 70; i++) awareness.step(1 / 60, { ...base, unusualConduct: true });
    for (let i = 0; i < 300; i++) awareness.step(1 / 60, { ...base, seesPlayer: false, distance: 20 });
    expect(awareness.attention.state).toBe('routine');
    expect(awareness.attention.concern).toBe(0);
  });
});
