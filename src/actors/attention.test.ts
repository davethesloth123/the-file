import { describe, expect, it } from 'vitest';
import { NpcAttention } from './attention';

const STEP = 1 / 60;

function observe(
  attention: NpcAttention,
  seconds: number,
  unusualConduct: boolean,
  distance = 8,
): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    attention.step(STEP, {
      seesPlayer: true,
      unusualConduct,
      distance,
      playerX: 0,
      playerZ: distance,
    });
  }
}

describe('temporary NPC attention', () => {
  it('does not treat ordinary visible presence as suspicious', () => {
    const attention = new NpcAttention();
    observe(attention, 60, false);
    expect(attention.state).toBe('routine');
    expect(attention.concern).toBe(0);
  });

  it('escalates unusual conduct from noticing to watching and approaching', () => {
    const attention = new NpcAttention();
    observe(attention, 0.5, true);
    expect(attention.state).toBe('noticing');
    observe(attention, 0.5, true);
    expect(attention.state).toBe('watching');
    observe(attention, 0.7, true);
    expect(attention.state).toBe('approaching');
  });

  it('questions nearby unusual conduct before reporting it', () => {
    const attention = new NpcAttention();
    observe(attention, 1.6, true);
    observe(attention, 0.2, true, 1);
    expect(attention.state).toBe('questioning');
    observe(attention, 2, true, 1);
    expect(attention.state).toBe('reporting');
  });

  it('returns to routine when the player normalizes their behavior', () => {
    const attention = new NpcAttention();
    observe(attention, 1, true);
    expect(attention.concern).toBeGreaterThan(0);
    observe(attention, 3, false);
    expect(attention.state).toBe('routine');
    expect(attention.concern).toBe(0);
  });
});
