import * as THREE from 'three';

export interface AtmosphereConfig {
  skyColor: string;
  skyZenith: string;
  skyHorizon: string;
  sunAzimuthDeg: number;
  sunElevationDeg: number;
  sunColor: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  shadowMapSize: number;
  shadowExtent: number;
  shadowNormalBias: number;
  shadowFar: number;
}

export interface AtmosphereRig {
  sun: THREE.DirectionalLight;
  /** Keep the high-resolution shadow footprint around the player instead of
   * wasting a 2K map across the entire 220m district. */
  focus(x: number, z: number): void;
}

const LEGACY_LIGHT_SCALE = Math.PI;

export function sunOffset(config: AtmosphereConfig, radius = 150): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(config.sunAzimuthDeg);
  const el = THREE.MathUtils.degToRad(config.sunElevationDeg);
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    radius * Math.cos(el) * Math.cos(az),
  );
}

export function createAtmosphere(
  scene: THREE.Scene,
  config: AtmosphereConfig,
): AtmosphereRig {
  const offset = sunOffset(config);
  const target = new THREE.Object3D();
  scene.add(target);

  const sun = new THREE.DirectionalLight(
    config.sunColor,
    config.sunIntensity * LEGACY_LIGHT_SCALE,
  );
  sun.position.copy(offset);
  sun.target = target;
  sun.castShadow = true;
  sun.shadow.mapSize.set(config.shadowMapSize, config.shadowMapSize);
  sun.shadow.camera.left = -config.shadowExtent;
  sun.shadow.camera.right = config.shadowExtent;
  sun.shadow.camera.top = config.shadowExtent;
  sun.shadow.camera.bottom = -config.shadowExtent;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = config.shadowFar;
  sun.shadow.normalBias = config.shadowNormalBias;
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 1.8;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(
    config.hemiSky,
    config.hemiGround,
    config.hemiIntensity * LEGACY_LIGHT_SCALE,
  ));

  // A low-cost sky sphere gives a cooler upper sky and warm, dirty horizon.
  // It supplies atmospheric depth without bloom, fantasy colour, or a heavy
  // post-processing stack.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(340, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(config.skyZenith) },
        uHorizon: { value: new THREE.Color(config.skyHorizon) },
      },
      vertexShader: `
        varying vec3 vSkyDirection;
        void main() {
          vSkyDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uZenith, uHorizon;
        varying vec3 vSkyDirection;
        void main() {
          float height = smoothstep(-0.08, 0.72, vSkyDirection.y);
          float horizonHaze = 1.0 - smoothstep(0.0, 0.24, abs(vSkyDirection.y));
          vec3 color = mix(uHorizon, uZenith, height);
          color = mix(color, uHorizon * 1.035, horizonHaze * 0.34);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  scene.add(sky);

  return {
    sun,
    focus(x: number, z: number): void {
      target.position.set(x, 0, z);
      sun.position.copy(target.position).add(offset);
      target.updateMatrixWorld();
    },
  };
}
