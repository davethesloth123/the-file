import { describe, expect, it } from 'vitest';
import { RoutineAgent } from './routine';

const STEP = 1 / 60;
const STOPS = [
  { pos: [0, 0] as [number, number], waitSeconds: 0.5 },
  { pos: [0, 5] as [number, number], waitSeconds: 0.25 },
];

function stepFor(agent: RoutineAgent, seconds: number): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) agent.step(STEP);
}

describe('NPC routines', () => {
  it('honors authored waits before continuing a route', () => {
    const agent = new RoutineAgent(STOPS, 0, 2);
    stepFor(agent, 0.25);
    expect(agent.state).toBe('waiting');
    expect(agent.z).toBe(0);
    stepFor(agent, 0.5);
    expect(agent.state).toBe('moving');
    expect(agent.z).toBeGreaterThan(0);
  });

  it('accelerates, brakes into a stop, waits, and loops the schedule', () => {
    const agent = new RoutineAgent(STOPS, 0, 2);
    stepFor(agent, 4);
    expect(agent.z).toBeGreaterThan(3.5);
    expect(['waiting', 'moving']).toContain(agent.state);
    const nearNorthStop = agent.z;
    stepFor(agent, 4);
    expect(agent.z).toBeLessThan(nearNorthStop);
  });

  it('can be interrupted by an event and then returns to its schedule', () => {
    const agent = new RoutineAgent(STOPS, 0, 2);
    stepFor(agent, 0.6);
    agent.interrupt('conversation', 0.5);
    const interruptedAt = agent.z;
    stepFor(agent, 0.25);
    expect(agent.state).toBe('interrupted');
    expect(agent.z).toBe(interruptedAt);
    stepFor(agent, 0.5);
    expect(agent.state).toBe('returning');
    stepFor(agent, 0.5);
    expect(agent.z).toBeGreaterThan(interruptedAt);
  });

  it('can temporarily reposition for an event before resuming', () => {
    const agent = new RoutineAgent(STOPS, 0, 2);
    agent.interrupt('inspect_noise', 0.25, [2, 0]);
    stepFor(agent, 2);
    expect(agent.x).toBeGreaterThan(1);
    expect(agent.interruptionReason).toBeNull();
    expect(agent.state).not.toBe('interrupted');
  });

  it('pauses for conversation without discarding its scheduled state', () => {
    const agent = new RoutineAgent(STOPS, 0, 2);
    stepFor(agent, 0.7);
    const at = [agent.x, agent.z];
    const state = agent.state;
    agent.pause('conversation');
    stepFor(agent, 2);
    expect(agent.paused).toBe(true);
    expect([agent.x, agent.z]).toEqual(at);
    expect(agent.state).toBe(state);
    agent.resume('conversation');
    stepFor(agent, 0.5);
    expect(agent.paused).toBe(false);
    expect(agent.z).toBeGreaterThan(at[1]!);
  });
});
