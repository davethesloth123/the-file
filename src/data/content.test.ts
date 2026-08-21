import { describe, expect, it } from 'vitest';
import mapJson from './map.zamostye.json';
import missionJson from './missions/ordinary_traffic.json';
import { loadGameContent, parseGameContent } from './content';

describe('game content validation', () => {
  it('resolves mission locations through the validated map', () => {
    const content = loadGameContent();
    expect(content.mission.objectives[0]!.checks[0]!.pos).toEqual(content.map.spawns['dead_drop']);
    expect(content.mission.objectives.find((objective) => objective.id === 'exit')!.checks[0]!.pos)
      .toEqual(content.map.spawns['exit_north']);
    expect(content.map.ambientCast).toHaveLength(8);
    expect(content.map.ambientCast.every((actor) => actor.waits?.length === actor.route.length)).toBe(true);
    expect(content.map.staticActors.map((actor) => actor.id)).toEqual(['grigori', 'vera']);
    expect(content.dialogues).toHaveLength(8);
    expect(content.dialogues.map((dialogue) => dialogue.npcId)).toContain('park_young_woman');
  });

  it('rejects a mission that references an unknown location', () => {
    const mission = structuredClone(missionJson) as unknown as {
      objectives: { checks: Record<string, unknown>[] }[];
    };
    mission.objectives[0]!.checks[0]!['at'] = 'missing_place';
    expect(() => parseGameContent(mapJson, mission)).toThrow(/unknown named location/);
  });

  it('rejects an ambient route that cannot form a route', () => {
    const map = structuredClone(mapJson) as unknown as {
      ambientCast: { route: number[][] }[];
    };
    map.ambientCast[0]!.route = [[0, 0]];
    expect(() => parseGameContent(map, missionJson)).toThrow(/requires at least two points/);
  });

  it('rejects duplicate interaction roles', () => {
    const map = structuredClone(mapJson) as unknown as {
      interactions: { id: string; at: string }[];
    };
    map.interactions[1]!.id = map.interactions[0]!.id;
    expect(() => parseGameContent(map, missionJson)).toThrow(/duplicate interaction id/);
  });

  it('rejects graph conditions that reference missing objectives', () => {
    const mission = structuredClone(missionJson) as unknown as {
      objectives: Record<string, unknown>[];
    };
    mission.objectives[1]!['availableWhen'] = {
      objective: 'missing_route',
      status: 'completed',
    };
    expect(() => parseGameContent(mapJson, mission)).toThrow(/unknown objective "missing_route"/);
  });

  it('rejects dependency cycles that could leave a mission permanently locked', () => {
    const mission = structuredClone(missionJson) as unknown as {
      objectives: Record<string, unknown>[];
    };
    mission.objectives[0]!['availableWhen'] = { objective: 'exit', status: 'completed' };
    expect(() => parseGameContent(mapJson, mission)).toThrow(/dependency cycle/);
  });

  it('rejects duplicate completion-check ids inside an objective', () => {
    const mission = structuredClone(missionJson) as unknown as {
      objectives: { checks: Record<string, unknown>[] }[];
    };
    mission.objectives[0]!.checks.push(structuredClone(mission.objectives[0]!.checks[0]!));
    expect(() => parseGameContent(mapJson, mission)).toThrow(/duplicate check id/);
  });

  it('requires an explicit completion rule when every objective is optional', () => {
    const mission = structuredClone(missionJson) as unknown as {
      completeWhen?: unknown;
      objectives: Record<string, unknown>[];
    };
    delete mission.completeWhen;
    for (const objective of mission.objectives) objective['optional'] = true;
    expect(() => parseGameContent(mapJson, mission)).toThrow(/every objective is optional/);
  });

  it('rejects routine waits that do not match their route', () => {
    const map = structuredClone(mapJson) as unknown as {
      ambientCast: { waits: number[] }[];
    };
    map.ambientCast[0]!.waits = [1];
    expect(() => parseGameContent(map, missionJson)).toThrow(/match the route length/);
  });
});
