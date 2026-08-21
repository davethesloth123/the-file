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

export class Actor {
  readonly group = new THREE.Group();
  readonly locomotion: Locomotion;
  private readonly modelRoot: THREE.Object3D;
  private lean = 0;

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
    this.locomotion = new Locomotion(new THREE.AnimationMixer(root), asset.clips, asset.naturalSpeeds);
    // deterministic per-instance idle offset — no synchronized breathing
    this.locomotion.desync((Actor.instances++ * 0.618) % 1);
  }

  private static instances = 0;

  /** yawRate (rad/s) banks the model into turns. Applied to the model child
   *  under the externally-set group yaw — sim state and cones never see it. */
  update(speed: number, dt: number, yawRate = 0): void {
    const target = THREE.MathUtils.clamp(
      -yawRate * speed * LEAN.gain,
      -THREE.MathUtils.degToRad(LEAN.maxDeg), THREE.MathUtils.degToRad(LEAN.maxDeg),
    );
    this.lean += (target - this.lean) * Math.min(1, dt * LEAN.smooth);
    this.modelRoot.rotation.z = this.lean;
    this.locomotion.update(speed, dt);
  }
}
