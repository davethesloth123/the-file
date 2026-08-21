// The split-tone grade — the identity of the game's look (bible §8).
// Ported exactly from reference/the-file-mvp.html. The three tint anchors and
// the luminance-normalisation line are the art direction; do not drift them.
import * as THREE from 'three';
import tuning from '../data/tuning.json';

export const GRADE_UNIFORM_NAMES = [
  'uSat',
  'uSepia',
  'uWarm',
  'uContrast',
  'uLift',
  'uVignette',
  'uGrain',
  'uRedKeep',
  'uEdge',
  'uEdgeDepth',
  'uEdgeCrease',
  'uEdgeFade',
] as const;

export type GradeUniformName = (typeof GRADE_UNIFORM_NAMES)[number];

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float uSat, uSepia, uWarm, uContrast, uLift, uVignette, uGrain, uRedKeep, uTime;
uniform float uEdge, uEdgeDepth, uEdgeCrease, uEdgeFade, uNear, uFar;
uniform vec2 uRes;
varying vec2 vUv;

const vec3 L = vec3(0.2126, 0.7152, 0.0722);
// The three anchors: cool grey-green shadow, khaki mid, warm cream high.
const vec3 A = vec3(0.38, 0.41, 0.43);
const vec3 B = vec3(0.73, 0.63, 0.44);
const vec3 C = vec3(1.02, 0.93, 0.72);
// Ink for drawn lines — same ink as the character outline shells.
const vec3 INK = vec3(0.137, 0.114, 0.082);

float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Linearised scene depth in metres.
float linD(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

// The ink pass (CLAUDE.md's ship-quality outline): first-order depth
// differences draw silhouettes, the depth Laplacian draws creases —
// window reveals, cornices, kerbs — and both fade out before the fog
// takes the horizon so distance never turns to noise. Lines are laid
// into the colour BEFORE the grade, so ink is graded like paint.
float ink(vec2 uv) {
  vec2 px = 1.0 / uRes;
  float d0 = linD(uv);
  float dl = linD(uv - vec2(px.x, 0.0)), dr = linD(uv + vec2(px.x, 0.0));
  float dd = linD(uv - vec2(0.0, px.y)), du = linD(uv + vec2(0.0, px.y));
  float ref = max(d0, 0.001);
  float sil = max(abs(dr - dl), abs(du - dd)) / ref;
  float crease = (abs(dr + dl - 2.0 * d0) + abs(du + dd - 2.0 * d0)) / ref;
  // thresholds grow with distance: depth precision thins out toward the
  // fog and grazing-angle ground would otherwise stripe
  float tGrow = 1.0 + d0 * 0.04;
  float tD = uEdgeDepth * tGrow, tC = uEdgeCrease * tGrow;
  float e = max(smoothstep(tD, tD * 2.4, sil),
                smoothstep(tC, tC * 2.4, crease));
  float fade = 1.0 - smoothstep(uEdgeFade * 0.35, uEdgeFade, d0);
  return e * fade * uEdge;
}

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  c = mix(c, INK, ink(vUv));
  float l = dot(c, L);
  float r = clamp((c.r - max(c.g, c.b)) * 2.4, 0., 1.);
  vec3 d = mix(vec3(l), c, uSat);
  vec3 t = l < 0.5 ? mix(A, B, l * 2.) : mix(B, C, (l - 0.5) * 2.);
  t = mix(vec3(1.), t, uWarm);
  // Normalising the tint by its own luminance shifts hue without darkening.
  vec3 o = mix(d, d * t / max(dot(t, L), 0.001), uSepia);
  o = mix(o, c, r * uRedKeep);
  o = (o - 0.5) * uContrast + 0.5;
  vec3 f = vec3(0.085, 0.076, 0.062) * uLift;
  o = f + o * (1. - f);
  o *= 1. - smoothstep(0.33, 0.85, distance(vUv, vec2(0.5))) * uVignette;
  o += (h(vUv * uRes + fract(uTime) * 431.) - 0.5) * uGrain * (1. - l * 0.65);
  gl_FragColor = vec4(clamp(o, 0., 1.), 1.);
}
`;

export class GradePass {
  readonly uniforms: Record<GradeUniformName, THREE.IUniform<number>>;
  readonly defaults: Record<GradeUniformName, number>;

  private readonly target: THREE.WebGLRenderTarget;
  private readonly postScene: THREE.Scene;
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly uTime: THREE.IUniform<number>;
  private readonly uRes: THREE.IUniform<THREE.Vector2>;
  private readonly uNear: THREE.IUniform<number>;
  private readonly uFar: THREE.IUniform<number>;

  constructor() {
    this.defaults = { ...tuning.grade };
    this.uniforms = Object.fromEntries(
      GRADE_UNIFORM_NAMES.map((name) => [name, { value: tuning.grade[name] }]),
    ) as Record<GradeUniformName, THREE.IUniform<number>>;
    this.uTime = { value: 0 };
    this.uRes = { value: new THREE.Vector2(1, 1) };
    this.uNear = { value: 0.1 };
    this.uFar = { value: 400 };

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    // readable depth for the ink pass
    this.target.depthTexture = new THREE.DepthTexture(1, 1);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uTime: this.uTime,
        uRes: this.uRes,
        uNear: this.uNear,
        uFar: this.uFar,
        tDiffuse: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
      },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    this.uRes.value.set(width, height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    timeSeconds: number,
  ): void {
    this.uTime.value = timeSeconds;
    const persp = camera as THREE.PerspectiveCamera;
    if (persp.isPerspectiveCamera) {
      this.uNear.value = persp.near;
      this.uFar.value = persp.far;
    }
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.postScene, this.postCamera);
  }

  reset(): void {
    for (const name of GRADE_UNIFORM_NAMES) {
      this.uniforms[name].value = this.defaults[name];
    }
  }
}
