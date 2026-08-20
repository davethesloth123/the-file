// Session 3 check scene: Zamostye assembled from map.zamostye.json, with
// the cast walking prototype street routes through it. Review helpers:
//   ?grade=off        ungraded
//   ?lineup           labelled archetype lineup on plain ground
//   ?cam=x,y,z,tx,ty,tz   fixed camera pose (screenshots)
//   C                 free-fly inspection camera (WASD + drag, Shift fast)
// Positions advance in the fixed-step sim; rendering interpolates.
import * as THREE from 'three';
import { FixedClock } from './core/clock';
import { createRenderer } from './render/renderer';
import { GradePass } from './render/grade';
import { FreeCam } from './render/freecam';
import { worldMaterial } from './render/worldmat';
import { createBench } from './ui/bench';
import { Actor, loadArchetype } from './actors/actor';
import { buildLevel } from './world/level';

const QUERY = new URLSearchParams(location.search);
const GRADE_OFF = QUERY.get('grade') === 'off';
const LINEUP = QUERY.has('lineup');

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
  camera.position.set(16, 8, 96);
  camera.lookAt(0, 2, 42);
}
const camParam = QUERY.get('cam');
if (camParam) {
  const [x, y, z, tx, ty, tz] = camParam.split(',').map(Number);
  camera.position.set(x ?? 0, y ?? 5, z ?? 10);
  camera.lookAt(tx ?? 0, ty ?? 1, tz ?? 0);
}

// Bible §8 intensities were authored under pre-r155 legacy lighting (π-scaled).
const LEGACY_LIGHT_SCALE = Math.PI;
const sun = new THREE.DirectionalLight(0xffeec4, 1.2 * LEGACY_LIGHT_SCALE);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -115;
sun.shadow.camera.right = 115;
sun.shadow.camera.top = 115;
sun.shadow.camera.bottom = -115;
sun.shadow.camera.far = 300;
sun.shadow.normalBias = 0.25;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xc4baa2, 0x453c2c, 0.6 * LEGACY_LIGHT_SCALE));

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

interface LineupLabel {
  el: HTMLDivElement;
  anchor: THREE.Vector3;
}
const lineupLabels: LineupLabel[] = [];

async function spawnLineup(): Promise<void> {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), worldMaterial('asphalt'));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const names = ['militia', 'civilian_m', 'civilian_f', 'civilian_old', 'player'];
  for (let i = 0; i < names.length; i++) {
    const asset = await loadArchetype(names[i]!);
    const actor = new Actor(asset, { coat: asset.coats[0]! });
    actor.group.position.set((i - (names.length - 1) / 2) * 1.6, 0, 0);
    actor.group.rotation.y = 0.5;
    scene.add(actor.group);
    walkers.push({
      actor, route: [], target: 0, speed: asset.naturalSpeeds['walk'] ?? 0,
      x: actor.group.position.x, z: 0, yaw: 0.5,
      px: actor.group.position.x, pz: 0, pyaw: 0.5,
    });
    const el = document.createElement('div');
    el.textContent = names[i]!.toUpperCase().replace('_', ' ');
    el.style.cssText = [
      'position:fixed', 'transform:translate(-50%,-100%)', 'pointer-events:none',
      'color:#ded2b8', 'background:rgba(20,18,14,0.85)', 'padding:3px 8px',
      'font:10px SF Mono,Roboto Mono,Menlo,Consolas,monospace',
      'letter-spacing:0.2em', 'white-space:nowrap',
    ].join(';');
    document.body.appendChild(el);
    lineupLabels.push({
      el,
      anchor: new THREE.Vector3(
        actor.group.position.x, 1.95 * asset.baseHeight, actor.group.position.z,
      ),
    });
  }
}

const labelPos = new THREE.Vector3();
function updateLineupLabels(): void {
  for (const { el, anchor } of lineupLabels) {
    labelPos.copy(anchor).project(camera);
    el.style.left = `${(labelPos.x * 0.5 + 0.5) * innerWidth}px`;
    el.style.top = `${(-labelPos.y * 0.5 + 0.5) * innerHeight}px`;
  }
}

// City cast on prototype street routes: militia on their beats, civilians
// ping-ponging the avenue and cross street. Speeds are the archetypes'
// natural walks (one civilian pushed off-natural to keep testing the
// stride lock). Demo-scene inputs, not tuning.
const PATROL_A: Route = [[-9, -62], [-9, -14], [9, -14], [9, -62]];
const PATROL_B: Route = [[9, 52], [9, 6], [-9, 6], [-9, 52]];
const CITY_CAST: [archetype: string, route: Route, startIndex: number, speed: number | null, height: number, coatIndex: number][] = [
  ['militia',      PATROL_A,               0, null, 1.0,  0],
  ['militia',      PATROL_B,               2, null, 0.98, 0],
  ['civilian_m',   [[-11, 70], [-11, -40]], 0, null, 0.97, 1],
  ['civilian_m',   [[11, -50], [11, 40]],   1, 2.4,  1.04, 2],
  ['civilian_f',   [[-40, 6], [-11, 6]],    0, null, 0.98, 0],
  ['civilian_f',   [[11, 30], [11, -34]],   1, null, 1.02, 2],
  ['civilian_old', [[-11, -20], [-11, 44]], 0, null, 1.0,  1],
  ['player',       [[11, -6], [46, -6]],    0, null, 1.0,  0],
];

async function spawnCityCast(): Promise<void> {
  const names = [...new Set(CITY_CAST.map(([n]) => n))];
  const assets = new Map(
    await Promise.all(names.map(async (n) => [n, await loadArchetype(n)] as const)),
  );
  for (const [name, route, startIndex, speed, height, coatIndex] of CITY_CAST) {
    const asset = assets.get(name)!;
    const actor = new Actor(asset, { coat: asset.coats[coatIndex % asset.coats.length]!, height });
    scene.add(actor.group);
    const [sx, sz] = route[startIndex]!;
    walkers.push({
      actor, route, speed: speed ?? asset.naturalSpeeds['walk'] ?? 1,
      target: (startIndex + 1) % route.length,
      x: sx, z: sz, yaw: 0, px: sx, pz: sz, pyaw: 0,
    });
  }
}

if (LINEUP) {
  void spawnLineup();
} else {
  buildLevel(scene);
  void spawnCityCast();
}

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

const freecam = new FreeCam(camera, renderer.domElement);
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') {
    if (freecam.enabled) freecam.disable();
    else freecam.enable();
  }
});

const clock = new FixedClock();
let lastFrameMs: number | null = null;
let statsLogged = false;

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

  freecam.update(frameDt);
  if (LINEUP) updateLineupLabels();

  if (GRADE_OFF) {
    renderer.render(scene, camera);
  } else {
    grade.render(renderer, scene, camera, nowMs / 1000);
  }

  if (!statsLogged && nowMs > 4000) {
    statsLogged = true;
    const r = renderer.info.render;
    console.log(`[stats] triangles=${r.triangles} drawCalls=${r.calls}`);
  }
});
