// Civilian social awareness is deliberately softer than patrol detection.
// Ordinary proximity can earn a brief glance or a courteous step aside;
// only contextually unusual conduct escalates into watching and reporting.
import tuning from '../data/tuning.json';
import { NpcAttention, type AttentionState } from './attention';

const C = tuning.civilianAwareness;

export type CivilianReactionState = AttentionState | 'glancing';

export interface CivilianAwarenessInput {
  seesPlayer: boolean;
  unusualConduct: boolean;
  distance: number;
  playerX: number;
  playerZ: number;
  playerMoving: boolean;
  npcMoving: boolean;
}

export interface CivilianReaction {
  state: CivilianReactionState;
  lookWeight: number;
  turnBody: boolean;
  stepAside: boolean;
  report: boolean;
}

export class CivilianAwareness {
  readonly attention = new NpcAttention();
  private glanceRemaining = 0;
  private glanceCooldown: number;
  private yieldCooldown = 0;
  private previousAttention: AttentionState = 'routine';

  constructor(seed = 0.5) {
    this.glanceCooldown = Math.max(0, seed) * C.initialGlanceSpread;
  }

  step(dt: number, input: CivilianAwarenessInput): CivilianReaction {
    const attentionState = this.attention.step(dt, input);
    const report = attentionState === 'reporting' && this.previousAttention !== 'reporting';
    this.previousAttention = attentionState;
    this.glanceCooldown = Math.max(0, this.glanceCooldown - dt);
    this.yieldCooldown = Math.max(0, this.yieldCooldown - dt);

    const nearby = input.distance < C.glanceDistance
      && (input.seesPlayer || input.distance < C.closeAwarenessDistance);
    if (!input.unusualConduct && nearby && this.glanceRemaining <= 0 && this.glanceCooldown <= 0) {
      this.glanceRemaining = C.glanceSeconds;
      this.glanceCooldown = C.glanceCooldown;
    }
    this.glanceRemaining = Math.max(0, this.glanceRemaining - dt);

    const stepAside = input.playerMoving && input.npcMoving
      && input.distance < C.stepAsideDistance && this.yieldCooldown <= 0;
    if (stepAside) this.yieldCooldown = C.stepAsideCooldown;

    const attentive = attentionState !== 'routine' || this.attention.concern > 0;
    const glancing = !attentive && this.glanceRemaining > 0;
    return {
      state: glancing ? 'glancing' : attentionState,
      lookWeight: attentive
        ? Math.max(C.watchLookWeight, this.attention.concern)
        : glancing ? C.glanceLookWeight : 0,
      turnBody: ['watching', 'approaching', 'questioning', 'reporting'].includes(attentionState),
      stepAside,
      report,
    };
  }
}
