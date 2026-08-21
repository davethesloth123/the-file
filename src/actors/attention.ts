// Temporary, local NPC attention. This is deliberately separate from The
// File: an NPC can stop watching and return to their routine, while anything
// already written into the state's permanent record never decays.
import tuning from '../data/tuning.json';

const A = tuning.npcAttention;

export type AttentionState =
  | 'routine'
  | 'noticing'
  | 'watching'
  | 'approaching'
  | 'questioning'
  | 'reporting'
  | 'returning';

export interface AttentionInput {
  seesPlayer: boolean;
  unusualConduct: boolean;
  distance: number;
  playerX: number;
  playerZ: number;
}

export class NpcAttention {
  state: AttentionState = 'routine';
  concern = 0;
  focusX = 0;
  focusZ = 0;
  private questioningFor = 0;
  private reportRemaining = 0;

  step(dt: number, input: AttentionInput): AttentionState {
    if (input.seesPlayer) {
      this.focusX = input.playerX;
      this.focusZ = input.playerZ;
    }

    const hasEvidence = input.seesPlayer && input.unusualConduct;
    this.concern = hasEvidence
      ? Math.min(1, this.concern + A.riseRate * dt)
      : Math.max(0, this.concern - A.settleRate * dt);

    if (this.state === 'reporting' && this.reportRemaining > 0) {
      this.reportRemaining -= dt;
      return this.state;
    }

    if (!hasEvidence) {
      this.questioningFor = 0;
      this.state = this.concern > 0 ? 'returning' : 'routine';
      return this.state;
    }

    if (this.concern < A.noticeAt) {
      this.state = 'routine';
    } else if (this.concern < A.watchAt) {
      this.state = 'noticing';
    } else if (this.concern < A.approachAt) {
      this.state = 'watching';
    } else if (input.distance > A.questionDistance) {
      this.questioningFor = 0;
      this.state = 'approaching';
    } else {
      this.questioningFor += dt;
      if (this.concern >= A.reportAt || this.questioningFor >= A.questionSeconds) {
        this.state = 'reporting';
        this.reportRemaining = A.reportHoldSeconds;
      } else {
        this.state = 'questioning';
      }
    }
    return this.state;
  }
}
