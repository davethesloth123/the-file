import { describe, expect, it } from 'vitest';
import {
  DialogueRuntime, dialogueCondition, type DialogueDefinition, type DialogueEnvironment,
} from './dialogue';
import type { MissionValue, ObjectiveConditionState } from './mission';

function environment(): DialogueEnvironment & { suspicionValue: number } {
  const flags: Record<string, MissionValue> = {};
  const choices = new Set<string>();
  const routes = new Set<string>();
  const facts = new Set<string>();
  const discovered = new Set<string>();
  const tags = new Set<string>();
  return {
    npcId: 'clerk', role: 'clerk', location: 'records', activity: 'working',
    suspicionValue: 0,
    flag: (id) => flags[id],
    setFlag: (id, value) => { flags[id] = value; },
    suspicion() { return this.suspicionValue; },
    adjustSuspicion(amount) { this.suspicionValue += amount; },
    chose: (dialogue, response) => choices.has(`${dialogue}:${response}`),
    rememberChoice: (dialogue, response) => { choices.add(`${dialogue}:${response}`); },
    routeUnlocked: (id) => routes.has(id),
    unlockRoute: (id) => { routes.add(id); },
    knows: (id) => facts.has(id),
    addFact: (id) => { facts.add(id); },
    objectiveStatus: (id) => discovered.has(id) ? 'discovered' : 'locked',
    discoverObjective: (id) => { discovered.add(id); },
    addTag: (id) => { tags.add(id); },
    action: () => {},
  };
}

const dialogue: DialogueDefinition = {
  id: 'records', npcId: 'clerk', prompt: 'dialogue.clerk.prompt',
  role: 'clerk', location: 'records', activity: 'working',
  start: 'hello', refusalNode: 'refuse',
  availableWhen: { suspicion: '<50' },
  nodes: {
    hello: {
      speaker: 'speaker.clerk', text: 'Hello.',
      responses: [
        {
          id: 'ask', text: 'Ask about the back door', next: 'answer',
          effects: [
            { suspicion: 8 }, { addFact: 'staff_door' }, { unlockRoute: 'records_staff' },
            { discoverObjective: 'alternate_access' }, { setFlag: 'knows_staff_door', value: true },
          ],
        },
        { id: 'leave', text: 'Leave', next: null },
      ],
    },
    answer: {
      speaker: 'speaker.clerk', text: 'It is behind the boiler room.',
      effects: [{ tag: 'dialogue.records_staff_route' }],
      responses: [{ id: 'thanks', text: 'Thank you', next: null }],
    },
    refuse: {
      speaker: 'speaker.clerk', text: 'I am busy.',
      responses: [{ id: 'leave', text: 'Leave', next: null }],
    },
  },
};

describe('DialogueRuntime', () => {
  it('filters conditions from role, suspicion and prior choices', () => {
    const env = environment();
    expect(dialogueCondition({ context: 'role', equals: 'clerk' }, env)).toBe(true);
    expect(dialogueCondition({ suspicion: '<10' }, env)).toBe(true);
    expect(dialogueCondition({ choice: { dialogue: 'records', response: 'ask' } }, env)).toBe(false);
  });

  it('branches, applies world effects and remembers the response', () => {
    const env = environment();
    const runtime = new DialogueRuntime();
    expect(runtime.start(dialogue, env)).toBe(true);
    expect(runtime.view?.responses).toHaveLength(2);
    const view = runtime.choose('ask');
    expect(view?.text).toContain('boiler room');
    expect(env.suspicionValue).toBe(8);
    expect(env.routeUnlocked('records_staff')).toBe(true);
    expect(env.knows('staff_door')).toBe(true);
    expect(env.flag('knows_staff_door')).toBe(true);
    expect(env.objectiveStatus('alternate_access')).toBe('discovered');
    expect(env.chose('records', 'ask')).toBe(true);
  });

  it('uses a refusal node when willingness conditions fail', () => {
    const env = environment();
    env.suspicionValue = 70;
    const runtime = new DialogueRuntime();
    expect(runtime.start(dialogue, env)).toBe(true);
    expect(runtime.view?.text).toBe('I am busy.');
  });

  it('closes cleanly on a terminal response', () => {
    const env = environment();
    const runtime = new DialogueRuntime();
    runtime.start(dialogue, env);
    expect(runtime.choose('leave')).toBeNull();
    expect(runtime.active).toBe(false);
  });
});
