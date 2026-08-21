import type { InteractionVerb } from './interaction';
import {
  applyDialogueEffects,
  dialogueCondition,
  type DialogueCondition,
  type DialogueEffect,
  type DialogueEnvironment,
} from './dialogue';

export interface WorldInteractionDefinition {
  id: string;
  verb: InteractionVerb;
  pos: [number, number];
  label: string;
  disabledLabel?: string;
  speaker: string;
  text: string;
  radius?: number;
  holdSeconds?: number;
  once?: boolean;
  visibleWhen?: DialogueCondition;
  enabledWhen?: DialogueCondition;
  effects?: DialogueEffect[];
}

export interface WorldInteractionResult {
  speaker: string;
  text: string;
}

/** Small data-driven runtime shared by readable props, doors and fixtures.
 * The proximity/prompt mechanics remain in InteractionSystem; this owns
 * conditions, one-shot memory, and authored world-state effects. */
export class WorldInteractionRuntime {
  readonly used = new Set<string>();

  visible(definition: WorldInteractionDefinition, env: DialogueEnvironment): boolean {
    if (definition.once && this.used.has(definition.id)) return false;
    return !definition.visibleWhen || dialogueCondition(definition.visibleWhen, env);
  }

  enabled(definition: WorldInteractionDefinition, env: DialogueEnvironment): boolean {
    return !definition.enabledWhen || dialogueCondition(definition.enabledWhen, env);
  }

  activate(
    definition: WorldInteractionDefinition,
    env: DialogueEnvironment,
  ): WorldInteractionResult | null {
    if (!this.visible(definition, env) || !this.enabled(definition, env)) return null;
    applyDialogueEffects(definition.effects, env);
    this.used.add(definition.id);
    return { speaker: definition.speaker, text: definition.text };
  }
}
