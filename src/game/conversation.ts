import * as THREE from 'three';
import type { Actor } from '../actors/actor';
import type { RoutineAgent } from '../actors/routine';
import tuning from '../data/tuning.json';
import {
  DialogueRuntime,
  type DialogueDefinition,
  type DialogueEnvironment,
  type DialogueView,
} from '../systems/dialogue';
import type { GameSession } from './session';

export interface ConversationParticipant {
  id: string;
  actor: Actor;
  routine: RoutineAgent | null;
  x: number;
  z: number;
  yaw: number;
}

type ViewListener = (view: DialogueView | null) => void;

function approachAngle(current: number, target: number, maxChange: number): number {
  const turn = ((target - current + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  return current + THREE.MathUtils.clamp(turn, -maxChange, maxChange);
}

/** Owns the physical side of a conversation: movement/routine pause, mutual
 * orientation, bounded head presentation, runtime choices, and clean return
 * to the prior routine when the exchange ends. */
export class ConversationController {
  readonly runtime = new DialogueRuntime();
  private participant: ConversationParticipant | null = null;
  private session: GameSession | null = null;
  private playerActor: Actor | null = null;

  constructor(private readonly onView: ViewListener) {}

  get active(): boolean {
    return this.runtime.active;
  }

  get npcId(): string | null {
    return this.participant?.id ?? null;
  }

  start(
    definition: DialogueDefinition,
    environment: DialogueEnvironment,
    participant: ConversationParticipant,
    session: GameSession,
    playerActor: Actor,
  ): boolean {
    this.end();
    if (!this.runtime.start(definition, environment)) return false;
    this.participant = participant;
    this.session = session;
    this.playerActor = playerActor;
    session.movementLocked = true;
    participant.routine?.pause('conversation');
    participant.actor.setLookOffset(0, 0, 0.35);
    playerActor.setLookOffset(0, 0, 0.35);
    this.onView(this.runtime.view);
    return true;
  }

  choose(responseId: string): void {
    const view = this.runtime.choose(responseId);
    if (!view) {
      this.end();
      return;
    }
    this.onView(view);
  }

  step(dt: number): void {
    if (!this.participant || !this.session || !this.runtime.active) return;
    const player = this.session.player;
    this.session.facePlayerToward(this.participant.x, this.participant.z, dt);
    const wantNpc = Math.atan2(player.x - this.participant.x, player.z - this.participant.z);
    this.participant.yaw = approachAngle(
      this.participant.yaw,
      wantNpc,
      tuning.npcRoutine.turnRate * dt,
    );
    if (this.participant.routine) this.participant.routine.yaw = this.participant.yaw;
    // Static NPCs are not otherwise pose-interpolated by the routine renderer.
    this.participant.actor.group.rotation.y = this.participant.yaw;
  }

  end(): void {
    if (this.participant) {
      this.participant.routine?.resume('conversation');
      this.participant.actor.clearLookOffset();
    }
    if (this.session) this.session.movementLocked = false;
    this.playerActor?.clearLookOffset();
    this.runtime.close();
    this.participant = null;
    this.session = null;
    this.playerActor = null;
    this.onView(null);
  }
}
