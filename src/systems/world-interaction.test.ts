import { describe, expect, it } from 'vitest';
import type { DialogueEnvironment } from './dialogue';
import { WorldInteractionRuntime, type WorldInteractionDefinition } from './world-interaction';

function environment(): DialogueEnvironment {
  const flags: Record<string, boolean> = {};
  const facts = new Set<string>();
  const routes = new Set<string>();
  return {
    npcId: 'world', role: 'environment', location: 'district', activity: 'available',
    flag: (id) => flags[id], setFlag: (id, value) => { flags[id] = !!value; },
    suspicion: () => 0, adjustSuspicion: () => {}, chose: () => false,
    rememberChoice: () => {}, routeUnlocked: (id) => routes.has(id),
    unlockRoute: (id) => { routes.add(id); }, knows: (id) => facts.has(id),
    addFact: (id) => { facts.add(id); }, objectiveStatus: () => 'locked',
    discoverObjective: () => {}, addTag: () => {}, action: () => {},
  };
}

const notice: WorldInteractionDefinition = {
  id: 'notice', verb: 'read', pos: [0, 0], label: 'read.notice', speaker: 'speaker.you',
  text: 'notice.text', once: true, effects: [{ addFact: 'collection_day' }],
};

describe('world interaction content runtime', () => {
  it('applies authored information and remembers one-shot interactions', () => {
    const env = environment();
    const runtime = new WorldInteractionRuntime();
    expect(runtime.activate(notice, env)).toEqual({ speaker: 'speaker.you', text: 'notice.text' });
    expect(env.knows('collection_day')).toBe(true);
    expect(runtime.visible(notice, env)).toBe(false);
  });

  it('keeps locked interactions visible but prevents their effects', () => {
    const env = environment();
    const runtime = new WorldInteractionRuntime();
    const door: WorldInteractionDefinition = {
      ...notice, id: 'door', once: false, enabledWhen: { route: 'staff_door' },
      effects: [{ setFlag: 'inside', value: true }],
    };
    expect(runtime.visible(door, env)).toBe(true);
    expect(runtime.enabled(door, env)).toBe(false);
    expect(runtime.activate(door, env)).toBeNull();
    expect(env.flag('inside')).toBeUndefined();
  });
});
