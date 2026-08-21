// Auto-trailing third-person camera, GTA IV lineage (bible §10). Recentre
// behind the player only while forward input is held; manual look suspends
// recentring, then eases back; pull-in against wall boxes; three presets on
// V, FOV opens when jogging. No pointer lock anywhere. All values from
// tuning.json.
import * as THREE from 'three';
import tuning from '../data/tuning.json';
import type { CollisionWorld } from '../world/collision';

const C = tuning.camera;
const P = tuning.player;

export interface CameraTargetState {
  x: number; y: number; z: number;
  yaw: number;
  forwardHeld: boolean;
  speed: number;
  vx: number;
  vz: number;
  onStairs: boolean;
}

export class TrailingCamera {
  yaw = Math.PI;
  private pitch = C.views[0]!.pitch;
  private view = 0;
  private manualTimer = 0;
  private dragging = false;
  private fov = C.views[0]!.fov;
  private readonly smoothedFocus = new THREE.Vector3();
  private focusReady = false;
  private currentDist = C.views[0]!.dist;
  private stairBlend = 0;
  private avoidanceYaw = 0;
  private avoidancePitch = 0;
  private stairMotionYaw = 0;
  private lastClear = 1;
  private lastDesiredDist = C.views[0]!.dist;
  private lastPreferredYaw = 0;
  private lastPreferredClearance = 1;

  debugState(): { clear: number; distance: number; desired: number; yaw: number; pitch: number; preferredYaw: number; preferredClearance: number } {
    return {
      clear: this.lastClear,
      distance: this.currentDist,
      desired: this.lastDesiredDist,
      yaw: this.avoidanceYaw,
      pitch: this.avoidancePitch,
      preferredYaw: this.lastPreferredYaw,
      preferredClearance: this.lastPreferredClearance,
    };
  }

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    dom: HTMLElement,
  ) {
    dom.addEventListener('mousedown', () => (this.dragging = true));
    addEventListener('mouseup', () => (this.dragging = false));
    addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * C.lookSensitivityX;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch + e.movementY * C.lookSensitivityY,
        C.pitchMin,
        C.pitchMax,
      );
      this.manualTimer = C.manualHold;
    });
    addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'v') this.cycleView();
    });
  }

  private cycleView(): void {
    this.view = (this.view + 1) % C.views.length;
    this.pitch = C.views[this.view]!.pitch;
  }

  update(dt: number, t: CameraTargetState, world: CollisionWorld): void {
    const v = C.views[this.view]!;
    const hurryBlend = THREE.MathUtils.clamp((t.speed - P.walk) / (P.jog - P.walk), 0, 1);
    this.stairBlend += ((t.onStairs ? 1 : 0) - this.stairBlend)
      * (1 - Math.exp(-C.stairBlendRate * dt));

    if (this.manualTimer > 0) this.manualTimer -= dt;
    else {
      // recentre behind the player, but only while walking forward
      if (t.forwardHeld) {
        const want = t.yaw + Math.PI;
        const diff = ((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const step = C.recentreRate
          * THREE.MathUtils.lerp(1, C.recentreJogScale, hurryBlend) * dt;
        this.yaw += THREE.MathUtils.clamp(diff, -step, step);
      }
      this.pitch += (v.pitch - this.pitch) * (1 - Math.exp(-C.pitchReturnRate * dt));
    }

    let leadX = t.vx * C.motionLeadSeconds;
    let leadZ = t.vz * C.motionLeadSeconds;
    const leadLength = Math.hypot(leadX, leadZ);
    if (leadLength > C.motionLeadMax) {
      leadX = (leadX / leadLength) * C.motionLeadMax;
      leadZ = (leadZ / leadLength) * C.motionLeadMax;
    }
    const targetFocus = new THREE.Vector3(
      t.x + leadX,
      t.y + v.focus + C.stairFocusLift * this.stairBlend,
      t.z + leadZ,
    );
    if (!this.focusReady) {
      this.smoothedFocus.copy(targetFocus);
      this.focusReady = true;
    } else {
      const horizontal = 1 - Math.exp(-C.focusFollowRate * dt);
      const verticalRate = t.onStairs
        ? targetFocus.y >= this.smoothedFocus.y
          ? C.focusVerticalStairRiseRate
          : C.focusVerticalStairFallRate
        : C.focusVerticalRate;
      const vertical = 1 - Math.exp(-verticalRate * dt);
      this.smoothedFocus.x += (targetFocus.x - this.smoothedFocus.x) * horizontal;
      this.smoothedFocus.z += (targetFocus.z - this.smoothedFocus.z) * horizontal;
      this.smoothedFocus.y += (targetFocus.y - this.smoothedFocus.y) * vertical;
    }
    const focus = this.smoothedFocus.clone();
    const baseBack = new THREE.Vector3(
      Math.sin(this.yaw), 0, Math.cos(this.yaw),
    );
    const side = new THREE.Vector3(baseBack.z, 0, -baseBack.x);
    const shoulderScale = THREE.MathUtils.lerp(
      1, C.stairShoulderScale, this.stairBlend,
    ) * THREE.MathUtils.clamp(this.currentDist / v.dist, 0, 1);
    focus.addScaledVector(side, v.shoulder * shoulderScale);

    const desiredDist = THREE.MathUtils.lerp(
      v.dist, v.dist * C.stairDistanceScale, this.stairBlend,
    );
    const cameraRadius = THREE.MathUtils.lerp(
      C.collisionRadius, C.stairCollisionRadius, this.stairBlend,
    );
    const cameraPitch = this.pitch + C.stairPitchLift * this.stairBlend;
    const desiredAt = (yawOffset: number, pitchOffset = 0): THREE.Vector3 => {
      const back = new THREE.Vector3(
        Math.sin(this.yaw + yawOffset), 0, Math.cos(this.yaw + yawOffset),
      );
      const pitched = Math.min(C.obstructionPitchMax, cameraPitch + pitchOffset);
      const point = focus.clone().addScaledVector(back, desiredDist * Math.cos(pitched));
      point.y += desiredDist * Math.sin(pitched);
      return point;
    };
    const clearanceAt = (yawOffset: number, pitchOffset = 0): number => {
      const point = desiredAt(yawOffset, pitchOffset);
      const cameraClearance = world.rayClear(
        focus.x, focus.y, focus.z,
        point.x, point.y, point.z,
        cameraRadius,
      );
      // A head-only ray can report a technically clear camera while a stair
      // tread or landing hides the entire body. Include a lightly padded ray
      // from the player's chest so obstruction choices preserve a usable
      // third-person composition.
      const bodyClearance = world.rayClear(
        t.x, t.y + C.bodyVisibilityHeight, t.z,
        point.x, point.y, point.z,
        C.bodyVisibilityPadding,
      );
      return Math.min(cameraClearance, bodyClearance);
    };

    const motionLength = Math.hypot(t.vx, t.vz);
    if (t.onStairs && motionLength > P.movingThreshold) {
      const motionBackYaw = Math.atan2(-t.vx, -t.vz);
      this.stairMotionYaw = ((motionBackYaw - this.yaw + Math.PI * 3)
        % (Math.PI * 2)) - Math.PI;
    }
    const useStairMotion = this.stairBlend > C.stairMotionBlendThreshold;
    const preferredYaw = useStairMotion ? this.stairMotionYaw : 0;
    const preferredPitch = useStairMotion
      ? THREE.MathUtils.degToRad(C.stairMotionPitchDeg) * this.stairBlend
      : 0;
    const preferredClearance = clearanceAt(preferredYaw, preferredPitch);
    this.lastPreferredYaw = preferredYaw;
    this.lastPreferredClearance = preferredClearance;
    let avoidanceTarget = preferredYaw;
    let pitchTarget = preferredPitch;
    if (preferredClearance < C.obstructionTrigger) {
      let bestClearance = preferredClearance;
      // Turning or shortening is less disorienting than lifting a confined
      // camera above the player, where ceilings and upper flights become the
      // next obstruction. Keep the authored pitch and search laterally.
      for (const degrees of C.obstructionYawOffsetsDeg) {
        for (const sign of [-1, 1]) {
          const offset = THREE.MathUtils.degToRad(degrees * sign);
          const candidateYaw = preferredYaw + offset;
          const candidatePitch = preferredPitch;
          const clearance = clearanceAt(candidateYaw, candidatePitch)
            - Math.abs(offset) / Math.PI * C.obstructionAnglePenalty;
          if (clearance > bestClearance + C.obstructionChoiceEpsilon) {
            bestClearance = clearance;
            avoidanceTarget = candidateYaw;
            pitchTarget = candidatePitch;
          }
        }
      }
      if (bestClearance < preferredClearance + C.obstructionMinGain) {
        avoidanceTarget = preferredYaw;
        pitchTarget = preferredPitch;
      }
    }
    const avoidanceDiff = ((avoidanceTarget - this.avoidanceYaw + Math.PI * 3)
      % (Math.PI * 2)) - Math.PI;
    this.avoidanceYaw += avoidanceDiff
      * (1 - Math.exp(-C.obstructionTurnRate * dt));
    this.avoidancePitch += (pitchTarget - this.avoidancePitch)
      * (1 - Math.exp(-C.obstructionPitchRate * dt));

    const desired = desiredAt(this.avoidanceYaw, this.avoidancePitch);

    const clear = world.rayClear(
      focus.x, focus.y, focus.z,
      desired.x, desired.y, desired.z,
      cameraRadius,
    );
    this.lastClear = clear;
    this.lastDesiredDist = desiredDist;
    // prefer at least minDist, but never sit inside a wall: when geometry
    // forces the camera closer than minDist, closer wins over clipping
    const unobstructed = desiredDist * clear * C.collisionSafety;
    const safeDist = clear >= 1
      ? desiredDist
      : Math.max(Math.min(C.minDist, unobstructed), Math.min(unobstructed, desiredDist));
    if (safeDist < this.currentDist) this.currentDist = safeDist;
    else this.currentDist += (safeDist - this.currentDist)
      * (1 - Math.exp(-C.distanceReturnRate * dt));
    const pos = focus.clone().lerp(desired, this.currentDist / desiredDist);

    this.camera.position.copy(pos);
    const lookFocus = focus.clone();
    lookFocus.y -= C.stairLookDown * this.stairBlend;
    this.camera.lookAt(lookFocus);

    const wantFov = v.fov + hurryBlend * C.jogFovBoost;
    this.fov += (wantFov - this.fov) * (1 - Math.exp(-C.fovResponseRate * dt));
    if (Math.abs(this.camera.fov - this.fov) > Number.EPSILON) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
