// Mission runner (bible §16). Objectives come from JSON and advance in
// order. The `type` set is CLOSED: reach, hold_at, talk_to, deliver,
// wait_until. Adding a sixth is an engineering task; adding a mission is
// not — if a mission needs code, the schema is wrong.
//
// revealIf gates what the player is TOLD (markers, distance readouts),
// never what is true: an unrevealed exit still works if you can find it.
// Intel is withheld, not wrong.
import conductJson from '../data/conduct.json';
import { MULTIPLIERS } from './conduct';
import { HoldToAct, within, REACH_RADIUS, PROMPT_RADIUS, TALK_HOLD } from './interaction';

export type ObjectiveType = 'reach' | 'hold_at' | 'talk_to' | 'deliver' | 'wait_until';

export type Effect =
  | { set: string; value: boolean | number | string }
  | { radio: string };

export interface ObjectiveDef {
  id: string;
  type: ObjectiveType;
  label: string;
  pos?: [number, number];
  seconds?: number;
  radius?: number;
  /** conduct rule id active while holding (e.g. "service") */
  conduct?: string;
  /** deliver: the flag that must be set (default "carrying") */
  flag?: string;
  prompt?: string;
  revealIf?: Record<string, string>;
  onComplete?: Effect[];
}

export interface MissionDef {
  id: string;
  act: number;
  date: string;
  brief: string;
  objectives: ObjectiveDef[];
  fail?: { when: string; ending: string }[];
}

export interface Meters {
  file: number;
  confidence: number;
}

const FLAG_MULTIPLIERS =
  (conductJson as { flagMultipliers?: Record<string, string> }).flagMultipliers ?? {};

/** Parse "file>=100" / ">=33" style conditions against the meters. */
function meterCondition(meter: string, expr: string, meters: Meters): boolean {
  const m = /^(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/.exec(expr.trim());
  if (!m) return false;
  const value = meter === 'file' ? meters.file : meter === 'confidence' ? meters.confidence : NaN;
  const threshold = Number(m[2]);
  switch (m[1]) {
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '>': return value > threshold;
    default: return value < threshold;
  }
}

function failCondition(when: string, meters: Meters): boolean {
  const m = /^(\w+)\s*(>=|<=|>|<)\s*(\d+(?:\.\d+)?)$/.exec(when.trim());
  if (!m) return false;
  return meterCondition(m[1]!, m[2]! + m[3]!, meters);
}

export class MissionRunner {
  flags: Record<string, boolean | number | string> = {};
  status: 'running' | 'complete' | 'failed' = 'running';
  ending: string | null = null;
  /** string keys for the radio, drained by the UI each frame */
  radioQueue: string[] = [];
  elapsed = 0;
  index = 0;
  readonly hold = new HoldToAct();

  constructor(readonly def: MissionDef) {
    this.radioQueue.push(def.brief);
  }

  get active(): ObjectiveDef | null {
    return this.status === 'running' ? this.def.objectives[this.index] ?? null : null;
  }

  /** Is the player TOLD about this objective right now? Truth is unaffected. */
  revealed(objective: ObjectiveDef, meters: Meters): boolean {
    if (!objective.revealIf) return true;
    for (const [meter, expr] of Object.entries(objective.revealIf)) {
      if (!meterCondition(meter, expr, meters)) return false;
    }
    return true;
  }

  /** Conduct rule id active this instant (holding on a drop), else null. */
  activeConductId(): string | null {
    const o = this.active;
    return o?.conduct && this.hold.holding ? o.conduct : null;
  }

  /** File-accrual multiplier from mission flags (carrying → operational…). */
  multiplier(): number {
    let m = 1;
    for (const [flag, name] of Object.entries(FLAG_MULTIPLIERS)) {
      if (this.flags[flag]) m *= MULTIPLIERS[name] ?? 1;
    }
    return m;
  }

  /** Progress of the active hold, 0..1. */
  holdProgress(): number {
    const o = this.active;
    return o?.seconds ? this.hold.progress(o.seconds) : this.hold.progress(TALK_HOLD);
  }

  step(dt: number, px: number, pz: number, actHeld: boolean, meters: Meters): void {
    if (this.status !== 'running') return;
    this.elapsed += dt;

    for (const f of this.def.fail ?? []) {
      if (failCondition(f.when, meters)) {
        this.status = 'failed';
        this.ending = f.ending;
        return;
      }
    }

    const o = this.active;
    if (!o) return;
    const [ox, oz] = o.pos ?? [0, 0];
    let done = false;

    switch (o.type) {
      case 'reach':
        done = within(px, pz, ox, oz, o.radius ?? REACH_RADIUS);
        break;
      case 'hold_at':
        done = this.hold.step(
          within(px, pz, ox, oz, o.radius ?? REACH_RADIUS),
          actHeld, o.seconds ?? TALK_HOLD, dt,
        );
        break;
      case 'talk_to':
        done = this.hold.step(
          within(px, pz, ox, oz, o.radius ?? PROMPT_RADIUS),
          actHeld, o.seconds ?? TALK_HOLD, dt,
        );
        break;
      case 'deliver':
        done = !!this.flags[o.flag ?? 'carrying']
          && within(px, pz, ox, oz, o.radius ?? REACH_RADIUS);
        break;
      case 'wait_until':
        done = this.elapsed >= (o.seconds ?? 0);
        break;
    }

    if (done) {
      for (const effect of o.onComplete ?? []) {
        if ('set' in effect) this.flags[effect.set] = effect.value;
        else this.radioQueue.push(effect.radio);
      }
      this.index++;
      this.hold.t = 0;
      if (this.index >= this.def.objectives.length) this.status = 'complete';
    }
  }
}
