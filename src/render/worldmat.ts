// World materials: MeshToonMaterial patched for world-space triplanar
// sampling of the tiling value maps from tools/texture-generator.py — no UV
// authoring anywhere in the kit. The albedo map (centred on mid-grey)
// modulates the palette colour; the grime map multiplies it down. Because
// the ramp quantises lighting into three hard bands, this low-frequency
// value variation is most of the surface information that survives the
// grade. Definitions live in src/data/materials.json.
import * as THREE from 'three';
import materialsJson from '../data/materials.json';

interface WorldMaterialDef {
  color: string;
  albedo: string;
  grime: string;
  texScale: number;
  albedoAmt: number;
  grimeAmt: number;
}

const DEFS = materialsJson as unknown as Record<string, WorldMaterialDef | string>;

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

const loader = new THREE.TextureLoader();
const textureCache = new Map<string, THREE.Texture>();
function loadTiling(path: string): THREE.Texture {
  let t = textureCache.get(path);
  if (!t) {
    t = loader.load(import.meta.env.BASE_URL + path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    textureCache.set(path, t);
  }
  return t;
}

const materialCache = new Map<string, THREE.MeshToonMaterial>();

export function worldMaterial(name: string): THREE.MeshToonMaterial {
  let material = materialCache.get(name);
  if (material) return material;
  const def = DEFS[name];
  if (!def || typeof def === 'string') throw new Error(`Unknown world material: ${name}`);

  material = new THREE.MeshToonMaterial({
    color: def.color,
    gradientMap: toonRamp(),
  });
  const uniforms = {
    tAlbedo: { value: loadTiling(def.albedo) },
    tGrime: { value: loadTiling(def.grime) },
    uTexScale: { value: def.texScale },
    uAlbedoAmt: { value: def.albedoAmt },
    uGrimeAmt: { value: def.grimeAmt },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNorm;',
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTriNorm = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNorm;
        uniform sampler2D tAlbedo, tGrime;
        uniform float uTexScale, uAlbedoAmt, uGrimeAmt;
        float triSample(sampler2D t, vec3 w) {
          vec3 an = pow(abs(normalize(vTriNorm)), vec3(4.0));
          an /= (an.x + an.y + an.z);
          return texture2D(t, w.zy * uTexScale).r * an.x
               + texture2D(t, w.xz * uTexScale).r * an.y
               + texture2D(t, w.xy * uTexScale).r * an.z;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float alb = triSample(tAlbedo, vTriPos);
          float grm = triSample(tGrime, vTriPos);
          diffuseColor.rgb *= mix(1.0, alb * 2.0, uAlbedoAmt);
          diffuseColor.rgb *= mix(1.0, grm, uGrimeAmt);
        }`,
      );
  };
  // Distinct cache key per definition so three treats each as its own program.
  material.customProgramCacheKey = () => `worldmat_${name}`;
  materialCache.set(name, material);
  return material;
}
