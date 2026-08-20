// Session 2 check scene: eight characters of mixed archetypes walking loops
// at varied speeds, so silhouettes, gait differentiation and stride lock can
// be reviewed on the preview. `?grade=off` renders ungraded for inspection.
// Positions advance in the fixed-step sim and rendering interpolates.
import * as THREE from 'three';
import { FixedClock } from './core/clock';
import { createRenderer } from './render/renderer';
import { GradePass } from './render/grade';
import { createBench } from './ui/bench';
import { Actor, loadArchetype } from './actors/actor';

const QUERY = new URLSearchParams(location.search);
const GRADE_OFF = QUERY.get('grade') === 'off';
// ?lineup poses the five archetypes in a row, walking in place at their
// natural speeds, for silhouette review.
const LINEUP = QUERY.has('lineup');

const P = { road: 0x46423a, ochre: 0xc09550, sage: 0x77785f } as const;

const renderer = createRenderer();
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb3a992);
scene.fog = new THREE.Fog(0xb3a992, 52, 180);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 400);
if (LINEUP) {
  camera.position.set(0, 1.5, 6.2);
  camera.lookAt(0, 1.0, 0);
} else {
  camera.position.set(0, 3.2, 13);
  camera.lookAt(0, 1.2, 0);
}

// Bible §8 intensities were authored under pre-r155 legacy lighting (π-scaled).
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

for (const [x, z, h, color] of [
  [-18, -6, 9, P.ochre],
  [18, -8, 7, P.sage],
] as const) {
  const block = new THREE.Mesh(
    new THREE.BoxGeometry(6, h, 6),
    new THREE.MeshLambertMaterial({ color }),
  );
  block.position.set(x, h / 2, z);
  block.castShadow = block.receiveShadow = true;
  scene.add(block);
}

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

// ------------------------------------------------------------- walkers
type Route = [number, number][];

interface Walker {
  actor: Actor;
  route: Route;
  target: number;
  speed: number;
  x: number; z: number; yaw: number;
  px: number; pz: number; pyaw: number;
}

const walkers: Walker[] = [];

const OUTER: Route = [[-13, 7], [13, 7], [13, -3], [-13, -3]];
const INNER: Route = [[-8, 3], [-8, -7], [8, -7], [8, 3]];

// Speeds chosen to exercise the stride lock: several at their archetype's
// natural walk (timeScale 1), some off-natural, one at jog. Values shown in
// the reviewer note below; these are demo-scene inputs, not tuning.
const CAST: [archetype: string, route: Route, phase: number, speed: number, height: number, coatIndex: number][] = [
  ['militia',      OUTER, 0.00, 1.759, 1.02, 0],
  ['militia',      OUTER, 0.50, 1.4,   1.0,  0],
  ['civilian_m',   OUTER, 0.25, 2.05,  0.97, 1],
  ['civilian_m',   INNER, 0.10, 2.6,   1.05, 3],
  ['civilian_f',   OUTER, 0.75, 2.053, 0.95, 0],
  ['civilian_f',   INNER, 0.60, 4.05,  0.99, 2],
  ['civilian_old', INNER, 0.35, 1.329, 0.94, 1],
  ['player',       INNER, 0.85, 2.05,  1.0,  0],
];

function routePoint(route: Route, t: number): [number, number] {
  const seg = Math.floor(t * route.length) % route.length;
  return route[seg]!;
}

async function spawnLineup(): Promise<void> {
  const names = ['militia', 'civilian_m', 'civilian_f', 'civilian_old', 'player'];
  for (let i = 0; i < names.length; i++) {
    const asset = await loadArchetype(names[i]!);
    const actor = new Actor(asset, { coat: asset.coats[0]! });
    actor.group.position.set((i - (names.length - 1) / 2) * 1.6, 0, 0);
    actor.group.rotation.y = 0.5;
    scene.add(actor.group);
    const walk = asset.naturalSpeeds['walk'] ?? 0;
    walkers.push({
      actor, route: [], target: 0, speed: walk,
      x: actor.group.position.x, z: 0, yaw: 0.5,
      px: actor.group.position.x, pz: 0, pyaw: 0.5,
    });
  }
}

async function spawnCast(): Promise<void> {
  const names = [...new Set(CAST.map(([n]) => n))];
  const assets = new Map(
    await Promise.all(names.map(async (n) => [n, await loadArchetype(n)] as const)),
  );
  for (const [name, route, phase, speed, height, coatIndex] of CAST) {
    const asset = assets.get(name)!;
    const actor = new Actor(asset, { coat: asset.coats[coatIndex % asset.coats.length]!, height });
    scene.add(actor.group);
    const [sx, sz] = routePoint(route, phase);
    const walker: Walker = {
      actor, route, speed,
      target: (Math.floor(phase * route.length) + 1) % route.length,
      x: sx, z: sz, yaw: 0, px: sx, pz: sz, pyaw: 0,
    };
    walkers.push(walker);
  }
}
void (LINEUP ? spawnLineup() : spawnCast());

function stepWalkers(dt: number): void {
  if (LINEUP) return;
  for (const w of walkers) {
    w.px = w.x; w.pz = w.z; w.pyaw = w.yaw;
    const [tx, tz] = w.route[w.target]!;
    const dx = tx - w.x, dz = tz - w.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.4) {
      w.target = (w.target + 1) % w.route.length;
      continue;
    }
    w.x += (dx / dist) * w.speed * dt;
    w.z += (dz / dist) * w.speed * dt;
    const want = Math.atan2(dx, dz);
    const turn = ((want - w.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    w.yaw += turn * Math.min(1, dt * 10);
  }
}

const clock = new FixedClock();
let lastFrameMs: number | null = null;

renderer.setAnimationLoop((nowMs: number) => {
  const frameDt = lastFrameMs === null ? 0 : Math.min((nowMs - lastFrameMs) / 1000, 0.25);
  lastFrameMs = nowMs;

  const alpha = clock.tick(nowMs, stepWalkers);

  for (const w of walkers) {
    w.actor.group.position.set(
      w.px + (w.x - w.px) * alpha, 0, w.pz + (w.z - w.pz) * alpha,
    );
    const dyaw = ((w.yaw - w.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    w.actor.group.rotation.y = w.pyaw + dyaw * alpha;
    w.actor.update(w.speed, frameDt);
  }

  if (GRADE_OFF) {
    renderer.render(scene, camera);
  } else {
    grade.render(renderer, scene, camera, nowMs / 1000);
  }
});
