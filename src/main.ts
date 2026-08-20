// Session 1 bootstrap: fixed-step loop + graded render of a placeholder scene
// (ground plane and three boxes under the bible §8 sky, fog and sun — the
// grade needs something to act on). One box turns via the fixed-step sim with
// interpolated rendering, so smoothness of that motion is the visible proof
// the accumulator works. No gameplay here.
import * as THREE from 'three';
import { FixedClock } from './core/clock';
import { createRenderer } from './render/renderer';
import { GradePass } from './render/grade';
import { createBench } from './ui/bench';

const P = {
  road: 0x46423a,
  ochre: 0xc09550,
  sage: 0x77785f,
  bone: 0xb4a88e,
} as const;

const renderer = createRenderer();
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb3a992);
scene.fog = new THREE.Fog(0xb3a992, 52, 180);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 400);
camera.position.set(8, 5, 12);
camera.lookAt(0, 1, 0);

// Bible §8 light intensities were authored under three.js legacy lighting
// (pre-r155), which scaled lights by π. Modern three dropped that factor, so
// it is restored here — the authored numbers stay the bible's.
const LEGACY_LIGHT_SCALE = Math.PI;

const sun = new THREE.DirectionalLight(0xffeec4, 1.2 * LEGACY_LIGHT_SCALE);
sun.position.set(30, 45, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xc4baa2, 0x453c2c, 0.6 * LEGACY_LIGHT_SCALE));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: P.road }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

function box(x: number, z: number, h: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(3, h, 3),
    new THREE.MeshLambertMaterial({ color }),
  );
  mesh.position.set(x, h / 2, z);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}
box(-4, 3, 3, P.ochre);
box(0, 6, 2, P.sage);
const spinner = box(5, 2, 1, P.bone);

// Scaffold-only demo state for the spinning box; replaced by real actors in
// later sessions. Interpolating between the previous and current sim states
// is the pattern every rendered thing will follow.
const SPIN_RAD_PER_SEC = 0.5;
let spinPrev = 0;
let spinCurr = 0;

const grade = new GradePass();
createBench(grade);

function resize(): void {
  const dpr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  grade.setSize(innerWidth * dpr, innerHeight * dpr);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new FixedClock();

renderer.setAnimationLoop((nowMs: number) => {
  const alpha = clock.tick(nowMs, (dt) => {
    spinPrev = spinCurr;
    spinCurr += SPIN_RAD_PER_SEC * dt;
  });
  spinner.rotation.y = spinPrev + (spinCurr - spinPrev) * alpha;
  grade.render(renderer, scene, camera, nowMs / 1000);
});
