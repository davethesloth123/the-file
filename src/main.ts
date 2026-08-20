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
import { createHud, type Hud } from './ui/hud';
import { Patrol } from './actors/patrol';
import { evaluateConduct, type ActiveConduct } from './systems/conduct';
import { FileMeter } from './systems/file';
import { ConfidenceMeter } from './systems/confidence';
import { MissionRunner, type MissionDef } from './systems/mission';
import { within, REACH_RADIUS } from './systems/interaction';
import { CONE_RANGE, CONE_FOV } from './systems/observation';
import { Radio } from './ui/radio';
import { str } from './core/strings';
import tuning from './data/tuning.json';
import ordinaryTraffic from './data/missions/ordinary_traffic.json';

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
// Shift is tracked via the modifier flag on every key event — more robust
// than matching the 'Shift' key itself across browsers and focus changes.
const keys = new Set<string>();
let shiftHeld = false;
addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  shiftHeld = e.shiftKey;
});
addEventListener('keyup', (e) => {
  keys.delete(e.key.toLowerCase());
  shiftHeld = e.shiftKey;
});
addEventListener('blur', () => {
  keys.clear();
  shiftHeld = false;
});
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

const CITY_CAST: [archetype: string, route: Route, startIndex: number, speed: number | null, height: number, coatIndex: number][] = [
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

// ---------------------------------------------- conduct, patrols, file
interface PatrolUnit { patrol: Patrol; actor: Actor; fan: THREE.Mesh }
const patrolUnits: PatrolUnit[] = [];
const file = new FileMeter();
const confidence = new ConfidenceMeter();
let mission: MissionRunner | null = null;
let radio: Radio | null = null;
let hud: Hud | null = null;
let stillSeconds = 0;
let restrictedZones: { pos: [number, number]; r: number; label: string }[] = [];
let lastConduct: ActiveConduct | null = null;
let lastObservers = 0;

// objective marker: paper ring and post, never red (red is the state's)
function makeMarker(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.1, 1.45, 28),
    new THREE.MeshBasicMaterial({
      color: 0xded2b8, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 2.2, 6),
    new THREE.MeshBasicMaterial({ color: 0xded2b8, transparent: true, opacity: 0.35 }),
  );
  post.position.y = 1.1;
  g.add(ring, post);
  g.visible = false;
  scene.add(g);
  return g;
}
let objectiveMarker: THREE.Group | null = null;

const FAN_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xc0201f,
  transparent: true,
  opacity: 0.12,
  side: THREE.DoubleSide,
  depthWrite: false,
});

async function spawnPatrols(routes: { route: [number, number][] }[]): Promise<void> {
  const asset = await loadArchetype('militia');
  for (const r of routes) {
    const patrol = new Patrol(r.route, asset.naturalSpeeds['walk'] ?? 1);
    const actor = new Actor(asset, {});
    scene.add(actor.group);
    // the fan is built from the SAME tuning values and the SAME pose the
    // detection cone uses — pillar III lives here
    const fan = new THREE.Mesh(
      new THREE.CircleGeometry(CONE_RANGE, 26, -CONE_FOV / 2, CONE_FOV),
      FAN_MATERIAL.clone(),
    );
    fan.rotation.x = -Math.PI / 2;
    scene.add(fan);
    patrolUnits.push({ patrol, actor, fan });
  }
}

async function startPlay(): Promise<void> {
  const level = buildLevel(scene);
  world = new CollisionWorld(level.walls, level.surfaces);
  hud = createHud();
  radio = new Radio(document.body);
  mission = new MissionRunner(ordinaryTraffic as unknown as MissionDef);
  objectiveMarker = makeMarker();
  restrictedZones = level.restricted.map((r) => ({ pos: r.pos, r: r.r, label: r.label }));
  void spawnPatrols(level.patrols);
  // interior NPCs: shopkeepers, the clerk, the duty officer, the mechanic
  void (async () => {
    for (const n of level.npcs) {
      const asset = await loadArchetype(n.archetype);
      const actor = new Actor(asset, { coat: asset.coats[(n.coatIndex ?? 0) % asset.coats.length]! });
      actor.group.position.set(n.pos[0], n.y, n.pos[1]);
      actor.group.rotation.y = (n.yawDeg * Math.PI) / 180;
      scene.add(actor.group);
      walkers.push({
        actor, route: [], target: 0, speed: 0,
        x: n.pos[0], z: n.pos[1], yaw: 0, px: n.pos[0], pz: n.pos[1], pyaw: 0,
      });
    }
  })();
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
  (window as unknown as { __mission?: MissionRunner }).__mission = mission;
  (window as unknown as { __file?: FileMeter }).__file = file;
  (window as unknown as { __confidence?: ConfidenceMeter }).__confidence = confidence;
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
      // a hold in progress roots Andrei to the spot — you cannot service a
      // drop while walking away from it
      const locked = mission !== null && mission.activeConductId() !== null;
      player.step(dt, {
        forward: locked ? 0 : held('w') - held('s'),
        strafe: locked ? 0 : held('d') - held('a'),
        hurrying: shiftHeld && !locked,
      }, trailing.yaw + Math.PI, world);
    }
    if (player) {
      mission?.step(dt, player.x, player.z, keys.has('f'), {
        file: file.value, confidence: confidence.value,
      });
      // conduct: what is Andrei doing, and can anyone see it
      stillSeconds = player.moving ? 0 : stillSeconds + dt;
      let restrictedLabel: string | null = null;
      for (const zone of restrictedZones) {
        if (Math.hypot(player.x - zone.pos[0], player.z - zone.pos[1]) < zone.r) {
          restrictedLabel = zone.label;
          break;
        }
      }
      const running = mission === null || mission.status === 'running';
      const conduct = running ? evaluateConduct({
        servicing: mission?.activeConductId() === 'service',
        talkingToFlagged: false,
        afterCurfew: false,
        restrictedLabel,
        hurrying: player.hurrying,
        moving: player.moving,
        stillSeconds,
        atBench: false,
        offDistrict: false,
      }) : null;
      let observers = 0;
      for (const u of patrolUnits) {
        if (u.patrol.step(dt, player.x, player.z, conduct !== null, world)) observers++;
      }
      file.accrue(conduct, observers, mission?.multiplier() ?? 1, dt);
      confidence.tick(conduct !== null && observers > 0, dt);
      lastConduct = conduct;
      lastObservers = observers;
    }
  });

  for (const w of walkers) {
    if (w.route.length) {
      w.actor.group.position.set(
        w.px + (w.x - w.px) * alpha, 0, w.pz + (w.z - w.pz) * alpha,
      );
      const dyaw = ((w.yaw - w.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      w.actor.group.rotation.y = w.pyaw + dyaw * alpha;
    }
    // routeless walkers (interior NPCs, the lineup) still animate
    w.actor.update(w.speed, frameDt);
  }

  if (player && playerActor) {
    const ix = player.px + (player.x - player.px) * alpha;
    const iy = player.py + (player.y - player.py) * alpha;
    const iz = player.pz + (player.z - player.pz) * alpha;
    const dyaw = ((player.yaw - player.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    playerActor.group.position.set(ix, iy, iz);
    playerActor.group.rotation.y = player.pyaw + dyaw * alpha;
    playerActor.locomotion.forced = mission?.activeConductId() ? 'crouch' : null;
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

  for (const u of patrolUnits) {
    const p = u.patrol;
    const ix = p.px + (p.x - p.px) * alpha;
    const iz = p.pz + (p.z - p.pz) * alpha;
    const dyaw = ((p.yaw - p.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const iyaw = p.pyaw + dyaw * alpha;
    u.actor.group.position.set(ix, world.groundHeight(ix, iz, 0.3), iz);
    u.actor.group.rotation.y = iyaw;
    u.actor.update(p.currentSpeed, frameDt);
    u.fan.position.set(ix, world.groundHeight(ix, iz, 0.3) + 0.08, iz);
    u.fan.rotation.z = -iyaw;
    // intel gates cone VISIBILITY only: at no tier does the detection cone
    // move, turn, or shrink (pillar III). Withheld, never wrong.
    const intel = confidence.intel();
    u.fan.visible = intel !== 'none';
    (u.fan.material as THREE.MeshBasicMaterial).opacity = intel === 'full'
      ? tuning.cones.fullBase + p.alert * tuning.cones.fullAlert
      : tuning.cones.partialBase + p.alert * tuning.cones.partialAlert;
  }
  if (hud) {
    hud.setConduct(lastConduct?.label ?? null, lastObservers);
    hud.setFilePages(Math.round(file.value), file.tierLabel().toUpperCase());
    hud.setConfidence(confidence.value, str(`confidence.note.${confidence.intel()}`));
  }
  if (hud && radio && mission && player) {
    for (const key of mission.radioQueue.splice(0)) {
      radio.show(str('speaker.handler'), str(key));
    }
    radio.tick(frameDt);

    const meters = { file: file.value, confidence: confidence.value };
    const objective = mission.active;
    if (objective) {
      const [ox, oz] = objective.pos ?? [0, 0];
      const revealed = mission.revealed(objective, meters);
      hud.setObjective(
        objective.label,
        revealed
          ? `${Math.round(Math.hypot(player.x - ox, player.z - oz))} M`
          : str('objective.withheld').toUpperCase(),
      );
      if (objectiveMarker) {
        objectiveMarker.visible = revealed;
        objectiveMarker.position.set(ox, world.groundHeight(ox, oz, 0.3), oz);
        objectiveMarker.scale.setScalar(1 + Math.sin(nowMs / 400) * 0.08);
      }
      // the prompt: only hold objectives ask for a key
      const holdType = objective.type === 'hold_at' || objective.type === 'talk_to';
      const near = within(player.x, player.z, ox, oz, objective.radius ?? REACH_RADIUS);
      if (holdType && near) {
        const progress = mission.holdProgress();
        hud.setPrompt(
          progress > 0
            ? `${str('prompt.servicing')}… ${Math.round(progress * 100)}%`
            : objective.prompt ?? objective.label,
          progress,
          progress > 0 && objective.conduct ? str('prompt.servicing.sub') : null,
        );
      } else {
        hud.setPrompt(null, 0, null);
      }
    } else {
      hud.setObjective(null, null);
      hud.setPrompt(null, 0, null);
      if (objectiveMarker) objectiveMarker.visible = false;
    }

    if (mission.status === 'failed') {
      hud.showEnd(
        str('ending.burned.title'), str('ending.burned.body'),
        '#b8322c', str('ending.again'),
      );
    } else if (mission.status === 'complete') {
      const intel = confidence.intel();
      const verdict = intel === 'full'
        ? str('ending.clear.confidence_high')
        : intel === 'partial'
          ? str('ending.clear.confidence_mid')
          : str('ending.clear.confidence_low');
      hud.showEnd(
        str('ending.clear.title'),
        `${str('ending.clear.body')}<br><br>File closed at <b>${Math.round(file.value)}</b>` +
        ` · confidence <b>${Math.round(confidence.value)}</b><br>${verdict}`,
        '#ded2b8', str('ending.again'),
      );
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
