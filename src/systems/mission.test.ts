import { describe, expect, it } from 'vitest';
import tuning from '../data/tuning.json';
import conductJson from '../data/conduct.json';
import { loadGameContent } from '../data/content';
import { MissionRunner, type MissionDef, type ObjectiveDef } from './mission';

const STEP = 1 / 60;
const OT = loadGameContent().mission;
const FULL = { file: 0, confidence: 100 };

function run(
  mission: MissionRunner,
  seconds: number,
  x: number,
  z: number,
  held: boolean,
  meters = FULL,
): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += STEP) {
    mission.step(STEP, x, z, held, meters);
  }
}

function mission(objectives: ObjectiveDef[], completeWhen?: MissionDef['completeWhen']): MissionDef {
  return {
    id: 'test',
    act: 1,
    date: '1978-01-01',
    brief: 'brief.test',
    objectives,
    ...(completeWhen ? { completeWhen } : {}),
  };
}

function objective(
  id: string,
  type: ObjectiveDef['checks'][number]['type'],
  extra: Partial<ObjectiveDef['checks'][number]> = {},
  node: Partial<ObjectiveDef> = {},
): ObjectiveDef {
  return {
    id,
    label: `objective.${id}`,
    completeWhen: 'any',
    checks: [{ id: `${id}_check`, type, ...extra }],
    ...node,
  };
}

describe('ordinary traffic graph', () => {
  it('queues the brief and exposes only the unlocked first objective', () => {
    const runner = new MissionRunner(OT);
    run(runner, STEP, 0, 0, false);
    expect(runner.radioQueue).toContain('handler.brief.ordinary_traffic');
    expect(runner.active?.id).toBe('collect');
    expect(runner.objectiveState('exit').status).toBe('locked');
  });

  it('holds at the drop, applies effects and unlocks exfiltration', () => {
    const runner = new MissionRunner(OT);
    const [x, z] = OT.objectives[0]!.checks[0]!.pos!;
    run(runner, 1, x, z, true);
    expect(runner.objectiveState('collect').status).toBe('available');
    run(runner, 2, x, z, true);
    expect(runner.objectiveState('collect').status).toBe('completed');
    expect(runner.active?.id).toBe('exit');
    expect(runner.flags['carrying']).toBe(true);
    expect(runner.tags).toContain('objective.drop_serviced');
    expect(runner.radioQueue).toContain('handler.now_carrying');
  });

  it('releasing the action key resets hold progress', () => {
    const runner = new MissionRunner(OT);
    const [x, z] = OT.objectives[0]!.checks[0]!.pos!;
    run(runner, 2, x, z, true);
    run(runner, 0.1, x, z, false);
    run(runner, 2, x, z, true);
    expect(runner.objectiveState('collect').status).toBe('available');
  });

  it('reports service conduct only while the interaction is held', () => {
    const runner = new MissionRunner(OT);
    const [x, z] = OT.objectives[0]!.checks[0]!.pos!;
    expect(runner.activeConductId()).toBeNull();
    run(runner, 1, x, z, true);
    expect(runner.activeConductId()).toBe('service');
    run(runner, 0.1, x, z, false);
    expect(runner.activeConductId()).toBeNull();
  });

  it('applies the operational multiplier while carrying', () => {
    const runner = new MissionRunner(OT);
    expect(runner.multiplier()).toBe(1);
    runner.flags['carrying'] = true;
    expect(runner.multiplier()).toBe(conductJson.multipliers.operational);
  });

  it('withholds exit intel without making the actual exit false', () => {
    const runner = new MissionRunner(OT);
    const [dropX, dropZ] = OT.objectives[0]!.checks[0]!.pos!;
    run(runner, 3, dropX, dropZ, true);
    const exit = OT.objectives.find((objective) => objective.id === 'exit')!;
    expect(runner.revealed(exit, { file: 0, confidence: 32 })).toBe(false);
    const [exitX, exitZ] = exit.checks[0]!.pos!;
    run(runner, 0.1, exitX, exitZ, false, { file: 0, confidence: 0 });
    expect(runner.status).toBe('complete');
  });

  it('fails only at the authored arrest threshold', () => {
    const below = new MissionRunner(OT);
    run(below, 1, 0, 0, false, { file: 99.9, confidence: 0 });
    expect(below.status).toBe('running');
    const arrested = new MissionRunner(OT);
    run(arrested, STEP, 0, 0, false, { file: 100, confidence: 100 });
    expect(arrested.status).toBe('failed');
    expect(arrested.ending).toBe('burned');
  });
});

describe('branching mission foundations', () => {
  it('supports genuinely alternative checks on one objective', () => {
    const getInside: ObjectiveDef = {
      id: 'access',
      label: 'objective.access',
      completeWhen: 'any',
      checks: [
        { id: 'papers', type: 'reach', pos: [1, 1], tags: ['approach.legitimate'] },
        { id: 'window', type: 'reach', pos: [9, 9], tags: ['approach.risky'] },
      ],
    };
    const runner = new MissionRunner(mission([getInside]));
    run(runner, 0.1, 9, 9, false);
    expect(runner.status).toBe('complete');
    expect(runner.tags).toContain('approach.risky');
    expect(runner.tags).not.toContain('approach.legitimate');
  });

  it('supports all-of completion checks for staged work', () => {
    const survey: ObjectiveDef = {
      id: 'survey',
      label: 'objective.survey',
      completeWhen: 'all',
      checks: [
        { id: 'door', type: 'reach', pos: [1, 1] },
        { id: 'yard', type: 'reach', pos: [10, 10] },
      ],
    };
    const runner = new MissionRunner(mission([survey]));
    run(runner, 0.1, 1, 1, false);
    expect(runner.status).toBe('running');
    run(runner, 0.1, 10, 10, false);
    expect(runner.status).toBe('complete');
  });

  it('skips mutually exclusive routes and converges them into a later stage', () => {
    const routeA = objective('papers', 'reach', { pos: [1, 1] }, {
      optional: true,
      exclusiveGroup: 'access_route',
      tags: ['approach.papers'],
    });
    const routeB = objective('alley', 'reach', { pos: [8, 8] }, {
      optional: true,
      exclusiveGroup: 'access_route',
      tags: ['approach.alley'],
    });
    const inside = objective('inside', 'reach', { pos: [4, 4] }, {
      availableWhen: {
        any: [
          { objective: 'papers', status: 'completed' },
          { objective: 'alley', status: 'completed' },
        ],
      },
    });
    const runner = new MissionRunner(mission(
      [routeA, routeB, inside],
      { objective: 'inside', status: 'completed' },
    ));
    run(runner, 0.1, 1, 1, false);
    expect(runner.objectiveState('papers').status).toBe('completed');
    expect(runner.objectiveState('alley').status).toBe('skipped');
    expect(runner.objectiveState('inside').status).toBe('available');
    run(runner, 0.1, 4, 4, false);
    expect(runner.status).toBe('complete');
  });

  it('discovers hidden objectives from changing world state', () => {
    const secret = objective('secret', 'reach', { pos: [3, 3] }, {
      hidden: true,
      optional: true,
      discoverWhen: { flag: 'heard_rumour', equals: true },
    });
    const runner = new MissionRunner(mission(
      [secret],
      { objective: 'secret', status: 'completed' },
    ));
    run(runner, STEP, 0, 0, false);
    expect(runner.available).toHaveLength(0);
    runner.flags['heard_rumour'] = true;
    run(runner, STEP, 0, 0, false);
    expect(runner.available.map((entry) => entry.id)).toEqual(['secret']);
  });

  it('soft-fails an opportunity without failing the mission', () => {
    const optional = objective('conversation', 'talk_to', { pos: [2, 2] }, {
      optional: true,
      softFailWhen: { meter: 'file', test: '>=35' },
      onSoftFail: [{ tag: 'opportunity.conversation_lost' }],
    });
    const exit = objective('exit', 'reach', { pos: [5, 5] });
    const runner = new MissionRunner(mission(
      [optional, exit],
      { objective: 'exit', status: 'completed' },
    ));
    run(runner, STEP, 0, 0, false, { file: 35, confidence: 100 });
    expect(runner.objectiveState('conversation').status).toBe('failed');
    expect(runner.status).toBe('running');
    expect(runner.tags).toContain('opportunity.conversation_lost');
  });

  it('supports wait, deliver and talk checks without new mission code', () => {
    const wait = new MissionRunner(mission([objective('wait', 'wait_until', { seconds: 0.2 })]));
    run(wait, 0.3, 0, 0, false);
    expect(wait.status).toBe('complete');

    const deliver = new MissionRunner(mission([objective('deliver', 'deliver', { pos: [5, 5] })]));
    deliver.flags['carrying'] = true;
    run(deliver, 0.1, 5, 5, false);
    expect(deliver.status).toBe('complete');

    const talk = new MissionRunner(mission([objective('talk', 'talk_to', { pos: [1, 1] })]));
    run(talk, tuning.interaction.talkHold + 0.1, 1, 1, true);
    expect(talk.status).toBe('complete');
  });

  it('produces debrief-ready objective states and route tags', () => {
    const exit = objective('exit', 'reach', {
      pos: [1, 1],
      tags: ['exit.quiet'],
    });
    const runner = new MissionRunner(mission([exit]));
    run(runner, 0.1, 1, 1, false);
    expect(runner.debrief()).toMatchObject({
      status: 'complete',
      completed: ['exit'],
      tags: ['exit.quiet'],
    });
  });
});
