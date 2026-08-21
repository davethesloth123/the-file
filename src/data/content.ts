// Runtime validation and resolution for authored game content. JSON imports
// enter the program as unknown data; only the typed values returned here may
// reach the simulation or level builder.
import mapJson from './map.zamostye.json';
import ordinaryTrafficJson from './missions/ordinary_traffic.json';
import ordinaryTrafficDialoguesJson from './dialogues.ordinary_traffic.json';
import ordinaryTrafficWorldInteractionsJson from './world_interactions.ordinary_traffic.json';
import type {
  DialogueCondition, DialogueDefinition, DialogueEffect, DialogueNodeDef, DialogueResponseDef,
} from '../systems/dialogue';
import type {
  CompletionMode, Effect, MissionCondition, MissionDef, MissionValue,
  ObjectiveCheckDef, ObjectiveConditionState, ObjectiveDef, ObjectiveMarkerMode, ObjectiveType,
} from '../systems/mission';
import type { InteractionVerb } from '../systems/interaction';
import type { WorldInteractionDefinition } from '../systems/world-interaction';

export type Vec2 = [number, number];

export interface WingDef {
  dx: number;
  dz: number;
  w: number;
  d: number;
  floorsDelta: number;
}

export interface BuildingDef {
  id: string;
  pos: Vec2;
  size: Vec2;
  floors: number;
  style: string;
  seed: number;
  yawDeg?: number;
  wings?: WingDef[];
  stateLintel?: boolean;
  chimney?: boolean;
  chamfer?: boolean;
  kind?: 'house';
  units?: number;
  open?: 'flats' | 'office' | 'works' | 'shops' | 'station' | 'motorpool';
}

export interface AmbientWalkerDef {
  id: string;
  archetype: string;
  route: Vec2[];
  waits?: number[];
  startIndex: number;
  speed?: number;
  height: number;
  coatIndex: number;
}

export interface StaticActorDef {
  id: string;
  archetype: string;
  at: string;
  yawDeg: number;
  coatIndex: number;
  height?: number;
}

export type InteractionSpotId = 'fence' | 'clerk' | 'station' | 'vera';

export interface InteractionSpotDef {
  id: InteractionSpotId;
  at: string;
}

export interface MapData {
  ground: { size: Vec2; material: string };
  pavements: { pos: Vec2; size: Vec2 }[];
  buildings: BuildingDef[];
  garages: { pos: Vec2; size: Vec2; yawDeg: number }[];
  walls: { from: Vec2; to: Vec2; h: number }[];
  cars: { pos: Vec2; yawDeg: number; color: string }[];
  plaza: { pos: Vec2; r: number; material: string };
  monument: { pos: Vec2; plinth: [number, number, number]; banner: [number, number, number] };
  tram: { x: number; railGap: number; from: number; to: number; wireHeight: number };
  lamps: { xs: number[]; from: number; to: number; step: number };
  manholes: Vec2[];
  trees: Vec2[];
  benches: { pos: Vec2; yawDeg: number }[];
  kiosks: { pos: Vec2; yawDeg: number }[];
  bins: Vec2[];
  boards: { pos: Vec2; yawDeg: number }[];
  phoneBooths: { pos: Vec2; yawDeg: number }[];
  postBoxes: Vec2[];
  pumps: Vec2[];
  washing: { from: Vec2; to: Vec2 }[];
  roadDashes: { from: Vec2; to: Vec2 }[];
  crossings: { pos: Vec2; len: number; across: string }[];
  bounds: { x: Vec2; z: Vec2 };
  patrols: { route: Vec2[] }[];
  colliders: { type: string; pos: Vec2; size: Vec2 }[];
  restricted: { id: string; pos: Vec2; r: number; label: string }[];
  waypoints: Record<string, Vec2>;
  spawns: Record<string, Vec2>;
  poles?: Vec2[];
  puddles?: [number, number, number, number][];
  ambientCast: AmbientWalkerDef[];
  staticActors: StaticActorDef[];
  interactions: InteractionSpotDef[];
}

export interface GameContent {
  map: MapData;
  mission: MissionDef;
  dialogues: DialogueDefinition[];
  worldInteractions: WorldInteractionDefinition[];
}

const OBJECTIVE_TYPES = new Set<ObjectiveType>([
  'reach', 'hold_at', 'talk_to', 'deliver', 'wait_until', 'flag',
]);
const COMPLETION_MODES = new Set<CompletionMode>(['any', 'all']);
const MARKER_MODES = new Set<ObjectiveMarkerMode>(['exact', 'none']);
const OBJECTIVE_STATES = new Set<ObjectiveConditionState>([
  'locked', 'available', 'completed', 'failed', 'skipped', 'discovered',
]);
const OPEN_KINDS = new Set([
  'flats', 'office', 'works', 'shops', 'station', 'motorpool',
]);
const INTERACTION_IDS = new Set<InteractionSpotId>(['fence', 'clerk', 'station', 'vera']);
const INTERACTION_VERBS = new Set<InteractionVerb>(['talk', 'inspect', 'open', 'read', 'use', 'sit']);

function fail(path: string, message: string): never {
  throw new Error(`Invalid game content at ${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(path, 'expected an array');
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) return fail(path, 'expected a non-empty string');
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail(path, 'expected a finite number');
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'expected a boolean');
  return value;
}

function vec(value: unknown, path: string): Vec2 {
  const a = array(value, path);
  if (a.length !== 2) return fail(path, 'expected a two-number coordinate');
  return [number(a[0], `${path}[0]`), number(a[1], `${path}[1]`)];
}

function vec3(value: unknown, path: string): [number, number, number] {
  const a = array(value, path);
  if (a.length !== 3) return fail(path, 'expected three numbers');
  return [number(a[0], `${path}[0]`), number(a[1], `${path}[1]`), number(a[2], `${path}[2]`)];
}

function optionalNumber(value: unknown, path: string): void {
  if (value !== undefined) number(value, path);
}

function optionalBoolean(value: unknown, path: string): void {
  if (value !== undefined) boolean(value, path);
}

function validatePositionedList(value: unknown, path: string, extra?: (o: Record<string, unknown>, itemPath: string) => void): void {
  array(value, path).forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    const o = record(item, itemPath);
    vec(o.pos, `${itemPath}.pos`);
    extra?.(o, itemPath);
  });
}

function validateSegmentList(value: unknown, path: string, extra?: (o: Record<string, unknown>, itemPath: string) => void): void {
  array(value, path).forEach((item, i) => {
    const itemPath = `${path}[${i}]`;
    const o = record(item, itemPath);
    vec(o.from, `${itemPath}.from`);
    vec(o.to, `${itemPath}.to`);
    extra?.(o, itemPath);
  });
}

function validateNamedPositions(value: unknown, path: string): void {
  const o = record(value, path);
  for (const [key, position] of Object.entries(o)) vec(position, `${path}.${key}`);
}

export function validateMapData(value: unknown): MapData {
  const map = record(value, 'map');
  const ground = record(map.ground, 'map.ground');
  vec(ground.size, 'map.ground.size');
  string(ground.material, 'map.ground.material');

  validatePositionedList(map.pavements, 'map.pavements', (o, p) => vec(o.size, `${p}.size`));
  array(map.buildings, 'map.buildings').forEach((item, i) => {
    const p = `map.buildings[${i}]`;
    const b = record(item, p);
    string(b.id, `${p}.id`);
    vec(b.pos, `${p}.pos`);
    vec(b.size, `${p}.size`);
    number(b.floors, `${p}.floors`);
    string(b.style, `${p}.style`);
    number(b.seed, `${p}.seed`);
    optionalNumber(b.yawDeg, `${p}.yawDeg`);
    optionalNumber(b.units, `${p}.units`);
    optionalBoolean(b.stateLintel, `${p}.stateLintel`);
    optionalBoolean(b.chimney, `${p}.chimney`);
    optionalBoolean(b.chamfer, `${p}.chamfer`);
    if (b.kind !== undefined && b.kind !== 'house') fail(`${p}.kind`, 'expected "house"');
    if (b.open !== undefined && (typeof b.open !== 'string' || !OPEN_KINDS.has(b.open))) {
      fail(`${p}.open`, 'unknown open-building kind');
    }
    if (b.wings !== undefined) {
      array(b.wings, `${p}.wings`).forEach((wing, wi) => {
        const wp = `${p}.wings[${wi}]`;
        const w = record(wing, wp);
        for (const key of ['dx', 'dz', 'w', 'd', 'floorsDelta']) number(w[key], `${wp}.${key}`);
      });
    }
  });
  validatePositionedList(map.garages, 'map.garages', (o, p) => {
    vec(o.size, `${p}.size`);
    number(o.yawDeg, `${p}.yawDeg`);
  });
  validateSegmentList(map.walls, 'map.walls', (o, p) => number(o.h, `${p}.h`));
  validatePositionedList(map.cars, 'map.cars', (o, p) => {
    number(o.yawDeg, `${p}.yawDeg`);
    string(o.color, `${p}.color`);
  });

  const plaza = record(map.plaza, 'map.plaza');
  vec(plaza.pos, 'map.plaza.pos');
  number(plaza.r, 'map.plaza.r');
  string(plaza.material, 'map.plaza.material');
  const monument = record(map.monument, 'map.monument');
  vec(monument.pos, 'map.monument.pos');
  vec3(monument.plinth, 'map.monument.plinth');
  vec3(monument.banner, 'map.monument.banner');
  const tram = record(map.tram, 'map.tram');
  for (const key of ['x', 'railGap', 'from', 'to', 'wireHeight']) number(tram[key], `map.tram.${key}`);
  const lamps = record(map.lamps, 'map.lamps');
  array(lamps.xs, 'map.lamps.xs').forEach((v, i) => number(v, `map.lamps.xs[${i}]`));
  for (const key of ['from', 'to', 'step']) number(lamps[key], `map.lamps.${key}`);

  for (const key of ['manholes', 'trees', 'bins', 'postBoxes', 'pumps'] as const) {
    array(map[key], `map.${key}`).forEach((v, i) => vec(v, `map.${key}[${i}]`));
  }
  for (const key of ['benches', 'kiosks', 'boards', 'phoneBooths'] as const) {
    validatePositionedList(map[key], `map.${key}`, (o, p) => number(o.yawDeg, `${p}.yawDeg`));
  }
  validateSegmentList(map.washing, 'map.washing');
  validateSegmentList(map.roadDashes, 'map.roadDashes');
  validatePositionedList(map.crossings, 'map.crossings', (o, p) => {
    number(o.len, `${p}.len`);
    string(o.across, `${p}.across`);
  });
  const bounds = record(map.bounds, 'map.bounds');
  vec(bounds.x, 'map.bounds.x');
  vec(bounds.z, 'map.bounds.z');

  array(map.patrols, 'map.patrols').forEach((item, i) => {
    const p = `map.patrols[${i}]`;
    const route = array(record(item, p).route, `${p}.route`);
    if (route.length < 2) fail(`${p}.route`, 'requires at least two points');
    route.forEach((point, pi) => vec(point, `${p}.route[${pi}]`));
  });
  validatePositionedList(map.colliders, 'map.colliders', (o, p) => {
    string(o.type, `${p}.type`);
    vec(o.size, `${p}.size`);
  });
  validatePositionedList(map.restricted, 'map.restricted', (o, p) => {
    string(o.id, `${p}.id`);
    number(o.r, `${p}.r`);
    string(o.label, `${p}.label`);
  });
  validateNamedPositions(map.waypoints, 'map.waypoints');
  validateNamedPositions(map.spawns, 'map.spawns');
  if (map.poles !== undefined) array(map.poles, 'map.poles').forEach((v, i) => vec(v, `map.poles[${i}]`));
  if (map.puddles !== undefined) {
    array(map.puddles, 'map.puddles').forEach((v, i) => {
      const p = array(v, `map.puddles[${i}]`);
      if (p.length !== 4) fail(`map.puddles[${i}]`, 'expected four numbers');
      p.forEach((n, ni) => number(n, `map.puddles[${i}][${ni}]`));
    });
  }

  const actorIds = new Set<string>();
  array(map.ambientCast, 'map.ambientCast').forEach((item, i) => {
    const p = `map.ambientCast[${i}]`;
    const actor = record(item, p);
    const id = string(actor.id, `${p}.id`);
    if (actorIds.has(id)) fail(`${p}.id`, 'duplicate actor id');
    actorIds.add(id);
    string(actor.archetype, `${p}.archetype`);
    const route = array(actor.route, `${p}.route`);
    if (route.length < 2) fail(`${p}.route`, 'requires at least two points');
    route.forEach((point, pi) => vec(point, `${p}.route[${pi}]`));
    if (actor.waits !== undefined) {
      const waits = array(actor.waits, `${p}.waits`);
      if (waits.length !== route.length) fail(`${p}.waits`, 'must match the route length');
      waits.forEach((wait, wi) => {
        if (number(wait, `${p}.waits[${wi}]`) < 0) fail(`${p}.waits[${wi}]`, 'must not be negative');
      });
    }
    const startIndex = number(actor.startIndex, `${p}.startIndex`);
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= route.length) {
      fail(`${p}.startIndex`, 'expected an index inside the route');
    }
    optionalNumber(actor.speed, `${p}.speed`);
    number(actor.height, `${p}.height`);
    number(actor.coatIndex, `${p}.coatIndex`);
  });
  array(map.staticActors, 'map.staticActors').forEach((item, i) => {
    const p = `map.staticActors[${i}]`;
    const actor = record(item, p);
    const id = string(actor.id, `${p}.id`);
    if (actorIds.has(id)) fail(`${p}.id`, 'duplicate actor id');
    actorIds.add(id);
    string(actor.archetype, `${p}.archetype`);
    string(actor.at, `${p}.at`);
    number(actor.yawDeg, `${p}.yawDeg`);
    number(actor.coatIndex, `${p}.coatIndex`);
    optionalNumber(actor.height, `${p}.height`);
  });
  const seenInteractions = new Set<string>();
  array(map.interactions, 'map.interactions').forEach((item, i) => {
    const p = `map.interactions[${i}]`;
    const spot = record(item, p);
    const id = string(spot.id, `${p}.id`);
    if (!INTERACTION_IDS.has(id as InteractionSpotId)) fail(`${p}.id`, 'unknown interaction id');
    if (seenInteractions.has(id)) fail(`${p}.id`, 'duplicate interaction id');
    seenInteractions.add(id);
    string(spot.at, `${p}.at`);
  });
  for (const id of INTERACTION_IDS) {
    if (!seenInteractions.has(id)) fail('map.interactions', `missing ${id} interaction`);
  }

  const validated = map as unknown as MapData;
  for (const actor of validated.staticActors) mapLocation(validated, actor.at);
  for (const spot of validated.interactions) mapLocation(validated, spot.at);
  return validated;
}

export function mapLocation(map: MapData, name: string): Vec2 {
  const value = map.spawns[name] ?? map.waypoints[name];
  if (!value) return fail(`map.locations.${name}`, 'unknown named location');
  return value;
}

function validateEffects(value: unknown, path: string): Effect[] {
  return array(value, path).map((item, i) => {
    const p = `${path}[${i}]`;
    const effect = record(item, p);
    if (effect.set !== undefined) {
      const set = string(effect.set, `${p}.set`);
      return { set, value: missionValue(effect.value, `${p}.value`) };
    }
    if (effect.radio !== undefined) return { radio: string(effect.radio, `${p}.radio`) };
    return { tag: string(effect.tag, `${p}.tag`) };
  });
}

function missionValue(value: unknown, path: string): MissionValue {
  if (!['boolean', 'number', 'string'].includes(typeof value)) {
    return fail(path, 'expected a boolean, number, or string');
  }
  return value as MissionValue;
}

function validateTags(value: unknown, path: string): string[] {
  return array(value, path).map((tag, i) => string(tag, `${path}[${i}]`));
}

function validateCondition(value: unknown, path: string): MissionCondition {
  const condition = record(value, path);
  const discriminants = ['objective', 'flag', 'meter', 'all', 'any', 'not']
    .filter((key) => condition[key] !== undefined);
  if (discriminants.length !== 1) return fail(path, 'expected exactly one condition type');

  if (condition.objective !== undefined) {
    const statusValue = string(condition.status, `${path}.status`);
    if (!OBJECTIVE_STATES.has(statusValue as ObjectiveConditionState)) {
      return fail(`${path}.status`, 'unknown objective state');
    }
    return {
      objective: string(condition.objective, `${path}.objective`),
      status: statusValue as ObjectiveConditionState,
    };
  }
  if (condition.flag !== undefined) {
    const result: Extract<MissionCondition, { flag: string }> = {
      flag: string(condition.flag, `${path}.flag`),
    };
    if (condition.equals !== undefined) result.equals = missionValue(condition.equals, `${path}.equals`);
    return result;
  }
  if (condition.meter !== undefined) {
    const meter = string(condition.meter, `${path}.meter`);
    if (meter !== 'file' && meter !== 'confidence') return fail(`${path}.meter`, 'unknown meter');
    const test = string(condition.test, `${path}.test`);
    if (!/^(>=|<=|>|<)\s*\d+(?:\.\d+)?$/.test(test)) {
      return fail(`${path}.test`, 'expected a numeric comparison');
    }
    return { meter, test };
  }
  if (condition.all !== undefined || condition.any !== undefined) {
    const mode = condition.all !== undefined ? 'all' : 'any';
    const values = array(condition[mode], `${path}.${mode}`);
    if (values.length === 0) return fail(`${path}.${mode}`, 'requires at least one condition');
    return ({
      [mode]: values.map((part, i) => validateCondition(part, `${path}.${mode}[${i}]`)),
    } as Extract<MissionCondition, { all: MissionCondition[] } | { any: MissionCondition[] }>);
  }
  return { not: validateCondition(condition.not, `${path}.not`) };
}

function validateCheck(value: unknown, path: string, map: MapData): ObjectiveCheckDef {
  const check = record(value, path);
  const id = string(check.id, `${path}.id`);
  const typeValue = string(check.type, `${path}.type`);
  if (!OBJECTIVE_TYPES.has(typeValue as ObjectiveType)) fail(`${path}.type`, 'unknown objective type');
  const type = typeValue as ObjectiveType;
  const result: ObjectiveCheckDef = { id, type };
  if (check.at !== undefined) result.pos = mapLocation(map, string(check.at, `${path}.at`));
  else if (check.pos !== undefined) result.pos = vec(check.pos, `${path}.pos`);
  if (type !== 'wait_until' && type !== 'flag' && !result.pos) fail(path, `${type} requires "at" or "pos"`);
  if (check.seconds !== undefined) result.seconds = number(check.seconds, `${path}.seconds`);
  if (check.radius !== undefined) result.radius = number(check.radius, `${path}.radius`);
  if (check.conduct !== undefined) result.conduct = string(check.conduct, `${path}.conduct`);
  if (check.flag !== undefined) result.flag = string(check.flag, `${path}.flag`);
  if (check.prompt !== undefined) result.prompt = string(check.prompt, `${path}.prompt`);
  if (check.onComplete !== undefined) result.onComplete = validateEffects(check.onComplete, `${path}.onComplete`);
  if (check.tags !== undefined) result.tags = validateTags(check.tags, `${path}.tags`);
  return result;
}

function conditionObjectiveIds(condition: MissionCondition | undefined): string[] {
  if (!condition) return [];
  if ('objective' in condition) return [condition.objective];
  if ('all' in condition) return condition.all.flatMap(conditionObjectiveIds);
  if ('any' in condition) return condition.any.flatMap(conditionObjectiveIds);
  if ('not' in condition) return conditionObjectiveIds(condition.not);
  return [];
}

function validateConditionReferences(
  condition: MissionCondition | undefined,
  objectiveIds: ReadonlySet<string>,
  path: string,
): void {
  for (const id of conditionObjectiveIds(condition)) {
    if (!objectiveIds.has(id)) fail(path, `references unknown objective "${id}"`);
  }
}

function validateAvailabilityGraph(objectives: ObjectiveDef[]): void {
  const dependencies = new Map(
    objectives.map((objective) => [objective.id, conditionObjectiveIds(objective.availableWhen)]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) fail(`mission.objectives.${id}.availableWhen`, 'objective dependency cycle');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const objective of objectives) visit(objective.id);
}

export function validateMissionData(value: unknown, map: MapData): MissionDef {
  const raw = record(value, 'mission');
  const objectiveIds = new Set<string>();
  const objectives = array(raw.objectives, 'mission.objectives').map((item, i): ObjectiveDef => {
    const p = `mission.objectives[${i}]`;
    const o = record(item, p);
    const id = string(o.id, `${p}.id`);
    if (objectiveIds.has(id)) fail(`${p}.id`, 'duplicate objective id');
    objectiveIds.add(id);
    const checks = array(o.checks, `${p}.checks`).map((check, ci) =>
      validateCheck(check, `${p}.checks[${ci}]`, map));
    if (checks.length === 0) fail(`${p}.checks`, 'requires at least one completion check');
    const checkIds = new Set<string>();
    for (const check of checks) {
      if (checkIds.has(check.id)) fail(`${p}.checks`, `duplicate check id "${check.id}"`);
      checkIds.add(check.id);
    }
    const modeValue = o.completeWhen === undefined
      ? 'any'
      : string(o.completeWhen, `${p}.completeWhen`);
    if (!COMPLETION_MODES.has(modeValue as CompletionMode)) {
      fail(`${p}.completeWhen`, 'expected "any" or "all"');
    }
    const objective: ObjectiveDef = {
      id,
      label: string(o.label, `${p}.label`),
      checks,
      completeWhen: modeValue as CompletionMode,
    };
    if (o.optional !== undefined) objective.optional = boolean(o.optional, `${p}.optional`);
    if (o.hidden !== undefined) objective.hidden = boolean(o.hidden, `${p}.hidden`);
    if (o.exclusiveGroup !== undefined) {
      objective.exclusiveGroup = string(o.exclusiveGroup, `${p}.exclusiveGroup`);
    }
    if (o.marker !== undefined) {
      const marker = string(o.marker, `${p}.marker`);
      if (!MARKER_MODES.has(marker as ObjectiveMarkerMode)) {
        fail(`${p}.marker`, 'expected "exact" or "none"');
      }
      objective.marker = marker as ObjectiveMarkerMode;
    }
    if (o.availableWhen !== undefined) {
      objective.availableWhen = validateCondition(o.availableWhen, `${p}.availableWhen`);
    }
    if (o.discoverWhen !== undefined) {
      objective.discoverWhen = validateCondition(o.discoverWhen, `${p}.discoverWhen`);
    }
    if (o.softFailWhen !== undefined) {
      objective.softFailWhen = validateCondition(o.softFailWhen, `${p}.softFailWhen`);
    }
    if (o.revealIf !== undefined) {
      const conditions = record(o.revealIf, `${p}.revealIf`);
      objective.revealIf = Object.fromEntries(
        Object.entries(conditions).map(([meter, expr]) => [meter, string(expr, `${p}.revealIf.${meter}`)]),
      );
    }
    if (o.onComplete !== undefined) objective.onComplete = validateEffects(o.onComplete, `${p}.onComplete`);
    if (o.onSoftFail !== undefined) objective.onSoftFail = validateEffects(o.onSoftFail, `${p}.onSoftFail`);
    if (o.tags !== undefined) objective.tags = validateTags(o.tags, `${p}.tags`);
    return objective;
  });
  if (objectives.length === 0) fail('mission.objectives', 'requires at least one objective');

  const mission: MissionDef = {
    id: string(raw.id, 'mission.id'),
    act: number(raw.act, 'mission.act'),
    date: string(raw.date, 'mission.date'),
    brief: string(raw.brief, 'mission.brief'),
    objectives,
  };
  if (raw.completeWhen !== undefined) {
    mission.completeWhen = validateCondition(raw.completeWhen, 'mission.completeWhen');
  }
  if (!mission.completeWhen && objectives.every((objective) => objective.optional)) {
    fail('mission.completeWhen', 'required when every objective is optional');
  }
  if (raw.fail !== undefined) {
    mission.fail = array(raw.fail, 'mission.fail').map((item, i) => {
      const p = `mission.fail[${i}]`;
      const f = record(item, p);
      const when = string(f.when, `${p}.when`);
      if (!/^(file|confidence)\s*(>=|<=|>|<)\s*\d+(?:\.\d+)?$/.test(when)) {
        fail(`${p}.when`, 'expected a file/confidence comparison');
      }
      return { when, ending: string(f.ending, `${p}.ending`) };
    });
  }
  for (const [i, objective] of objectives.entries()) {
    validateConditionReferences(objective.availableWhen, objectiveIds, `mission.objectives[${i}].availableWhen`);
    validateConditionReferences(objective.discoverWhen, objectiveIds, `mission.objectives[${i}].discoverWhen`);
    validateConditionReferences(objective.softFailWhen, objectiveIds, `mission.objectives[${i}].softFailWhen`);
  }
  validateConditionReferences(mission.completeWhen, objectiveIds, 'mission.completeWhen');
  validateAvailabilityGraph(objectives);
  return mission;
}

function validateDialogueCondition(value: unknown, path: string): DialogueCondition {
  const condition = record(value, path);
  const kinds = ['flag', 'suspicion', 'choice', 'route', 'fact', 'objective', 'context', 'all', 'any', 'not']
    .filter((key) => condition[key] !== undefined);
  if (kinds.length !== 1) return fail(path, 'expected exactly one dialogue condition type');
  if (condition.flag !== undefined) {
    const result: Extract<DialogueCondition, { flag: string }> = {
      flag: string(condition.flag, `${path}.flag`),
    };
    if (condition.equals !== undefined) result.equals = missionValue(condition.equals, `${path}.equals`);
    return result;
  }
  if (condition.suspicion !== undefined) {
    const test = string(condition.suspicion, `${path}.suspicion`);
    if (!/^(>=|<=|>|<|=)\s*\d+(?:\.\d+)?$/.test(test)) fail(`${path}.suspicion`, 'expected a numeric comparison');
    return { suspicion: test };
  }
  if (condition.choice !== undefined) {
    const choice = record(condition.choice, `${path}.choice`);
    const result: Extract<DialogueCondition, { choice: unknown }> = {
      choice: {
        dialogue: string(choice.dialogue, `${path}.choice.dialogue`),
        response: string(choice.response, `${path}.choice.response`),
      },
    };
    if (choice.chosen !== undefined) result.choice.chosen = boolean(choice.chosen, `${path}.choice.chosen`);
    return result;
  }
  if (condition.route !== undefined) {
    const result: Extract<DialogueCondition, { route: string }> = { route: string(condition.route, `${path}.route`) };
    if (condition.unlocked !== undefined) result.unlocked = boolean(condition.unlocked, `${path}.unlocked`);
    return result;
  }
  if (condition.fact !== undefined) {
    const result: Extract<DialogueCondition, { fact: string }> = { fact: string(condition.fact, `${path}.fact`) };
    if (condition.known !== undefined) result.known = boolean(condition.known, `${path}.known`);
    return result;
  }
  if (condition.objective !== undefined) {
    const status = string(condition.status, `${path}.status`);
    if (!OBJECTIVE_STATES.has(status as ObjectiveConditionState)) fail(`${path}.status`, 'unknown objective state');
    return { objective: string(condition.objective, `${path}.objective`), status: status as ObjectiveConditionState };
  }
  if (condition.context !== undefined) {
    const context = string(condition.context, `${path}.context`);
    if (!['role', 'location', 'activity'].includes(context)) fail(`${path}.context`, 'unknown context field');
    return {
      context: context as 'role' | 'location' | 'activity',
      equals: string(condition.equals, `${path}.equals`),
    };
  }
  if (condition.all !== undefined || condition.any !== undefined) {
    const mode = condition.all !== undefined ? 'all' : 'any';
    const parts = array(condition[mode], `${path}.${mode}`);
    if (parts.length === 0) fail(`${path}.${mode}`, 'requires at least one condition');
    return {
      [mode]: parts.map((part, i) => validateDialogueCondition(part, `${path}.${mode}[${i}]`)),
    } as Extract<DialogueCondition, { all: DialogueCondition[] } | { any: DialogueCondition[] }>;
  }
  return { not: validateDialogueCondition(condition.not, `${path}.not`) };
}

function validateDialogueEffects(value: unknown, path: string): DialogueEffect[] {
  return array(value, path).map((item, i) => {
    const p = `${path}[${i}]`;
    const effect = record(item, p);
    const kinds = ['setFlag', 'suspicion', 'unlockRoute', 'addFact', 'discoverObjective', 'action', 'tag']
      .filter((key) => effect[key] !== undefined);
    if (kinds.length !== 1) return fail(p, 'expected exactly one dialogue effect type');
    if (effect.setFlag !== undefined) {
      return { setFlag: string(effect.setFlag, `${p}.setFlag`), value: missionValue(effect.value, `${p}.value`) };
    }
    if (effect.suspicion !== undefined) return { suspicion: number(effect.suspicion, `${p}.suspicion`) };
    if (effect.unlockRoute !== undefined) return { unlockRoute: string(effect.unlockRoute, `${p}.unlockRoute`) };
    if (effect.addFact !== undefined) return { addFact: string(effect.addFact, `${p}.addFact`) };
    if (effect.discoverObjective !== undefined) return { discoverObjective: string(effect.discoverObjective, `${p}.discoverObjective`) };
    if (effect.action !== undefined) return { action: string(effect.action, `${p}.action`) };
    return { tag: string(effect.tag, `${p}.tag`) };
  });
}

export function validateDialogueData(value: unknown): DialogueDefinition[] {
  const ids = new Set<string>();
  const npcIds = new Set<string>();
  return array(value, 'dialogues').map((item, i) => {
    const p = `dialogues[${i}]`;
    const raw = record(item, p);
    const id = string(raw.id, `${p}.id`);
    const npcId = string(raw.npcId, `${p}.npcId`);
    if (ids.has(id)) fail(`${p}.id`, 'duplicate dialogue id');
    if (npcIds.has(npcId)) fail(`${p}.npcId`, 'duplicate NPC dialogue');
    ids.add(id); npcIds.add(npcId);
    const nodeRaw = record(raw.nodes, `${p}.nodes`);
    const nodes: Record<string, DialogueNodeDef> = {};
    for (const [nodeId, nodeValue] of Object.entries(nodeRaw)) {
      const np = `${p}.nodes.${nodeId}`;
      const node = record(nodeValue, np);
      const responseIds = new Set<string>();
      const responses: DialogueResponseDef[] = array(node.responses, `${np}.responses`).map((responseValue, ri) => {
        const rp = `${np}.responses[${ri}]`;
        const response = record(responseValue, rp);
        const responseId = string(response.id, `${rp}.id`);
        if (responseIds.has(responseId)) fail(`${rp}.id`, 'duplicate response id in node');
        responseIds.add(responseId);
        const result: DialogueResponseDef = {
          id: responseId,
          text: string(response.text, `${rp}.text`),
          next: response.next === null ? null : string(response.next, `${rp}.next`),
        };
        if (response.when !== undefined) result.when = validateDialogueCondition(response.when, `${rp}.when`);
        if (response.effects !== undefined) result.effects = validateDialogueEffects(response.effects, `${rp}.effects`);
        return result;
      });
      if (responses.length === 0) fail(`${np}.responses`, 'requires at least one response');
      nodes[nodeId] = {
        speaker: string(node.speaker, `${np}.speaker`),
        text: string(node.text, `${np}.text`),
        responses,
        ...(node.effects === undefined ? {} : { effects: validateDialogueEffects(node.effects, `${np}.effects`) }),
      };
    }
    const start = string(raw.start, `${p}.start`);
    const refusalNode = raw.refusalNode === undefined ? undefined : string(raw.refusalNode, `${p}.refusalNode`);
    if (!nodes[start]) fail(`${p}.start`, 'references a missing node');
    if (refusalNode && !nodes[refusalNode]) fail(`${p}.refusalNode`, 'references a missing node');
    for (const [nodeId, node] of Object.entries(nodes)) {
      for (const response of node.responses) {
        if (response.next !== null && !nodes[response.next]) {
          fail(`${p}.nodes.${nodeId}.responses.${response.id}.next`, 'references a missing node');
        }
      }
    }
    const result: DialogueDefinition = {
      id, npcId,
      prompt: string(raw.prompt, `${p}.prompt`),
      role: string(raw.role, `${p}.role`),
      location: string(raw.location, `${p}.location`),
      activity: string(raw.activity, `${p}.activity`),
      start, nodes,
    };
    if (refusalNode) result.refusalNode = refusalNode;
    if (raw.availableWhen !== undefined) result.availableWhen = validateDialogueCondition(raw.availableWhen, `${p}.availableWhen`);
    return result;
  });
}

export function validateWorldInteractionData(value: unknown): WorldInteractionDefinition[] {
  const ids = new Set<string>();
  return array(value, 'worldInteractions').map((item, i) => {
    const p = `worldInteractions[${i}]`;
    const raw = record(item, p);
    const id = string(raw.id, `${p}.id`);
    if (ids.has(id)) fail(`${p}.id`, 'duplicate world interaction id');
    ids.add(id);
    const verb = string(raw.verb, `${p}.verb`);
    if (!INTERACTION_VERBS.has(verb as InteractionVerb)) fail(`${p}.verb`, 'unknown interaction verb');
    const result: WorldInteractionDefinition = {
      id,
      verb: verb as InteractionVerb,
      pos: vec(raw.pos, `${p}.pos`),
      label: string(raw.label, `${p}.label`),
      speaker: string(raw.speaker, `${p}.speaker`),
      text: string(raw.text, `${p}.text`),
    };
    if (raw.disabledLabel !== undefined) result.disabledLabel = string(raw.disabledLabel, `${p}.disabledLabel`);
    if (raw.radius !== undefined) result.radius = number(raw.radius, `${p}.radius`);
    if (raw.holdSeconds !== undefined) result.holdSeconds = number(raw.holdSeconds, `${p}.holdSeconds`);
    if (raw.once !== undefined) result.once = boolean(raw.once, `${p}.once`);
    if (raw.visibleWhen !== undefined) result.visibleWhen = validateDialogueCondition(raw.visibleWhen, `${p}.visibleWhen`);
    if (raw.enabledWhen !== undefined) result.enabledWhen = validateDialogueCondition(raw.enabledWhen, `${p}.enabledWhen`);
    if (raw.effects !== undefined) result.effects = validateDialogueEffects(raw.effects, `${p}.effects`);
    return result;
  });
}

export function parseGameContent(
  mapValue: unknown,
  missionValue: unknown,
  dialogueValue: unknown = ordinaryTrafficDialoguesJson,
  worldInteractionValue: unknown = ordinaryTrafficWorldInteractionsJson,
): GameContent {
  const map = validateMapData(mapValue);
  return {
    map,
    mission: validateMissionData(missionValue, map),
    dialogues: validateDialogueData(dialogueValue),
    worldInteractions: validateWorldInteractionData(worldInteractionValue),
  };
}

/** Validate on demand so bootstrap can surface a readable loading error. */
export function loadGameContent(): GameContent {
  return parseGameContent(
    mapJson,
    ordinaryTrafficJson,
    ordinaryTrafficDialoguesJson,
    ordinaryTrafficWorldInteractionsJson,
  );
}
