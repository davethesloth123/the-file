// Playable Zamostye: WASD walks Andrei through the district (Shift to
// hurry), trailing camera per bible §10 (V cycles presets, drag to look),
// three buildings can be entered and climbed. Ambient cast walks the
// streets. Review helpers:
//   ?grade=off            ungraded
//   ?lineup               labelled archetype lineup on plain ground
//   ?cam=x,y,z,tx,ty,tz   fixed camera pose (screenshots)
//   C                     free-fly inspection camera
// Simulation advances at a fixed 60Hz; rendering interpolates.
import * as THREE from 'three';
import { FixedClock } from './core/clock';
import { createRenderer } from './render/renderer';
import { GradePass } from './render/grade';
import { FreeCam } from './render/freecam';
import { TrailingCamera } from './render/camera';
import { worldMaterial } from './render/worldmat';
import { createBench } from './ui/bench';
import { Actor, loadArchetype } from './actors/actor';
import { PlayerState } from './actors/player';
import { buildLevel } from './world/level';
import { CollisionWorld } from './world/collision';

const QUERY = new URLSearchParams(location.search);
const GRADE_OFF = QUERY.get('grade') === 'off';
const LINEUP = QUERY.has('lineup');
const CAM_PIN = QUERY.get('cam');

const renderer = createRenderer();
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb3a992);
scene.fog = new THREE.Fog(0xb3a992, 52, 180);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 400);
if (LINEUP) {
  camera.position.set(0, 1.5, 6.2);
  camera.lookAt(0, 1.0, 0);
}
if (CAM_PIN) {
  const [x, y, z, tx, ty, tz] = CAM_PIN.split(',').map(Number);
  camera.position.set(x ?? 0, y ?? 5, z ?? 10);
  camera.lookAt(tx ?? 0, ty ?? 1, tz ?? 0);
}

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

// --------------------------------------------------------------- input
const keys = new Set<string>();
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
const held = (k: string): number => (keys.has(k) ? 1 : 0);

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

function stepWalkers(dt: number): void {
  for (const w of walkers) {
    if (!w.route.length) continue;
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

// -------------------------------------------------------------- player
let world = new CollisionWorld([], []);
let player: PlayerState | null = null;
let playerActor: Actor | null = null;
const trailing = new TrailingCamera(camera, renderer.domElement);

async function startPlay(): Promise<void> {
  const level = buildLevel(scene);
  world = new CollisionWorld(level.walls, level.surfaces);
  // ?pos=x,z[,y] — dev spawn override for testing interiors
  const posParam = QUERY.get('pos');
  let spawn = level.spawns['player'] ?? ([0, 0] as [number, number]);
  let spawnY = 0;
  if (posParam) {
    const [x, z, y] = posParam.split(',').map(Number);
    spawn = [x ?? 0, z ?? 0];
    spawnY = y ?? 0;
  }
  player = new PlayerState(spawn);
  player.y = player.py = spawnY;
  (window as unknown as { __player?: PlayerState }).__player = player;
  (window as unknown as { __world?: CollisionWorld }).__world = world;
  const asset = await loadArchetype('player');
  playerActor = new Actor(asset, { coat: asset.coats[0]! });
  scene.add(playerActor.group);
  void spawnCityCast();
}

if (LINEUP) void spawnLineup();
else void startPlay();

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

  const alpha = clock.tick(nowMs, (dt) => {
    stepWalkers(dt);
    if (player && !freecam.enabled) {
      player.step(dt, {
        forward: held('w') - held('s'),
        strafe: held('d') - held('a'),
        hurrying: keys.has('shift'),
      }, trailing.yaw + Math.PI, world);
    }
  });

  for (const w of walkers) {
    if (!w.route.length) continue;
    w.actor.group.position.set(
      w.px + (w.x - w.px) * alpha, 0, w.pz + (w.z - w.pz) * alpha,
    );
    const dyaw = ((w.yaw - w.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    w.actor.group.rotation.y = w.pyaw + dyaw * alpha;
    w.actor.update(w.speed, frameDt);
  }

  if (player && playerActor) {
    const ix = player.px + (player.x - player.px) * alpha;
    const iy = player.py + (player.y - player.py) * alpha;
    const iz = player.pz + (player.z - player.pz) * alpha;
    const dyaw = ((player.yaw - player.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    playerActor.group.position.set(ix, iy, iz);
    playerActor.group.rotation.y = player.pyaw + dyaw * alpha;
    playerActor.update(player.moving ? player.speed : 0, frameDt);

    if (!freecam.enabled && !CAM_PIN && !LINEUP) {
      trailing.update(frameDt, {
        x: ix, y: iy, z: iz,
        yaw: player.yaw,
        forwardHeld: held('w') > 0,
        jogging: player.hurrying && player.moving,
      }, world);
    }
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
