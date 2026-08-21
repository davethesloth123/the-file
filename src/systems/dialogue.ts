import type { MissionValue, ObjectiveConditionState } from './mission';

export type DialogueCondition =
  | { flag: string; equals?: MissionValue }
  | { suspicion: string }
  | { choice: { dialogue: string; response: string; chosen?: boolean } }
  | { route: string; unlocked?: boolean }
  | { fact: string; known?: boolean }
  | { objective: string; status: ObjectiveConditionState }
  | { context: 'role' | 'location' | 'activity'; equals: string }
  | { all: DialogueCondition[] }
  | { any: DialogueCondition[] }
  | { not: DialogueCondition };

export type DialogueEffect =
  | { setFlag: string; value: MissionValue }
  | { suspicion: number }
  | { unlockRoute: string }
  | { addFact: string }
  | { discoverObjective: string }
  | { action: string }
  | { tag: string };

export interface DialogueResponseDef {
  id: string;
  text: string;
  next: string | null;
  when?: DialogueCondition;
  effects?: DialogueEffect[];
}

export interface DialogueNodeDef {
  speaker: string;
  text: string;
  responses: DialogueResponseDef[];
  effects?: DialogueEffect[];
}

export interface DialogueDefinition {
  id: string;
  npcId: string;
  prompt: string;
  role: string;
  location: string;
  activity: string;
  start: string;
  refusalNode?: string;
  availableWhen?: DialogueCondition;
  nodes: Record<string, DialogueNodeDef>;
}

export interface DialogueEnvironment {
  npcId: string;
  role: string;
  location: string;
  activity: string;
  flag(name: string): MissionValue | undefined;
  setFlag(name: string, value: MissionValue): void;
  suspicion(): number;
  adjustSuspicion(amount: number): void;
  chose(dialogueId: string, responseId: string): boolean;
  rememberChoice(dialogueId: string, responseId: string): void;
  routeUnlocked(id: string): boolean;
  unlockRoute(id: string): void;
  knows(id: string): boolean;
  addFact(id: string): void;
  objectiveStatus(id: string): ObjectiveConditionState;
  discoverObjective(id: string): void;
  addTag(id: string): void;
  action(id: string): void;
}

export interface DialogueResponseView {
  id: string;
  text: string;
}

export interface DialogueView {
  dialogueId: string;
  npcId: string;
  speaker: string;
  text: string;
  responses: DialogueResponseView[];
}

function numberTest(value: number, expression: string): boolean {
  const match = /^(>=|<=|>|<|=)\s*(\d+(?:\.\d+)?)$/.exec(expression.trim());
  if (!match) return false;
  const target = Number(match[2]);
  switch (match[1]) {
    case '>=': return value >= target;
    case '<=': return value <= target;
    case '>': return value > target;
    case '<': return value < target;
    default: return value === target;
  }
}

export function dialogueCondition(
  condition: DialogueCondition,
  env: DialogueEnvironment,
): boolean {
  if ('flag' in condition) {
    const value = env.flag(condition.flag);
    return condition.equals === undefined ? !!value : value === condition.equals;
  }
  if ('suspicion' in condition) return numberTest(env.suspicion(), condition.suspicion);
  if ('choice' in condition) {
    const chosen = env.chose(condition.choice.dialogue, condition.choice.response);
    return chosen === (condition.choice.chosen ?? true);
  }
  if ('route' in condition) {
    return env.routeUnlocked(condition.route) === (condition.unlocked ?? true);
  }
  if ('fact' in condition) return env.knows(condition.fact) === (condition.known ?? true);
  if ('objective' in condition) return env.objectiveStatus(condition.objective) === condition.status;
  if ('context' in condition) return env[condition.context] === condition.equals;
  if ('all' in condition) return condition.all.every((part) => dialogueCondition(part, env));
  if ('any' in condition) return condition.any.some((part) => dialogueCondition(part, env));
  return !dialogueCondition(condition.not, env);
}

export function applyDialogueEffects(
  effects: readonly DialogueEffect[] | undefined,
  environment: DialogueEnvironment,
): void {
  for (const effect of effects ?? []) {
    if ('setFlag' in effect) environment.setFlag(effect.setFlag, effect.value);
    else if ('suspicion' in effect) environment.adjustSuspicion(effect.suspicion);
    else if ('unlockRoute' in effect) environment.unlockRoute(effect.unlockRoute);
    else if ('addFact' in effect) environment.addFact(effect.addFact);
    else if ('discoverObjective' in effect) environment.discoverObjective(effect.discoverObjective);
    else if ('action' in effect) environment.action(effect.action);
    else environment.addTag(effect.tag);
  }
}

/** Render-independent branching dialogue runtime. It remembers response
 * choices through the supplied environment and applies only declarative
 * effects, keeping authored dialogue content out of gameplay code. */
export class DialogueRuntime {
  private definition: DialogueDefinition | null = null;
  private environment: DialogueEnvironment | null = null;
  private nodeId: string | null = null;

  get active(): boolean {
    return this.definition !== null && this.nodeId !== null;
  }

  start(definition: DialogueDefinition, environment: DialogueEnvironment): boolean {
    this.close();
    const willing = !definition.availableWhen
      || dialogueCondition(definition.availableWhen, environment);
    const start = willing ? definition.start : definition.refusalNode;
    if (!start) return false;
    this.definition = definition;
    this.environment = environment;
    this.enter(start);
    return true;
  }

  get view(): DialogueView | null {
    if (!this.definition || !this.environment || !this.nodeId) return null;
    const node = this.definition.nodes[this.nodeId];
    if (!node) return null;
    return {
      dialogueId: this.definition.id,
      npcId: this.definition.npcId,
      speaker: node.speaker,
      text: node.text,
      responses: node.responses
        .filter((response) => !response.when || dialogueCondition(response.when, this.environment!))
        .map(({ id, text }) => ({ id, text })),
    };
  }

  choose(responseId: string): DialogueView | null {
    if (!this.definition || !this.environment || !this.nodeId) return null;
    const response = this.definition.nodes[this.nodeId]?.responses.find((item) => (
      item.id === responseId
      && (!item.when || dialogueCondition(item.when, this.environment!))
    ));
    if (!response) return this.view;
    this.apply(response.effects);
    this.environment.rememberChoice(this.definition.id, response.id);
    if (response.next === null) {
      this.close();
      return null;
    }
    this.enter(response.next);
    return this.view;
  }

  close(): void {
    this.definition = null;
    this.environment = null;
    this.nodeId = null;
  }

  private enter(nodeId: string): void {
    if (!this.definition?.nodes[nodeId]) {
      throw new Error(`Dialogue ${this.definition?.id ?? '<unknown>'} has no node ${nodeId}`);
    }
    this.nodeId = nodeId;
    this.apply(this.definition.nodes[nodeId]!.effects);
  }

  private apply(effects?: DialogueEffect[]): void {
    if (!this.environment) return;
    applyDialogueEffects(effects, this.environment);
  }
}
