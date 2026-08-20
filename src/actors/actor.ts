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
import { addOutlineShell } from '../render/outline';
import { Locomotion } from './locomotion';

interface ArchetypeSpec {
  model: string;
  coats: string[];
}

const ARCHETYPES = archetypesJson as unknown as Record<string, ArchetypeSpec | string>;

export interface ArchetypeAsset {
  name: string;
  template: THREE.Object3D;
  clips: THREE.AnimationClip[];
  naturalSpeeds: Record<string, number>;
  coats: string[];
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
        template.traverse((o) => {
          if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name === 'Body') {
            addOutlineShell(o as THREE.SkinnedMesh);
          }
        });
        const extras = (gltf.parser.json as { extras?: { naturalSpeeds?: Record<string, number> } })
          .extras;
        return {
          name,
          template,
          clips: gltf.animations,
          naturalSpeeds: extras?.naturalSpeeds ?? {},
          coats: spec.coats,
        };
      });
    cache.set(name, pending);
  }
  return pending;
}

export class Actor {
  readonly group = new THREE.Group();
  readonly locomotion: Locomotion;

  constructor(asset: ArchetypeAsset, options: { coat?: string; height?: number } = {}) {
    const root = cloneWithSkeleton(asset.template);
    const coat = options.coat ?? asset.coats[0] ?? '#ffffff';
    root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh && o.name === 'Body') {
        (o as THREE.SkinnedMesh).material = toonMaterial(coat);
      }
    });
    // Group scale scales about the feet, so this is genuine height variation.
    if (options.height !== undefined) this.group.scale.setScalar(options.height);
    this.group.add(root);
    this.locomotion = new Locomotion(new THREE.AnimationMixer(root), asset.clips, asset.naturalSpeeds);
  }

  update(speed: number, dt: number): void {
    this.locomotion.update(speed, dt);
  }
}
