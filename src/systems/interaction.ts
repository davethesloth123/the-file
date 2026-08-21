// Hold-to-act (bible §19: Act = F, held). One small mechanism used by every
// interaction in the game: proximity decides whether the prompt shows,
// holding advances progress, releasing resets it. Costs are paid over the
// whole hold — letting go early buys nothing back.
import tuning from '../data/tuning.json';

const I = tuning.interaction;

export const PROMPT_RADIUS = I.promptRadius;
export const REACH_RADIUS = I.reachRadius;
export const TALK_HOLD = I.talkHold;

export function within(
  px: number, pz: number, x: number, z: number, radius: number,
): boolean {
  return Math.hypot(px - x, pz - z) < radius;
}

export class HoldToAct {
  /** seconds accumulated toward the current hold */
  t = 0;

  /** Advance the hold. Returns true exactly once, on the tick the hold
   *  completes. Out of range or released → progress resets to zero. */
  step(near: boolean, held: boolean, seconds: number, dt: number): boolean {
    if (!near || !held) {
      this.t = 0;
      return false;
    }
    this.t += dt;
    if (this.t >= seconds) {
      this.t = 0;
      return true;
    }
    return false;
  }

  progress(seconds: number): number {
    return seconds > 0 ? Math.min(1, this.t / seconds) : 0;
  }

  get holding(): boolean {
    return this.t > 0;
  }
}

export type InteractionVerb = 'talk' | 'inspect' | 'open' | 'read' | 'use' | 'sit';
export type InteractionPosition = readonly [number, number];

export interface InteractionDefinition<Context> {
  id: string;
  verb: InteractionVerb;
  /** Static authored point or a live resolver for NPCs/moving objects. */
  position: InteractionPosition | (() => InteractionPosition);
  radius?: number;
  priority?: number;
  holdSeconds?: number | ((context: Context) => number);
  label: string | ((context: Context) => string);
  sub?: string | null | ((context: Context) => string | null);
  /** Hidden definitions do not compete for focus. Disabled definitions still
   *  explain themselves (locked, busy, unwilling) but cannot be activated. */
  visible?: (context: Context) => boolean;
  enabled?: (context: Context) => boolean;
  onTrigger: (context: Context) => void;
}

export interface InteractionView {
  id: string;
  verb: InteractionVerb;
  label: string;
  sub: string | null;
  key: string | null;
  progress: number;
  position: InteractionPosition;
  enabled: boolean;
}

function resolveValue<Context, T>(
  value: T | ((context: Context) => T),
  context: Context,
): T {
  return typeof value === 'function'
    ? (value as (context: Context) => T)(context)
    : value;
}

/** One restrained focus/hold mechanism for people, doors, readable signs,
 * mission objects and mundane fixtures. Definitions own conditions and world
 * effects; this class owns proximity, priority, prompt lifetime and input. */
export class InteractionSystem<Context> {
  private readonly definitions = new Map<string, InteractionDefinition<Context>>();
  private readonly hold = new HoldToAct();
  private focusedId: string | null = null;
  private latched = false;
  private wasHeld = false;
  private currentView: InteractionView | null = null;

  register(definition: InteractionDefinition<Context>): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Duplicate interaction id: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
  }

  unregister(id: string): void {
    this.definitions.delete(id);
    if (this.focusedId === id) this.resetFocus();
  }

  clear(): void {
    this.definitions.clear();
    this.resetFocus();
  }

  cancel(): void {
    this.resetFocus();
  }

  get view(): InteractionView | null {
    return this.currentView;
  }

  step(
    playerX: number,
    playerZ: number,
    held: boolean,
    dt: number,
    context: Context,
  ): InteractionView | null {
    const candidates = [...this.definitions.values()]
      .filter((definition) => definition.visible?.(context) ?? true)
      .map((definition) => {
        const position = resolveValue(definition.position, context);
        const radius = definition.radius ?? REACH_RADIUS;
        return {
          definition,
          position,
          distance: Math.hypot(playerX - position[0], playerZ - position[1]),
          radius,
        };
      })
      .filter((candidate) => candidate.distance < candidate.radius)
      .sort((a, b) => (
        (b.definition.priority ?? 0) - (a.definition.priority ?? 0)
        || a.distance - b.distance
        || a.definition.id.localeCompare(b.definition.id)
      ));

    const candidate = candidates[0];
    if (!candidate) {
      this.resetFocus();
      this.wasHeld = held;
      return null;
    }

    const { definition, position } = candidate;
    if (this.focusedId !== definition.id) {
      this.hold.t = 0;
      this.latched = false;
      this.focusedId = definition.id;
    }
    if (!held) this.latched = false;

    const enabled = definition.enabled?.(context) ?? true;
    const seconds = Math.max(0, resolveValue(definition.holdSeconds ?? 0, context));
    let triggered = false;
    if (!enabled) {
      this.hold.t = 0;
    } else if (seconds === 0) {
      triggered = held && !this.wasHeld && !this.latched;
    } else if (!this.latched) {
      triggered = this.hold.step(true, held, seconds, dt);
    }
    if (triggered) {
      this.latched = true;
      definition.onTrigger(context);
    }

    this.currentView = {
      id: definition.id,
      verb: definition.verb,
      label: resolveValue(definition.label, context),
      sub: definition.sub === undefined ? null : resolveValue(definition.sub, context),
      key: enabled ? 'E' : null,
      progress: enabled && seconds > 0 ? this.hold.progress(seconds) : 0,
      position,
      enabled,
    };
    this.wasHeld = held;
    return this.currentView;
  }

  private resetFocus(): void {
    this.focusedId = null;
    this.currentView = null;
    this.hold.t = 0;
    this.latched = false;
  }
}
