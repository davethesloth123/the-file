// Cel shading: hard three-band toon ramp with NearestFilter steps (bible §8).
// toonify() swaps every material on a loaded object for a MeshToonMaterial of
// the same colour, preserving skinning. The material named 'Outline' is the
// GLB's baked inverted-hull shell (verts pre-pushed along normals by the
// generator, bound to the same skeleton): it gets BackSide ink instead of a
// toon material, and never casts shadows. Materials are cached per colour so
// instances share GPU state. The source material's name is kept on
// userData.sourcePart so instances can recolour specific parts (the coat).
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

const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x231d15,
  side: THREE.BackSide,
});

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
      mesh.userData.sourcePart = old.name;
      if (old.name === 'Outline') {
        mesh.material = OUTLINE_MATERIAL;
        mesh.castShadow = false;
      } else {
        mesh.material = toonMaterial(old.color ?? 0xffffff);
        // bone-parented attachments (hats, canes, bags) don't cast: a cap
        // shadow across the eyes turns every face into the darkest toon
        // band and the cast stops reading
        mesh.castShadow = !(o.parent?.name ?? '').startsWith('att_')
          && !o.name.startsWith('att_');
      }
    }
  });
}
