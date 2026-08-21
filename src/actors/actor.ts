// Archetype loading and per-instance actors. Each archetype GLB (emitted by
// tools/character-generator.py from src/data/archetypes.json) carries the
// shared 25-bone skeleton, the clip set, bone-parented attachments, and its
// natural clip speeds in the glTF root extras. The template is toonified and
// given its outline shell once; instances are skeleton-cloned from it.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneWithSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import archetypesJson from '../data/archetypes.json';
import { toonify, toonMaterial } from '../render/toonify';
import { AdditiveBonePose } from './additive-pose';
import { Locomotion } from './locomotion';

interface ArchetypeSpec {
  model: string;
  coats: string[];
  mesh?: { height?: number };
}

const ARCHETYPES = archetypesJson as unknown as Record<string, ArchetypeSpec | string>;

export interface ArchetypeAsset {
  name: string;
  template: THREE.Object3D;
  clips: THREE.AnimationClip[];
  naturalSpeeds: Record<string, number>;
  coats: string[];
  /** Archetype base scale; per-instance variation multiplies it. */
  baseHeight: number;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<ArchetypeAsset>>();

export function loadArchetype(name: string): Promise<ArchetypeAsset> {
  let pending = cache.get(name);
  if (!pending) {
    const spec = ARCHETYPES[name];
    if (!spec || typeof spec === 'string') {
      throw new Error(`Unknown archetype: ${name}`);
    }
    pending = loader
      .loadAsync(import.meta.env.BASE_URL + spec.model)
      .then((gltf) => {
        const template = gltf.scene;
        toonify(template);
        const extras = (gltf.parser.json as { extras?: { naturalSpeeds?: Record<string, number> } })
          .extras;
        return {
          name,
          template,
          clips: gltf.animations,
          naturalSpeeds: extras?.naturalSpeeds ?? {},
          coats: spec.coats,
          baseHeight: spec.mesh?.height ?? 1,
        };
      });
    cache.set(name, pending);
  }
  return pending;
}

import tuning from '../data/tuning.json';

const LEAN = tuning.locomotion.turnLean;
const WEIGHT = tuning.locomotion.weightShift;
const IDLE = tuning.locomotion.idleMotion;

export class Actor {
  readonly group = new THREE.Group();
  readonly locomotion: Locomotion;
  private readonly modelRoot: THREE.Object3D;
  private readonly spine: THREE.Object3D | null;
  private readonly head: THREE.Object3D | null;
  private readonly spinePose = new AdditiveBonePose();
  private readonly headPose = new AdditiveBonePose();
  private readonly spineOffset = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly headOffset = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly motionPhase: number;
  private lean = 0;
  private accelerationLean = 0;
  private idleWeight = 0;
  private motionTime = 0;
  private lookYawTarget = 0;
  private lookPitchTarget = 0;
  private lookWeightTarget = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private lookWeight = 0;

  constructor(asset: ArchetypeAsset, options: { coat?: string; height?: number } = {}) {
    const root = cloneWithSkeleton(asset.template);
    const coat = options.coat ?? asset.coats[0] ?? '#ffffff';
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.sourcePart === 'Body') {
        (o as THREE.Mesh).material = toonMaterial(coat);
      }
    });
    // Group scale scales about the feet, so this is genuine height variation.
    // options.height is per-instance variation on top of the archetype base.
    this.group.scale.setScalar(asset.baseHeight * (options.height ?? 1));
    this.group.add(root);
    this.modelRoot = root;
    this.spine = root.getObjectByName('Spine2') ?? null;
    this.head = root.getObjectByName('Head') ?? null;
    this.locomotion = new Locomotion(new THREE.AnimationMixer(root), asset.clips, asset.naturalSpeeds);
    // deterministic per-instance idle offset — no synchronized breathing
    const instance = Actor.instances++;
    this.motionPhase = instance * IDLE.desyncStep * Math.PI * 2;
    this.locomotion.desync((instance * IDLE.desyncStep) % 1);
  }

  private static instances = 0;

  /** Set a bounded local head-look offset. Conversation and awareness systems
   * can steer this without touching the skeleton or fighting idle animation. */
  setLookOffset(yaw: number, pitch = 0, weight = 1): void {
    const look = IDLE.look;
    this.lookYawTarget = THREE.MathUtils.clamp(
      yaw,
      -THREE.MathUtils.degToRad(look.maxYawDeg),
      THREE.MathUtils.degToRad(look.maxYawDeg),
    );
    this.lookPitchTarget = THREE.MathUtils.clamp(
      pitch,
      -THREE.MathUtils.degToRad(look.maxPitchDeg),
      THREE.MathUtils.degToRad(look.maxPitchDeg),
    );
    this.lookWeightTarget = THREE.MathUtils.clamp(weight, 0, 1);
  }

  clearLookOffset(): void {
    this.lookWeightTarget = 0;
  }

  /** Read-only review probe for the final idle/conversation validation. */
  headRotation(): readonly [number, number, number] | null {
    return this.head
      ? [this.head.rotation.x, this.head.rotation.y, this.head.rotation.z]
      : null;
  }

  /** yawRate (rad/s) banks the model into turns. Applied to the model child
   *  under the externally-set group yaw — sim state and cones never see it. */
  update(speed: number, dt: number, yawRate = 0, acceleration = 0): void {
    // Remove last frame's procedural offsets before the mixer writes its
    // keyed pose. This is essential for Head, which is intentionally not
    // keyed by every clip and would otherwise accumulate forever.
    this.spinePose.remove(this.spine);
    this.headPose.remove(this.head);
    this.motionTime += dt;
    const target = THREE.MathUtils.clamp(
      -yawRate * speed * LEAN.gain,
      -THREE.MathUtils.degToRad(LEAN.maxDeg), THREE.MathUtils.degToRad(LEAN.maxDeg),
    );
    this.lean += (target - this.lean) * Math.min(1, dt * LEAN.smooth);
    const accelerationTarget = THREE.MathUtils.clamp(
      acceleration * WEIGHT.accelerationGain,
      -THREE.MathUtils.degToRad(WEIGHT.maxDeg), THREE.MathUtils.degToRad(WEIGHT.maxDeg),
    );
    this.accelerationLean += (accelerationTarget - this.accelerationLean)
      * Math.min(1, dt * WEIGHT.smooth);
    this.modelRoot.rotation.z = this.lean;
    this.modelRoot.rotation.x = this.accelerationLean;
    this.locomotion.update(speed, dt);

    const idleTarget = 1 - THREE.MathUtils.clamp(speed / IDLE.fadeSpeed, 0, 1);
    this.idleWeight += (idleTarget - this.idleWeight) * Math.min(1, dt * LEAN.smooth);
    if (this.spine) {
      this.spineOffset.set(
        0,
        0,
        Math.sin(this.motionTime * IDLE.breathRate + this.motionPhase)
          * THREE.MathUtils.degToRad(IDLE.breathDeg) * this.idleWeight,
        'YXZ',
      );
      this.spinePose.apply(this.spine, this.spineOffset);
    }
    if (this.head) {
      const response = 1 - Math.exp(-IDLE.look.responseRate * dt);
      this.lookYaw += (this.lookYawTarget - this.lookYaw) * response;
      this.lookPitch += (this.lookPitchTarget - this.lookPitch) * response;
      this.lookWeight += (this.lookWeightTarget - this.lookWeight) * response;
      const idleYaw = Math.sin(this.motionTime * IDLE.headRate + this.motionPhase)
        * THREE.MathUtils.degToRad(IDLE.headDeg) * this.idleWeight;
      this.headOffset.set(
        this.lookPitch * this.lookWeight,
        idleYaw + this.lookYaw * this.lookWeight,
        0,
        'YXZ',
      );
      this.headPose.apply(this.head, this.headOffset);
    }
  }
}
