import { describe, expect, it, vi } from 'vitest';
import { InteractionSystem } from './interaction';

interface Context { unlocked: boolean; count: number; npc: [number, number] }

function context(): Context {
  return { unlocked: false, count: 0, npc: [4, 0] };
}

describe('InteractionSystem', () => {
  it('focuses the nearest candidate and clears the prompt out of range', () => {
    const system = new InteractionSystem<Context>();
    const ctx = context();
    system.register({ id: 'far', verb: 'read', position: [1.5, 0], radius: 3, label: 'Far', onTrigger: vi.fn() });
    system.register({ id: 'near', verb: 'inspect', position: [0.5, 0], radius: 3, label: 'Near', onTrigger: vi.fn() });
    expect(system.step(0, 0, false, 1 / 60, ctx)?.id).toBe('near');
    expect(system.step(20, 20, false, 1 / 60, ctx)).toBeNull();
    expect(system.view).toBeNull();
  });

  it('lets explicit priority beat distance', () => {
    const system = new InteractionSystem<Context>();
    const ctx = context();
    system.register({ id: 'prop', verb: 'inspect', position: [0.2, 0], radius: 2, label: 'Prop', onTrigger: vi.fn() });
    system.register({ id: 'npc', verb: 'talk', position: [1, 0], radius: 2, priority: 5, label: 'NPC', onTrigger: vi.fn() });
    expect(system.step(0, 0, false, 1 / 60, ctx)?.id).toBe('npc');
  });

  it('advances a hold once and requires release before retriggering', () => {
    const system = new InteractionSystem<Context>();
    const ctx = context();
    const trigger = vi.fn((c: Context) => { c.count++; });
    system.register({ id: 'door', verb: 'open', position: [0, 0], label: 'Door', holdSeconds: 0.3, onTrigger: trigger });
    expect(system.step(0, 0, true, 0.1, ctx)?.progress).toBeCloseTo(1 / 3);
    system.step(0, 0, true, 0.1, ctx);
    system.step(0, 0, true, 0.1, ctx);
    system.step(0, 0, true, 1, ctx);
    expect(trigger).toHaveBeenCalledTimes(1);
    system.step(0, 0, false, 0.1, ctx);
    system.step(0, 0, true, 0.3, ctx);
    expect(trigger).toHaveBeenCalledTimes(2);
  });

  it('shows disabled explanations without activating them', () => {
    const system = new InteractionSystem<Context>();
    const ctx = context();
    const trigger = vi.fn();
    system.register({
      id: 'locked', verb: 'open', position: [0, 0],
      label: (c) => c.unlocked ? 'Open door' : 'Locked door',
      enabled: (c) => c.unlocked,
      onTrigger: trigger,
    });
    const view = system.step(0, 0, true, 1, ctx);
    expect(view).toMatchObject({ label: 'Locked door', key: null, enabled: false });
    expect(trigger).not.toHaveBeenCalled();
  });

  it('tracks a moving NPC position', () => {
    const system = new InteractionSystem<Context>();
    const ctx = context();
    system.register({ id: 'npc', verb: 'talk', position: () => ctx.npc, radius: 2, label: 'Talk', onTrigger: vi.fn() });
    expect(system.step(0, 0, false, 0.1, ctx)).toBeNull();
    ctx.npc = [1, 0];
    expect(system.step(0, 0, false, 0.1, ctx)?.id).toBe('npc');
  });
});
