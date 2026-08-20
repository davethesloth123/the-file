// Cel shading: hard three-band toon ramp with NearestFilter steps (bible §8).
// toonify() swaps every material on a loaded object for a MeshToonMaterial of
// the same colour, preserving skinning (modern three handles skinned meshes
// automatically — no `skinning` flag). Materials are cached per colour so
// instances share GPU state.
import * as THREE from 'three';

let ramp: THREE.DataTexture | null = null;

function toonRamp(): THREE.DataTexture {
  if (!ramp) {
    const n = 3;
    const data = new Uint8Array(n);
    for (let i = 0; i < n; i++) data[i] = Math.round(62 + (193 * i) / (n - 1));
    ramp = new THREE.DataTexture(data, n, 1, THREE.RedFormat);
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
    ramp.generateMipmaps = false;
    ramp.needsUpdate = true;
  }
  return ramp;
}

const cache = new Map<number, THREE.MeshToonMaterial>();

export function toonMaterial(color: THREE.ColorRepresentation): THREE.MeshToonMaterial {
  const hex = new THREE.Color(color).getHex();
  let material = cache.get(hex);
  if (!material) {
    material = new THREE.MeshToonMaterial({ color: hex, gradientMap: toonRamp() });
    cache.set(hex, material);
  }
  return material;
}

export function toonify(root: THREE.Object3D): void {
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      const mesh = o as THREE.Mesh;
      const old = mesh.material as THREE.Material & { color?: THREE.Color };
      mesh.material = toonMaterial(old.color ?? 0xffffff);
      mesh.castShadow = true;
    }
  });
}
