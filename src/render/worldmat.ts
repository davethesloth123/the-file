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
  /** ground-contact darkening: strength 0-1 and fade-top height in metres.
   *  Gated to near-vertical surfaces, so floors and pavements are immune. */
  baseGrime?: number;
  baseGrimeH?: number;
  /** Height-field strength in metres. The grayscale albedo is also used as
   *  a very cheap browser-friendly bump source, so close surfaces catch
   *  light without needing a second normal-map texture. */
  bumpAmt?: number;
  /** Restrained grazing highlight. This differentiates glass/metal/wet
   *  surfaces from plaster and stone while preserving the toon palette. */
  sheen?: number;
  sheenPower?: number;
  /** Vertex sway in metres; only foliage definitions use this. */
  windAmt?: number;
  alphaMap?: string;
  alphaTest?: number;
  doubleSided?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
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
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    textureCache.set(path, t);
  }
  return t;
}

function loadCutout(path: string): THREE.Texture {
  const t = loadTiling(path);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

const colorCache = new Map<string, THREE.MeshToonMaterial>();

/** Plain toon material for one-off coloured props (cars etc.) — no maps. */
export function toonColor(hex: string): THREE.MeshToonMaterial {
  let m = colorCache.get(hex);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color: hex, gradientMap: toonRamp() });
    colorCache.set(hex, m);
  }
  return m;
}

const materialCache = new Map<string, THREE.MeshToonMaterial>();
const animatedUniforms: { value: number }[] = [];

/** One shared time update for every animated world material. Foliage remains
 * merged by material (three draw calls for the whole district), while this
 * supplies just enough movement to stop the canopy reading as sculpture. */
export function updateWorldMaterials(timeSeconds: number): void {
  for (const uniform of animatedUniforms) uniform.value = timeSeconds;
}

export function worldMaterial(name: string): THREE.MeshToonMaterial {
  let material = materialCache.get(name);
  if (material) return material;
  const def = DEFS[name];
  if (!def || typeof def === 'string') throw new Error(`Unknown world material: ${name}`);

  material = new THREE.MeshToonMaterial({
    color: def.color,
    gradientMap: toonRamp(),
    alphaMap: def.alphaMap ? loadCutout(def.alphaMap) : null,
    alphaTest: def.alphaTest ?? 0,
    side: def.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
    emissive: def.emissive ?? 0x000000,
    emissiveIntensity: def.emissiveIntensity ?? 0,
  });
  const uniforms = {
    tAlbedo: { value: loadTiling(def.albedo) },
    tGrime: { value: loadTiling(def.grime) },
    uTexScale: { value: def.texScale },
    uAlbedoAmt: { value: def.albedoAmt },
    uGrimeAmt: { value: def.grimeAmt },
    uBaseGrime: { value: def.baseGrime ?? 0 },
    uBaseGrimeH: { value: def.baseGrimeH ?? 1 },
    uBumpAmt: { value: def.bumpAmt ?? 0 },
    uSheen: { value: def.sheen ?? 0 },
    uSheenPower: { value: def.sheenPower ?? 4 },
    uTime: { value: 0 },
    uWindAmt: { value: def.windAmt ?? 0 },
  };
  if (def.windAmt) animatedUniforms.push(uniforms.uTime);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vTriPos;
        varying vec3 vTriNorm;
        uniform float uTime, uWindAmt;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          float windMask = smoothstep(1.0, 7.5, position.y);
          float gust = sin(uTime * 0.72 + position.x * 0.37 + position.z * 0.21)
            + sin(uTime * 1.11 + position.z * 0.43) * 0.35;
          transformed.x += gust * uWindAmt * windMask;
          transformed.z += gust * uWindAmt * windMask * 0.32;
        }`,
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
        uniform float uTexScale, uAlbedoAmt, uGrimeAmt, uBaseGrime, uBaseGrimeH;
        uniform float uBumpAmt, uSheen, uSheenPower;
        float triSample(sampler2D t, vec3 w) {
          vec3 an = pow(abs(normalize(vTriNorm)), vec3(4.0));
          an /= (an.x + an.y + an.z);
          return texture2D(t, w.zy * uTexScale).r * an.x
               + texture2D(t, w.xz * uTexScale).r * an.y
               + texture2D(t, w.xy * uTexScale).r * an.z;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Screen-space height derivatives produce a stable world-space
          // bump normal with no UVs and no extra texture fetches/assets.
          float h = triSample(tAlbedo, vTriPos);
          vec3 sigmaX = dFdx(vTriPos);
          vec3 sigmaY = dFdy(vTriPos);
          vec3 r1 = cross(sigmaY, normal);
          vec3 r2 = cross(normal, sigmaX);
          float det = dot(sigmaX, r1);
          vec3 surfaceGradient = sign(det)
            * (dFdx(h) * r1 + dFdy(h) * r2);
          normal = normalize(abs(det) * normal - uBumpAmt * surfaceGradient);
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
          // walls sit into the street: rising damp and boot-splash darkening
          // over the bottom metre-and-a-half, walls only, never floors
          float wallness = 1.0 - abs(normalize(vTriNorm).y);
          diffuseColor.rgb *= 1.0 - uBaseGrime * wallness
            * (1.0 - smoothstep(0.0, uBaseGrimeH, vTriPos.y));
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          // A low-energy, view-dependent finish cue. Matte surfaces leave
          // this at zero; glass, wet asphalt and metal catch restrained light.
          float grazing = pow(
            1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0),
            uSheenPower
          );
          outgoingLight += vec3(uSheen * grazing);
        }
        #include <opaque_fragment>`,
      );
  };
  // Distinct cache key per definition so three treats each as its own program.
  material.customProgramCacheKey = () => `worldmat_v2_${name}`;
  materialCache.set(name, material);
  return material;
}
