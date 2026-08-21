// Data-driven mission graph. Objectives may unlock from flags, meters, or
// other objective states; several objectives can be available at once; nodes
// can be optional, hidden, soft-failed, mutually exclusive, and converged by
// later prerequisites. Each node may also offer several genuinely different
// completion checks. Simulation remains fixed-step and render-independent.
import conductJson from '../data/conduct.json';
import { MULTIPLIERS } from './conduct';
import { HoldToAct, within, REACH_RADIUS, PROMPT_RADIUS, TALK_HOLD } from './interaction';

export type ObjectiveType = 'reach' | 'hold_at' | 'talk_to' | 'deliver' | 'wait_until' | 'flag';
export type ObjectiveStatus = 'locked' | 'available' | 'completed' | 'failed' | 'skipped';
export type ObjectiveConditionState = ObjectiveStatus | 'discovered';
export type CompletionMode = 'any' | 'all';
export type ObjectiveMarkerMode = 'exact' | 'none';
export type MissionValue = boolean | number | string;

export type Effect =
  | { set: string; value: MissionValue }
  | { radio: string }
  | { tag: string };

export type MissionCondition =
  | { objective: string; status: ObjectiveConditionState }
  | { flag: string; equals?: MissionValue }
  | { meter: 'file' | 'confidence'; test: string }
  | { all: MissionCondition[] }
  | { any: MissionCondition[] }
  | { not: MissionCondition };

export interface ObjectiveCheckDef {
  id: string;
  type: ObjectiveType;
  pos?: [number, number];
  seconds?: number;
  radius?: number;
  conduct?: string;
  flag?: string;
  prompt?: string;
  onComplete?: Effect[];
  tags?: string[];
}

export interface ObjectiveDef {
  id: string;
  label: string;
  checks: ObjectiveCheckDef[];
  completeWhen: CompletionMode;
  optional?: boolean;
  hidden?: boolean;
  availableWhen?: MissionCondition;
  discoverWhen?: MissionCondition;
  softFailWhen?: MissionCondition;
  exclusiveGroup?: string;
  marker?: ObjectiveMarkerMode;
  revealIf?: Record<string, string>;
  onComplete?: Effect[];
  onSoftFail?: Effect[];
  tags?: string[];
}

export interface MissionDef {
  id: string;
  act: number;
  date: string;
  brief: string;
  objectives: ObjectiveDef[];
  completeWhen?: MissionCondition;
  fail?: { when: string; ending: string }[];
}

export interface Meters {
  file: number;
  confidence: number;
}

export interface ObjectiveRuntimeState {
  status: ObjectiveStatus;
  discovered: boolean;
  completedChecks: Set<string>;
}

export interface MissionDebrief {
  status: MissionRunner['status'];
  ending: string | null;
  tags: string[];
  completed: string[];
  failed: string[];
  skipped: string[];
}

export interface MissionEvent {
  type: 'discovered' | 'completed' | 'failed';
  objectiveId: string;
  label: string;
  optional: boolean;
}

const FLAG_MULTIPLIERS =
  (conductJson as { flagMultipliers?: Record<string, string> }).flagMultipliers ?? {};

function meterCondition(meter: string, expr: string, meters: Meters): boolean {
  const match = /^(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/.exec(expr.trim());
  if (!match) return false;
  const value = meter === 'file' ? meters.file : meter === 'confidence' ? meters.confidence : NaN;
  const threshold = Number(match[2]);
  switch (match[1]) {
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    default: return value < threshold;
  }
}

function failCondition(when: string, meters: Meters): boolean {
  const match = /^(file|confidence)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/.exec(when.trim());
  return !!match && meterCondition(match[1]!, match[2]! + match[3]!, meters);
}

export class MissionRunner {
  readonly flags: Record<string, MissionValue> = {};
  readonly radioQueue: string[] = [];
  readonly eventQueue: MissionEvent[] = [];
  readonly tags = new Set<string>();
  readonly states = new Map<string, ObjectiveRuntimeState>();
  status: 'running' | 'complete' | 'failed' = 'running';
  ending: string | null = null;
  elapsed = 0;

  private readonly holds = new Map<string, HoldToAct>();

  constructor(readonly def: MissionDef) {
    this.radioQueue.push(def.brief);
    for (const objective of def.objectives) {
      this.states.set(objective.id, {
        status: 'locked',
        discovered: !objective.hidden,
        completedChecks: new Set<string>(),
      });
      for (const check of objective.checks) {
        if (check.type === 'hold_at' || check.type === 'talk_to') {
          this.holds.set(this.checkKey(objective.id, check.id), new HoldToAct());
        }
      }
    }
  }

  get available(): ObjectiveDef[] {
    return this.def.objectives.filter((objective) => {
      const state = this.states.get(objective.id)!;
      return state.status === 'available' && state.discovered;
    });
  }

  /** Primary HUD objective. Other available branches still simulate. */
  get active(): ObjectiveDef | null {
    if (this.status !== 'running') return null;
    const available = this.available;
    return available.find((objective) => !objective.optional) ?? available[0] ?? null;
  }

  objectiveState(id: string): ObjectiveRuntimeState {
    const state = this.states.get(id);
    if (!state) throw new Error(`Unknown objective: ${id}`);
    return state;
  }

  discoverObjective(id: string): void {
    const objective = this.def.objectives.find((item) => item.id === id);
    if (!objective) throw new Error(`Unknown objective: ${id}`);
    const state = this.objectiveState(id);
    if (state.discovered) return;
    state.discovered = true;
    this.eventQueue.push({
      type: 'discovered', objectiveId: id, label: objective.label,
      optional: objective.optional ?? false,
    });
  }

  /** Pick the unfinished check most relevant to the player's current place. */
  focusCheck(objective: ObjectiveDef, px: number, pz: number): ObjectiveCheckDef | null {
    const state = this.objectiveState(objective.id);
    const remaining = objective.checks.filter((check) => !state.completedChecks.has(check.id));
    const holding = remaining.find((check) => this.holds.get(this.checkKey(objective.id, check.id))?.holding);
    if (holding) return holding;
    return remaining.reduce<ObjectiveCheckDef | null>((closest, check) => {
      if (!closest) return check;
      if (!check.pos) return closest;
      if (!closest.pos) return check;
      const checkDistance = Math.hypot(px - check.pos[0], pz - check.pos[1]);
      const closestDistance = Math.hypot(px - closest.pos[0], pz - closest.pos[1]);
      return checkDistance < closestDistance ? check : closest;
    }, null);
  }

  revealed(objective: ObjectiveDef, meters: Meters): boolean {
    if (!objective.revealIf) return true;
    return Object.entries(objective.revealIf)
      .every(([meter, expression]) => meterCondition(meter, expression, meters));
  }

  activeConductId(): string | null {
    for (const objective of this.def.objectives) {
      for (const check of objective.checks) {
        if (check.conduct && this.holds.get(this.checkKey(objective.id, check.id))?.holding) {
          return check.conduct;
        }
      }
    }
    return null;
  }

  multiplier(): number {
    let multiplier = 1;
    for (const [flag, name] of Object.entries(FLAG_MULTIPLIERS)) {
      if (this.flags[flag]) multiplier *= MULTIPLIERS[name] ?? 1;
    }
    return multiplier;
  }

  holdProgress(): number {
    for (const objective of this.def.objectives) {
      for (const check of objective.checks) {
        const hold = this.holds.get(this.checkKey(objective.id, check.id));
        if (hold?.holding) return hold.progress(check.seconds ?? TALK_HOLD);
      }
    }
    return 0;
  }

  step(dt: number, px: number, pz: number, actHeld: boolean, meters: Meters): void {
    if (this.status !== 'running') return;
    this.elapsed += dt;

    for (const failure of this.def.fail ?? []) {
      if (failCondition(failure.when, meters)) {
        this.status = 'failed';
        this.ending = failure.ending;
        return;
      }
    }

    this.refresh(meters);
    for (const objective of this.def.objectives) {
      const state = this.objectiveState(objective.id);
      if (state.status !== 'available') continue;

      for (const check of objective.checks) {
        if (state.completedChecks.has(check.id)) continue;
        if (!this.stepCheck(objective, check, dt, px, pz, actHeld)) continue;
        state.completedChecks.add(check.id);
        this.applyEffects(check.onComplete);
        for (const tag of check.tags ?? []) this.tags.add(tag);
        if (objective.completeWhen === 'any'
          || state.completedChecks.size === objective.checks.length) {
          this.completeObjective(objective);
          break;
        }
      }
    }
    this.refresh(meters);
    this.updateMissionCompletion(meters);
  }

  debrief(): MissionDebrief {
    const withStatus = (status: ObjectiveStatus): string[] => this.def.objectives
      .filter((objective) => this.objectiveState(objective.id).status === status)
      .map((objective) => objective.id);
    return {
      status: this.status,
      ending: this.ending,
      tags: [...this.tags],
      completed: withStatus('completed'),
      failed: withStatus('failed'),
      skipped: withStatus('skipped'),
    };
  }

  private checkKey(objectiveId: string, checkId: string): string {
    return `${objectiveId}:${checkId}`;
  }

  private evaluate(condition: MissionCondition, meters: Meters): boolean {
    if ('objective' in condition) {
      const state = this.objectiveState(condition.objective);
      return condition.status === 'discovered'
        ? state.discovered
        : state.status === condition.status;
    }
    if ('flag' in condition) {
      const value = this.flags[condition.flag];
      return condition.equals === undefined ? !!value : value === condition.equals;
    }
    if ('meter' in condition) return meterCondition(condition.meter, condition.test, meters);
    if ('all' in condition) return condition.all.every((part) => this.evaluate(part, meters));
    if ('any' in condition) return condition.any.some((part) => this.evaluate(part, meters));
    return !this.evaluate(condition.not, meters);
  }

  private refresh(meters: Meters): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const objective of this.def.objectives) {
        const state = this.objectiveState(objective.id);
        if (!state.discovered && objective.discoverWhen
          && this.evaluate(objective.discoverWhen, meters)) {
          this.discoverObjective(objective.id);
          changed = true;
        }
        if (state.status === 'locked'
          && (!objective.availableWhen || this.evaluate(objective.availableWhen, meters))) {
          state.status = 'available';
          changed = true;
        }
        if (state.status === 'available' && objective.softFailWhen
          && this.evaluate(objective.softFailWhen, meters)) {
          state.status = 'failed';
          this.applyEffects(objective.onSoftFail);
          this.eventQueue.push({
            type: 'failed', objectiveId: objective.id, label: objective.label,
            optional: objective.optional ?? false,
          });
          changed = true;
        }
      }
    }
  }

  private stepCheck(
    objective: ObjectiveDef,
    check: ObjectiveCheckDef,
    dt: number,
    px: number,
    pz: number,
    actHeld: boolean,
  ): boolean {
    const [x, z] = check.pos ?? [0, 0];
    switch (check.type) {
      case 'reach':
        return within(px, pz, x, z, check.radius ?? REACH_RADIUS);
      case 'hold_at':
        return this.holds.get(this.checkKey(objective.id, check.id))!.step(
          within(px, pz, x, z, check.radius ?? REACH_RADIUS),
          actHeld,
          check.seconds ?? TALK_HOLD,
          dt,
        );
      case 'talk_to':
        return this.holds.get(this.checkKey(objective.id, check.id))!.step(
          within(px, pz, x, z, check.radius ?? PROMPT_RADIUS),
          actHeld,
          check.seconds ?? TALK_HOLD,
          dt,
        );
      case 'deliver':
        return !!this.flags[check.flag ?? 'carrying']
          && within(px, pz, x, z, check.radius ?? REACH_RADIUS);
      case 'wait_until':
        return this.elapsed >= (check.seconds ?? 0);
      case 'flag':
        return !!this.flags[check.flag ?? check.id];
    }
  }

  private completeObjective(objective: ObjectiveDef): void {
    const state = this.objectiveState(objective.id);
    state.status = 'completed';
    this.eventQueue.push({
      type: 'completed', objectiveId: objective.id, label: objective.label,
      optional: objective.optional ?? false,
    });
    state.discovered = true;
    this.applyEffects(objective.onComplete);
    for (const tag of objective.tags ?? []) this.tags.add(tag);
    if (!objective.exclusiveGroup) return;
    for (const sibling of this.def.objectives) {
      if (sibling.id === objective.id || sibling.exclusiveGroup !== objective.exclusiveGroup) continue;
      const siblingState = this.objectiveState(sibling.id);
      if (siblingState.status === 'completed') continue;
      siblingState.status = 'skipped';
      for (const check of sibling.checks) {
        const hold = this.holds.get(this.checkKey(sibling.id, check.id));
        if (hold) hold.t = 0;
      }
    }
  }

  private applyEffects(effects?: Effect[]): void {
    for (const effect of effects ?? []) {
      if ('set' in effect) this.flags[effect.set] = effect.value;
      else if ('radio' in effect) this.radioQueue.push(effect.radio);
      else this.tags.add(effect.tag);
    }
  }

  private updateMissionCompletion(meters: Meters): void {
    const complete = this.def.completeWhen
      ? this.evaluate(this.def.completeWhen, meters)
      : this.def.objectives
        .filter((objective) => !objective.optional)
        .every((objective) => this.objectiveState(objective.id).status === 'completed');
    if (complete) this.status = 'complete';
  }
}
