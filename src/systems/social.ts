/** Run-scoped social memory. Local suspicion can settle in the world while
 * remembered facts, choices and unlocked routes persist for the whole run. */
export class SocialState {
  readonly facts = new Set<string>();
  readonly routes = new Set<string>();
  readonly choices = new Set<string>();
  private readonly suspicionByNpc = new Map<string, number>();

  suspicion(npcId: string): number {
    return this.suspicionByNpc.get(npcId) ?? 0;
  }

  adjustSuspicion(npcId: string, amount: number): number {
    const next = Math.max(0, Math.min(100, this.suspicion(npcId) + amount));
    this.suspicionByNpc.set(npcId, next);
    return next;
  }

  rememberChoice(dialogueId: string, responseId: string): void {
    this.choices.add(`${dialogueId}:${responseId}`);
  }

  chose(dialogueId: string, responseId: string): boolean {
    return this.choices.has(`${dialogueId}:${responseId}`);
  }
}
