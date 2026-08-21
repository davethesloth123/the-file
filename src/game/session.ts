// Render-independent state boundary for one run. The composition root calls
// these phases in order inside FixedClock; tests can exercise the same path
// without creating a renderer or loading assets.
import { PlayerState, type PlayerInput } from '../actors/player';
import type { Patrol } from '../actors/patrol';
import { ConfidenceMeter } from '../systems/confidence';
import { evaluateConduct, type ActiveConduct } from '../systems/conduct';
import { Wallet } from '../systems/economy';
import { FileMeter } from '../systems/file';
import { MissionRunner, type MissionDef } from '../systems/mission';
import { SocialState } from '../systems/social';
import type { CollisionWorld } from '../world/collision';

export interface RestrictedZone {
  pos: [number, number];
  r: number;
  label: string;
}

export interface SurveillanceResult {
  observers: number;
  observed: boolean;
  calm: boolean;
  conduct: ActiveConduct | null;
}

export class GameSession {
  readonly player: PlayerState;
  readonly mission: MissionRunner;
  readonly file = new FileMeter();
  readonly confidence = new ConfidenceMeter();
  readonly wallet = new Wallet();
  readonly social = new SocialState();
  movementLocked = false;

  lastConduct: ActiveConduct | null = null;
  lastObservers = 0;
  private stillSeconds = 0;

  constructor(
    readonly world: CollisionWorld,
    spawn: [number, number],
    mission: MissionDef,
  ) {
    this.player = new PlayerState(spawn);
    this.mission = new MissionRunner(mission);
  }

  stepPlayer(dt: number, input: PlayerInput, cameraYaw: number): void {
    const locked = this.movementLocked || this.mission.activeConductId() !== null;
    this.player.step(dt, input, cameraYaw, this.world, locked);
  }

  facePlayerToward(x: number, z: number, dt: number): void {
    this.player.faceToward(x, z, dt);
  }

  stepMission(dt: number, actHeld: boolean): void {
    this.mission.step(dt, this.player.x, this.player.z, actHeld, {
      file: this.file.value,
      confidence: this.confidence.value,
    });
  }

  stepSurveillance(
    dt: number,
    patrols: readonly Patrol[],
    restrictedZones: readonly RestrictedZone[],
  ): SurveillanceResult {
    this.stillSeconds = this.player.moving ? 0 : this.stillSeconds + dt;
    let restrictedLabel: string | null = null;
    for (const zone of restrictedZones) {
      if (Math.hypot(this.player.x - zone.pos[0], this.player.z - zone.pos[1]) < zone.r) {
        restrictedLabel = zone.label;
        break;
      }
    }

    const conduct = this.mission.status === 'running' ? evaluateConduct({
      servicing: this.mission.activeConductId() === 'service',
      talkingToFlagged: false,
      afterCurfew: false,
      restrictedLabel,
      hurrying: this.player.hurrying,
      moving: this.player.moving,
      stillSeconds: this.stillSeconds,
      atBench: false,
      offDistrict: false,
    }) : null;

    let observers = 0;
    for (const patrol of patrols) {
      if (patrol.step(dt, this.player.x, this.player.z, conduct !== null, this.world)) observers++;
    }
    this.file.accrue(conduct, observers, this.mission.multiplier(), dt);
    this.confidence.tick(conduct !== null && observers > 0, dt);
    this.lastConduct = conduct;
    this.lastObservers = observers;

    return {
      observers,
      observed: observers > 0,
      calm: this.player.moving && !this.player.hurrying && conduct === null,
      conduct,
    };
  }
}
