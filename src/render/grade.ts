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
] as const;

export type GradeUniformName = (typeof GRADE_UNIFORM_NAMES)[number];

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float uSat, uSepia, uWarm, uContrast, uLift, uVignette, uGrain, uRedKeep, uTime;
uniform vec2 uRes;
varying vec2 vUv;

const vec3 L = vec3(0.2126, 0.7152, 0.0722);
// The three anchors: cool grey-green shadow, khaki mid, warm cream high.
const vec3 A = vec3(0.38, 0.41, 0.43);
const vec3 B = vec3(0.73, 0.63, 0.44);
const vec3 C = vec3(1.02, 0.93, 0.72);

float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
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

  constructor() {
    this.defaults = { ...tuning.grade };
    this.uniforms = Object.fromEntries(
      GRADE_UNIFORM_NAMES.map((name) => [name, { value: tuning.grade[name] }]),
    ) as Record<GradeUniformName, THREE.IUniform<number>>;
    this.uTime = { value: 0 };
    this.uRes = { value: new THREE.Vector2(1, 1) };

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    const material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.uniforms,
        uTime: this.uTime,
        uRes: this.uRes,
        tDiffuse: { value: this.target.texture },
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
