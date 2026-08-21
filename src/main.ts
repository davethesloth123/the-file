// Playable Zamostye: WASD walks Andrei through the district (Shift to
// hurry), trailing camera per bible §10 (V cycles presets, drag to look),
// three buildings can be entered and climbed. Ambient cast walks the
// streets. Review helpers:
//   ?grade=off            ungraded
//   ?lineup               labelled archetype lineup on plain ground
//   ?cam=x,y,z,tx,ty,tz   fixed camera pose (screenshots)
//   ?drive=f,s,h,sec;...  deterministic real-controller review sequence
//   ?driveWorld             keep scripted drive axes world-aligned
//   C                     free-fly inspection camera
// Simulation advances at a fixed 60Hz; rendering interpolates.
import * as THREE from 'three';
import { FixedClock } from './core/clock';
import { createRenderer } from './render/renderer';
import { GradePass } from './render/grade';
import { FreeCam } from './render/freecam';
import { TrailingCamera } from './render/camera';
import { updateWorldMaterials, worldMaterial } from './render/worldmat';
import { createAtmosphere } from './render/atmosphere';
import { readRenderStats, type SceneRenderStats } from './render/diagnostics';
import { FrameProfiler } from './render/performance';
import { createBench } from './ui/bench';
import { Actor, type ArchetypeAsset } from './actors/actor';
import { buildLevel } from './world/level';
import { CollisionWorld } from './world/collision';
import { createHud, type Hud } from './ui/hud';
import { Patrol } from './actors/patrol';
import { RoutineAgent } from './actors/routine';
import { InteractionSystem, within, PROMPT_RADIUS, REACH_RADIUS } from './systems/interaction';
import {
  PRICES, courierPay, clerkAvailable, stationAvailable, type Address,
} from './systems/economy';
import { CONE_RANGE, CONE_FOV } from './systems/observation';
import { Radio } from './ui/radio';
import { str } from './core/strings';
import { AudioBus } from './core/audio';
import audioJson from './data/audio.json';
import tuning from './data/tuning.json';
import { loadGameContent, type GameContent } from './data/content';
import { GameSession, type RestrictedZone } from './game/session';
import { DriveSequence, parseDriveStages } from './game/dev-drive';
import { loadArchetypes, requireArchetype } from './game/bootstrap';
import { createLoadingScreen } from './ui/loading';
import { ConversationController } from './game/conversation';
import type { DialogueDefinition, DialogueEnvironment } from './systems/dialogue';
import { createDialogueUi, type DialogueUi } from './ui/dialogue';
import { CivilianAwareness, type CivilianReactionState } from './actors/civilian-awareness';
import { canSee } from './systems/observation';
import {
  WorldInteractionRuntime,
  type WorldInteractionDefinition,
} from './systems/world-interaction';

const QUERY = new URLSearchParams(location.search);
const GRADE_OFF = QUERY.get('grade') === 'off';
const LINEUP = QUERY.has('lineup');
const CAM_PIN = QUERY.get('cam');
const DEV_DRIVE = new DriveSequence(parseDriveStages(QUERY.get('drive')));
const DEV_DRIVE_WORLD = QUERY.has('driveWorld');
const DEV_DIALOGUE = QUERY.get('dialogue');
const DEV_DIALOGUE_DELAY = Math.max(0, Number(QUERY.get('dialogueDelay')) || 0);
const DEV_ACT_SECONDS = Math.max(0, Number(QUERY.get('act')) || 0);
const DEV_STAGE = QUERY.get('stage');

const renderer = createRenderer();
document.body.appendChild(renderer.domElement);
const driveTelemetry = QUERY.has('drive') ? document.createElement('output') : null;
if (driveTelemetry) {
  driveTelemetry.dataset.testid = 'drive-telemetry';
  driveTelemetry.style.cssText = 'position:fixed;left:8px;top:8px;z-index:10000;color:#fff;background:#000a;padding:4px;font:12px monospace';
  document.body.appendChild(driveTelemetry);
}
const reactionTelemetry = QUERY.has('reactions') ? document.createElement('output') : null;
if (reactionTelemetry) {
  reactionTelemetry.dataset.testid = 'reaction-telemetry';
  reactionTelemetry.style.cssText = 'position:fixed;left:8px;top:38px;z-index:10000;color:#ded2b8;background:#000a;padding:4px;font:12px monospace;white-space:pre';
  document.body.appendChild(reactionTelemetry);
}
const performanceTelemetry = QUERY.has('perf') ? document.createElement('output') : null;
if (performanceTelemetry) {
  performanceTelemetry.dataset.testid = 'performance-telemetry';
  performanceTelemetry.style.cssText = 'position:fixed;right:8px;top:8px;z-index:10000;color:#ded2b8;background:#000a;padding:4px;font:12px monospace';
  document.body.appendChild(performanceTelemetry);
}
const headTelemetry = QUERY.has('headcheck') ? document.createElement('output') : null;
if (headTelemetry) {
  headTelemetry.dataset.testid = 'head-telemetry';
  headTelemetry.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:10000;color:#ded2b8;background:#000a;padding:4px;font:12px monospace';
  document.body.appendChild(headTelemetry);
}
let headLastYaw: number | null = null;
let headMaxAbsYaw = 0;
let headMaxStep = 0;
let headTravel = 0;

const ATM = tuning.atmosphere;
const scene = new THREE.Scene();
scene.background = new THREE.Color(ATM.skyColor);
scene.fog = new THREE.Fog(ATM.fogColor, ATM.fogNear, ATM.fogFar);

// near 0.25 keeps depth precision for the ink pass; the camera pull-in
// floor is 0.4 so nothing legal ever crosses the near plane
const camera = new THREE.PerspectiveCamera(56, 1, 0.25, 400);
if (LINEUP) {
  camera.position.set(0, 1.5, 6.2);
  camera.lookAt(0, 1.0, 0);
}
if (CAM_PIN) {
  const [x, y, z, tx, ty, tz] = CAM_PIN.split(',').map(Number);
  camera.position.set(x ?? 0, y ?? 5, z ?? 10);
  camera.lookAt(tx ?? 0, ty ?? 1, tz ?? 0);
}

const atmosphere = createAtmosphere(scene, ATM);

const grade = new GradePass();
createBench(grade);

function resize(): void {
  // 1.5× keeps the ink/material pass crisp on high-density displays while
  // avoiding the 4× fill-rate cost of an uncapped 2× browser canvas.
  const dpr = Math.min(devicePixelRatio, tuning.performance.maxPixelRatio);
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
let lastPlayerInput = { forward: 0, strafe: 0, hurrying: false };

interface Walker {
  id: string;
  actor: Actor;
  routine: RoutineAgent | null;
  awareness: CivilianAwareness | null;
  reaction: CivilianReactionState;
  speed: number;
  x: number; z: number; yaw: number;
  px: number; pz: number; pyaw: number;
}

const walkers: Walker[] = [];

function awarenessSeed(id: string): number {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  return (value >>> 0) / 0xffffffff;
}

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

  const names = [
    'militia', 'civilian_worker', 'civilian_m', 'civilian_young_m',
    'civilian_f', 'civilian_f_uncovered', 'civilian_old', 'player',
  ];
  const assets = await loadArchetypes(names);
  for (let i = 0; i < names.length; i++) {
    const asset = requireArchetype(assets, names[i]!);
    const actor = new Actor(asset, { coat: asset.coats[0]! });
    actor.group.position.set((i - (names.length - 1) / 2) * 1.25, 0, 0);
    actor.group.rotation.y = 0.5;
    scene.add(actor.group);
    walkers.push({
      id: `lineup_${names[i]!}`, actor, routine: null, speed: asset.naturalSpeeds['walk'] ?? 0,
      awareness: null, reaction: 'routine',
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

function spawnCityCast(
  cast: GameContent['map']['ambientCast'],
  assets: ReadonlyMap<string, ArchetypeAsset>,
): void {
  for (const entry of cast) {
    const asset = requireArchetype(assets, entry.archetype);
    const actor = new Actor(asset, {
      coat: asset.coats[entry.coatIndex % asset.coats.length]!,
      height: entry.height,
    });
    scene.add(actor.group);
    const routine = new RoutineAgent(
      entry.route.map((pos, index) => ({
        pos,
        waitSeconds: entry.waits?.[index] ?? 0,
      })),
      entry.startIndex,
      entry.speed ?? asset.naturalSpeeds['walk'] ?? 1,
    );
    walkers.push({
      id: entry.id, actor,
      routine,
      awareness: new CivilianAwareness(awarenessSeed(entry.id)), reaction: 'routine',
      speed: routine.currentSpeed,
      x: routine.x,
      z: routine.z,
      yaw: routine.yaw,
      px: routine.px,
      pz: routine.pz,
      pyaw: routine.pyaw,
    });
  }
}

function stepWalkers(dt: number): void {
  for (const w of walkers) {
    if (!w.routine) continue;
    w.routine.step(dt, world);
    w.px = w.routine.px;
    w.pz = w.routine.pz;
    w.pyaw = w.routine.pyaw;
    w.x = w.routine.x;
    w.z = w.routine.z;
    w.yaw = w.routine.yaw;
    w.speed = w.routine.currentSpeed;
  }
}

function stepCivilianReactions(dt: number): void {
  if (!session) return;
  const player = session.player;
  for (const walker of walkers) {
    if (!walker.awareness || conversation?.npcId === walker.id) continue;
    const dx = player.x - walker.x;
    const dz = player.z - walker.z;
    const distance = Math.hypot(dx, dz);
    const reaction = walker.awareness.step(dt, {
      seesPlayer: distance < tuning.performance.awarenessRayDistance
        && canSee(walker, player.x, player.z, world),
      unusualConduct: session.lastConduct !== null,
      distance,
      playerX: player.x,
      playerZ: player.z,
      playerMoving: player.moving,
      npcMoving: walker.speed > 0.2,
    });
    walker.reaction = reaction.state;

    if (reaction.lookWeight > 0) {
      const targetYaw = Math.atan2(dx, dz);
      const relativeYaw = ((targetYaw - walker.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      walker.actor.setLookOffset(relativeYaw, 0, reaction.lookWeight);
    } else {
      walker.actor.clearLookOffset();
    }

    if (reaction.turnBody && !walker.routine) {
      const targetYaw = Math.atan2(dx, dz);
      const turn = ((targetYaw - walker.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      walker.yaw += THREE.MathUtils.clamp(
        turn,
        -tuning.npcRoutine.turnRate * dt,
        tuning.npcRoutine.turnRate * dt,
      );
      walker.actor.group.rotation.y = walker.yaw;
    }

    if (reaction.stepAside && walker.routine && distance > 0.01) {
      const amount = tuning.civilianAwareness.stepAsideAmount;
      walker.routine.interrupt('yielding', tuning.civilianAwareness.stepAsideSeconds, [
        walker.x - (dx / distance) * amount,
        walker.z - (dz / distance) * amount,
      ]);
    }

    if (reaction.report) {
      session.social.adjustSuspicion(walker.id, tuning.civilianAwareness.reportSuspicion);
      const nearest = patrolUnits.reduce<PatrolUnit | null>((best, unit) => {
        if (!best) return unit;
        const bestDistance = Math.hypot(best.patrol.x - walker.x, best.patrol.z - walker.z);
        const unitDistance = Math.hypot(unit.patrol.x - walker.x, unit.patrol.z - walker.z);
        return unitDistance < bestDistance ? unit : best;
      }, null);
      nearest?.patrol.investigate(
        walker.x,
        walker.z,
        tuning.civilianAwareness.reportPatrolSeconds,
      );
      say('speaker.handler', 'social.civilian.report', undefined, true);
    }
  }
}

// -------------------------------------------------------------- player
let world = new CollisionWorld([], []);
let dynamicDoors: Record<string, THREE.Object3D> = {};
let session: GameSession | null = null;
let playerActor: Actor | null = null;
const trailing = new TrailingCamera(camera, renderer.domElement);

// ---------------------------------------------- conduct, patrols, file
interface PatrolUnit { patrol: Patrol; actor: Actor; fan: THREE.Mesh }
const patrolUnits: PatrolUnit[] = [];
let radio: Radio | null = null;
let hud: Hud | null = null;
let dialogueUi: DialogueUi | null = null;
let conversation: ConversationController | null = null;
let devDialogueDefinition: DialogueDefinition | null = null;
let devDialogueStarted = false;
let restrictedZones: RestrictedZone[] = [];

// place markers: paper for the player's objectives, red ONLY on the
// militia station — state authority is the one thing allowed to be red
function makeMarker(color: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.1 * scale, 1.45 * scale, 28),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.055, 2.2, 6),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35 }),
  );
  post.position.y = 1.1;
  g.add(ring, post);
  g.visible = false;
  scene.add(g);
  return g;
}
let objectiveMarker: THREE.Group | null = null;

// ---------------------------------------------------- economy, the doors
let divCharges = 0;
let boughtIntel = false;
let veraAlive = true;
let veraBriefed = false;
let courierCount = 0;
let parcel: (Address & { pay: number }) | null = null;
let parcelMarker: THREE.Group | null = null;
let veraActor: Actor | null = null;
const worldInteractions = new InteractionSystem<GameSession>();
const worldInteractionRuntime = new WorldInteractionRuntime();
const ambientRadio: { speaker: string; text: string; cold: boolean }[] = [];
let spots: {
  fence: [number, number]; clerk: [number, number];
  station: [number, number]; vera: [number, number];
} | null = null;

function say(speakerKey: string, textKey: string, vars?: Record<string, string | number>, cold = false): void {
  ambientRadio.push({ speaker: str(speakerKey), text: str(textKey, vars), cold });
}

function configureWorldInteractions(
  dialogues: readonly DialogueDefinition[],
  objects: readonly WorldInteractionDefinition[],
): void {
  worldInteractions.clear();
  for (const definition of dialogues) {
    const participant = (): Walker | undefined => walkers.find((walker) => walker.id === definition.npcId);
    worldInteractions.register({
      id: `talk_${definition.npcId}`,
      verb: 'talk',
      position: () => {
        const walker = participant();
        return walker ? [walker.x, walker.z] : [9999, 9999];
      },
      radius: PROMPT_RADIUS,
      priority: 20,
      label: str(definition.prompt),
      visible: (run) => run.mission.status === 'running' && !(conversation?.active ?? false),
      enabled: () => participant() !== undefined,
      onTrigger: () => beginDialogue(definition),
    });
  }
  for (const definition of objects) {
    const environment = (run: GameSession): DialogueEnvironment => worldEnvironment(run);
    worldInteractions.register({
      id: `world_${definition.id}`,
      verb: definition.verb,
      position: definition.pos,
      ...(definition.radius === undefined ? {} : { radius: definition.radius }),
      ...(definition.holdSeconds === undefined ? {} : { holdSeconds: definition.holdSeconds }),
      priority: definition.id === 'records_staff_door' ? 30 : 10,
      label: (run) => str(
        !worldInteractionRuntime.enabled(definition, environment(run)) && definition.disabledLabel
          ? definition.disabledLabel
          : definition.label,
      ),
      visible: (run) => run.mission.status === 'running'
        && !(conversation?.active ?? false)
        && worldInteractionRuntime.visible(definition, environment(run)),
      enabled: (run) => worldInteractionRuntime.enabled(definition, environment(run)),
      onTrigger: (run) => {
        const result = worldInteractionRuntime.activate(definition, environment(run));
        if (result) hud?.notify(
          str(`feedback.verb.${definition.verb}`),
          str(result.text),
          definition.enabledWhen ? 'good' : 'neutral',
        );
      },
    });
  }
}

function worldEnvironment(run: GameSession): DialogueEnvironment {
  return {
    npcId: 'world', role: 'environment', location: 'ordinary_traffic', activity: 'available',
    flag: (name) => run.mission.flags[name],
    setFlag: (name, value) => { run.mission.flags[name] = value; },
    suspicion: () => run.social.suspicion('world'),
    adjustSuspicion: (amount) => {
      run.social.adjustSuspicion('world', amount);
      notifySuspicion(amount);
    },
    chose: (dialogueId, responseId) => run.social.chose(dialogueId, responseId),
    rememberChoice: (dialogueId, responseId) => run.social.rememberChoice(dialogueId, responseId),
    routeUnlocked: (id) => run.social.routes.has(id),
    unlockRoute: (id) => { run.social.routes.add(id); },
    knows: (id) => run.social.facts.has(id),
    addFact: (id) => { run.social.facts.add(id); },
    objectiveStatus: (id) => {
      const state = run.mission.objectiveState(id);
      return state.discovered && state.status === 'locked' ? 'discovered' : state.status;
    },
    discoverObjective: (id) => { run.mission.discoverObjective(id); },
    addTag: (id) => { run.mission.tags.add(id); },
    action: runWorldAction,
  };
}

function runWorldAction(id: string): void {
  if (id === 'slow_patrols') runDialogueAction(id);
  else if (id === 'open_records_staff_door') {
    world.setWallEnabled('records_staff_door', false);
    const door = dynamicDoors.records_staff_door;
    if (door) door.rotation.y = -Math.PI / 2;
  }
}

function dialogueEnvironment(definition: DialogueDefinition, run: GameSession): DialogueEnvironment {
  return {
    npcId: definition.npcId,
    role: definition.role,
    location: definition.location,
    activity: definition.activity,
    flag: (name) => run.mission.flags[name],
    setFlag: (name, value) => { run.mission.flags[name] = value; },
    suspicion: () => run.social.suspicion(definition.npcId),
    adjustSuspicion: (amount) => {
      run.social.adjustSuspicion(definition.npcId, amount);
      notifySuspicion(amount);
    },
    chose: (dialogueId, responseId) => run.social.chose(dialogueId, responseId),
    rememberChoice: (dialogueId, responseId) => run.social.rememberChoice(dialogueId, responseId),
    routeUnlocked: (id) => run.social.routes.has(id),
    unlockRoute: (id) => { run.social.routes.add(id); },
    knows: (id) => run.social.facts.has(id),
    addFact: (id) => { run.social.facts.add(id); },
    objectiveStatus: (id) => {
      const state = run.mission.objectiveState(id);
      return state.discovered && state.status === 'locked' ? 'discovered' : state.status;
    },
    discoverObjective: (id) => { run.mission.discoverObjective(id); },
    addTag: (id) => { run.mission.tags.add(id); },
    action: runDialogueAction,
  };
}

function notifySuspicion(amount: number): void {
  if (!hud || amount === 0) return;
  hud.notify(
    str('feedback.reaction'),
    str(amount < 0
      ? 'feedback.suspicion.falls'
      : amount >= 12 ? 'feedback.suspicion.rises_sharply' : 'feedback.suspicion.rises'),
    amount > 0 ? 'warning' : 'good',
  );
}

function runDialogueAction(id: string): void {
  if (id === 'take_courier') takeCourier();
  else if (id === 'pay_clerk') payClerk();
  else if (id === 'inform_station') informAtStation();
  else if (id === 'slow_patrols') {
    veraBriefed = true;
    for (const unit of patrolUnits) unit.patrol.speedFactor = PRICES.vera.patrolSlow;
  }
}

function beginDialogue(definition: DialogueDefinition): void {
  if (!session || !playerActor || !conversation) return;
  const participant = walkers.find((walker) => walker.id === definition.npcId);
  if (!participant) return;
  conversation.start(
    definition,
    dialogueEnvironment(definition, session),
    participant,
    session,
    playerActor,
  );
}

function takeCourier(): void {
  const a = PRICES.courier.addresses[courierCount % PRICES.courier.addresses.length]! as Address;
  parcel = { pos: a.pos, label: a.label, pay: courierPay(courierCount) };
  courierCount++;
  if (session) session.mission.flags['parcel'] = true;
  if (!parcelMarker) parcelMarker = makeMarker(0xa8905e);
  parcelMarker.position.set(a.pos[0], world.groundHeight(a.pos[0], a.pos[1], 0.3), a.pos[1]);
  parcelMarker.visible = true;
  say('speaker.grigori', 'grigori.courier_take', { place: a.label });
}

function deliverParcel(): void {
  if (!parcel || !session) return;
  session.wallet.earn(parcel.pay);
  say('speaker.you', 'you.delivered', { pay: parcel.pay });
  session.mission.flags['parcel'] = false;
  if (parcelMarker) parcelMarker.visible = false;
  parcel = null;
}

function payClerk(): void {
  if (!session?.wallet.pay(PRICES.clerk.price)) return;
  session.file.transact(PRICES.clerk.fileCut);
  say('speaker.clerk', 'clerk.paid');
}

function informAtStation(): void {
  if (!session) return;
  if (veraAlive) {
    session.file.transact(PRICES.station.inform.fileCut);
    session.confidence.spend(PRICES.station.inform.confidenceCost);
    veraAlive = false;
    if (veraActor) {
      scene.remove(veraActor.group);
      const i = walkers.findIndex((w) => w.actor === veraActor);
      if (i >= 0) walkers.splice(i, 1);
      veraActor = null;
    }
    for (const u of patrolUnits) u.patrol.speedFactor = 1;
    say('speaker.handler', 'handler.informed_vera', undefined, true);
  } else {
    session.file.transact(PRICES.station.debrief.fileCut);
    session.confidence.spend(PRICES.station.debrief.confidenceCost);
    say('speaker.handler', 'handler.debrief', undefined, true);
  }
}

function throwDiversion(): void {
  if (divCharges <= 0 || !session) return;
  const player = session.player;
  divCharges--;
  const tx = player.x + Math.sin(player.yaw) * PRICES.diversion.throwDistance;
  const tz = player.z + Math.cos(player.yaw) * PRICES.diversion.throwDistance;
  let heard = false;
  for (const u of patrolUnits) {
    if (Math.hypot(u.patrol.x - tx, u.patrol.z - tz) < PRICES.diversion.hearRadius) {
      u.patrol.investigate(tx, tz, PRICES.diversion.probeSeconds);
      heard = true;
    }
  }
  say('speaker.you', heard ? 'you.diversion_hit' : 'you.diversion_miss');
}

function stepAmbient(dt: number, actHeld: boolean): void {
  if (!session || session.mission.status !== 'running' || !spots) {
    worldInteractions.cancel();
    return;
  }
  const player = session.player;
  const px = player.x, pz = player.z;
  if (parcel && within(px, pz, parcel.pos[0], parcel.pos[1], PRICES.courier.deliverRadius)) {
    deliverParcel();
  }
  worldInteractions.step(px, pz, actHeld, dt, session);
}

const audio = new AudioBus();

// -------------------------------------------------- playtest instrument
// Time from level start until the player FIRST walks through a patrol
// cone without changing speed (BUILD-PROMPTS session 7). A crossing is a
// maximal run of observed ticks; it qualifies when the player was calmly
// walking (moving, not hurrying, no conduct) throughout it AND for
// leadSeconds before it. Under three minutes = the design works.
let metricSimTime = 0;
let metricCalmFor = 0;
let metricWindow = false;
let metricWindowCalm = false;
let metricDone = false;

function metricTick(dt: number, observed: boolean, calm: boolean): void {
  metricSimTime += dt;
  metricCalmFor = calm ? metricCalmFor + dt : 0;
  if (observed) {
    if (!metricWindow) {
      metricWindow = true;
      metricWindowCalm = metricCalmFor >= tuning.playtest.leadSeconds;
    }
    metricWindowCalm &&= calm;
  } else if (metricWindow) {
    metricWindow = false;
    if (metricWindowCalm && !metricDone) {
      metricDone = true;
      const t = metricSimTime.toFixed(1);
      console.log(`[playtest] first calm cone crossing at ${t}s`);
      try { localStorage.setItem('thefile.firstCalmCross', t); } catch { /* private mode */ }
    }
  }
}

function formatDebrief(run: GameSession): string[] {
  const debrief = run.mission.debrief();
  const routeNames: Record<string, string> = {
    courtyard_service_gate: 'debrief.route.courtyard',
    records_staff_door: 'debrief.route.records',
    bakery_yard: 'debrief.route.bakery',
    motorpool_service_entry: 'debrief.route.motorpool',
    tram_workers_gate: 'debrief.route.tram',
    boiler_delivery_cover: 'debrief.route.boiler',
  };
  const lines = [
    `<b>${str('debrief.method')}</b> · ${str(
      run.file.value < 12 ? 'debrief.file.clean'
        : run.file.value < 45 ? 'debrief.file.noticed' : 'debrief.file.exposed',
    )}`,
  ];
  const routes = [...run.social.routes]
    .map((route) => routeNames[route])
    .filter((key): key is string => !!key)
    .map((key) => str(key));
  if (routes.length) lines.push(`<b>${str('debrief.routes')}</b> · ${routes.join(' · ')}`);
  const optionalCount = debrief.completed.filter((id) => (
    run.mission.def.objectives.find((objective) => objective.id === id)?.optional
  )).length;
  if (optionalCount) lines.push(
    `<b>${str('debrief.discoveries')}</b> · ${optionalCount} ${str('debrief.optional_completed')}`,
  );
  if (run.social.choices.size) lines.push(
    `<b>${str('debrief.contacts')}</b> · ${run.social.choices.size} ${str('debrief.responses_remembered')}`,
  );
  return lines;
}

const FAN_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0xc0201f,
  transparent: true,
  opacity: 0.12,
  side: THREE.DoubleSide,
  depthWrite: false,
});

function spawnPatrols(
  routes: { route: [number, number][] }[],
  asset: ArchetypeAsset,
): void {
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

async function startPlay(content: GameContent): Promise<void> {
  const level = buildLevel(scene, content.map);
  world = new CollisionWorld(level.walls, level.surfaces, level.cameraObstacles);
  dynamicDoors = level.dynamicDoors;
  hud = createHud();
  radio = new Radio(document.body);
  dialogueUi = createDialogueUi(document.body);
  conversation = new ConversationController((view) => {
    if (!dialogueUi) return;
    if (!view) dialogueUi.hide();
    else dialogueUi.show(
      view,
      str,
      (responseId) => conversation?.choose(responseId),
      () => conversation?.end(),
    );
  });
  objectiveMarker = makeMarker(0xded2b8);
  // the doors stand open from hour one (bible §7.5) — fixed place markers
  spots = level.interactions;
  for (const [pos, color] of [
    [spots.fence, 0xa8905e], [spots.clerk, 0x9d9784], [spots.station, 0xc0201f],
  ] as [pos: [number, number], color: number][]) {
    const m = makeMarker(color, 0.9);
    m.position.set(pos[0], world.groundHeight(pos[0], pos[1], 0.3), pos[1]);
    m.visible = true;
  }
  restrictedZones = level.restricted.map((r) => ({ pos: r.pos, r: r.r, label: r.label }));

  // ?pos=x,z[,y] — dev spawn override for testing interiors
  const posParam = QUERY.get('pos');
  let spawn = level.spawns['player'] ?? ([0, 0] as [number, number]);
  let spawnY = 0;
  if (posParam) {
    const [x, z, y] = posParam.split(',').map(Number);
    spawn = [x ?? 0, z ?? 0];
    spawnY = y ?? 0;
  }
  const run = new GameSession(world, spawn, content.mission);
  run.player.y = run.player.py = spawnY;
  for (const route of QUERY.getAll('route')) run.social.routes.add(route);
  if (DEV_STAGE === 'exit') {
    const collect = content.mission.objectives.find((objective) => objective.id === 'collect');
    const check = collect?.checks[0];
    if (check?.pos) {
      for (let i = 0; i < 180; i++) {
        run.mission.step(1 / 60, check.pos[0], check.pos[1], true, { file: 0, confidence: 100 });
      }
    }
  }

  const archetypeNames = [
    'player', 'militia',
    ...level.ambientCast.map((actor) => actor.archetype),
    ...level.staticActors.map((actor) => actor.archetype),
    ...level.npcs.map((actor) => actor.archetype),
  ];
  const assets = await loadArchetypes(archetypeNames);

  // Named story actors and interaction roles are authored in map data.
  for (const entry of level.staticActors) {
    const asset = requireArchetype(assets, entry.archetype);
    const actor = new Actor(asset, {
      coat: asset.coats[entry.coatIndex % asset.coats.length]!,
      ...(entry.height === undefined ? {} : { height: entry.height }),
    });
    actor.group.position.set(entry.pos[0], 0, entry.pos[1]);
    actor.group.rotation.y = THREE.MathUtils.degToRad(entry.yawDeg);
    scene.add(actor.group);
    walkers.push({
      id: entry.id, actor, routine: null, speed: 0,
      awareness: new CivilianAwareness(awarenessSeed(entry.id)), reaction: 'routine',
      x: entry.pos[0], z: entry.pos[1], yaw: actor.group.rotation.y,
      px: entry.pos[0], pz: entry.pos[1], pyaw: actor.group.rotation.y,
    });
    if (entry.id === 'vera') veraActor = actor;
  }

  spawnPatrols(level.patrols, requireArchetype(assets, 'militia'));

  // Interior NPCs: shopkeepers, the clerk, the duty officer, the mechanic.
  for (const entry of level.npcs) {
    const asset = requireArchetype(assets, entry.archetype);
    const actor = new Actor(asset, {
      coat: asset.coats[(entry.coatIndex ?? 0) % asset.coats.length]!,
    });
    actor.group.position.set(entry.pos[0], entry.y, entry.pos[1]);
    actor.group.rotation.y = THREE.MathUtils.degToRad(entry.yawDeg);
    scene.add(actor.group);
    walkers.push({
      id: entry.id, actor, routine: null, speed: 0,
      awareness: new CivilianAwareness(awarenessSeed(entry.id)), reaction: 'routine',
      x: entry.pos[0], z: entry.pos[1], yaw: actor.group.rotation.y,
      px: entry.pos[0], pz: entry.pos[1], pyaw: actor.group.rotation.y,
    });
  }

  const playerAsset = requireArchetype(assets, 'player');
  playerActor = new Actor(playerAsset, { coat: playerAsset.coats[0]! });
  scene.add(playerActor.group);
  spawnCityCast(level.ambientCast, assets);

  // Publish the complete run only after every essential actor is ready.
  session = run;
  configureWorldInteractions(content.dialogues, content.worldInteractions);
  Object.assign(window, {
    __session: run,
    __player: run.player,
    __world: world,
    __mission: run.mission,
    __file: run.file,
    __confidence: run.confidence,
    __social: run.social,
    __conversation: conversation,
    __walkers: walkers,
    __worldInteractionRuntime: worldInteractionRuntime,
  });
  (window as unknown as { __econ?: unknown }).__econ = {
    wallet: run.wallet,
    get divCharges() { return divCharges; },
    get boughtIntel() { return boughtIntel; },
    get veraAlive() { return veraAlive; },
    get veraBriefed() { return veraBriefed; },
    get parcel() { return parcel; },
    patrols: patrolUnits,
  };
  if (DEV_DIALOGUE) {
    devDialogueDefinition = content.dialogues.find((item) => item.id === DEV_DIALOGUE) ?? null;
    if (devDialogueDefinition && DEV_DIALOGUE_DELAY === 0) {
      devDialogueStarted = true;
      beginDialogue(devDialogueDefinition);
    }
  }
}

const loading = createLoadingScreen();
let bootstrapReady = false;
async function bootstrap(): Promise<void> {
  try {
    if (LINEUP) await spawnLineup();
    else await startPlay(loadGameContent());
    bootstrapReady = true;
    loading.ready();
  } catch (error) {
    console.error('[bootstrap] failed to open the district', error);
    loading.fail();
  }
}
void bootstrap();

const freecam = new FreeCam(camera, renderer.domElement);
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') {
    if (freecam.enabled) freecam.disable();
    else freecam.enable();
  }
});

// economy one-shot keys: G throws a diversion; 1/2 buy from Grigori
addEventListener('keydown', (e) => {
  if (!session || session.mission.status !== 'running') return;
  if (conversation?.active) return;
  const player = session.player;
  const k = e.key.toLowerCase();
  if (k === 'g') throwDiversion();
  if ((k === '1' || k === '2') && spots
    && within(player.x, player.z, spots.fence[0], spots.fence[1], PRICES.fence.radius)) {
    if (k === '1' && session.wallet.pay(PRICES.diversion.price)) {
      divCharges++;
      say('speaker.grigori', 'grigori.diversion_bought');
    }
    if (k === '2' && !boughtIntel && session.wallet.pay(PRICES.intel.price)) {
      boughtIntel = true;
      say('speaker.grigori', 'grigori.intel_bought');
    }
  }
});

const clock = new FixedClock();
let lastFrameMs: number | null = null;
let statsLogged = false;
let sceneStats: SceneRenderStats | null = null;
const frameProfiler = new FrameProfiler();
let performanceLogged = false;

renderer.setAnimationLoop((nowMs: number) => {
  updateWorldMaterials(nowMs / 1000);
  const frameDt = lastFrameMs === null ? 0 : Math.min((nowMs - lastFrameMs) / 1000, 0.25);
  lastFrameMs = nowMs;
  if (bootstrapReady) frameProfiler.sample(frameDt * 1000);
  const run = session;

  const alpha = clock.tick(nowMs, (dt) => {
    stepWalkers(dt);
    if (run) {
      const driven = DEV_DRIVE.sample(dt);
      lastPlayerInput = freecam.enabled ? {
        forward: 0, strafe: 0, hurrying: false,
      } : driven ?? {
        forward: held('w') - held('s'),
        strafe: held('d') - held('a'),
        hurrying: shiftHeld,
      };
      run.stepPlayer(
        dt,
        lastPlayerInput,
        DEV_DRIVE_WORLD && driven ? 0 : trailing.yaw + Math.PI,
      );
      const actHeld = !conversation?.active
        && (keys.has('e') || keys.has('f') || metricSimTime < DEV_ACT_SECONDS);
      run.stepMission(dt, actHeld);
      stepAmbient(dt, actHeld);
      conversation?.step(dt);
      if (devDialogueDefinition && !devDialogueStarted && metricSimTime >= DEV_DIALOGUE_DELAY) {
        devDialogueStarted = true;
        beginDialogue(devDialogueDefinition);
      }
      const surveillance = run.stepSurveillance(
        dt, patrolUnits.map((unit) => unit.patrol), restrictedZones,
      );
      stepCivilianReactions(dt);
      metricTick(dt, surveillance.observed, surveillance.calm);
    }
  });

  for (const w of walkers) {
    if (w.routine) {
      w.actor.group.position.set(
        w.px + (w.x - w.px) * alpha, 0, w.pz + (w.z - w.pz) * alpha,
      );
      const dyaw = ((w.yaw - w.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      w.actor.group.rotation.y = w.pyaw + dyaw * alpha;
    }
    // routeless walkers (interior NPCs, the lineup) still animate
    w.actor.update(w.speed, frameDt);
  }

  if (run && playerActor) {
    const player = run.player;
    const ix = player.px + (player.x - player.px) * alpha;
    const iy = player.py + (player.y - player.py) * alpha;
    const iz = player.pz + (player.z - player.pz) * alpha;
    atmosphere.focus(ix, iz);
    const dyaw = ((player.yaw - player.pyaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    playerActor.group.position.set(ix, iy, iz);
    playerActor.group.rotation.y = player.pyaw + dyaw * alpha;
    playerActor.locomotion.forced = run.mission.activeConductId() ? 'crouch' : null;
    playerActor.update(
      player.moving ? player.speed : 0,
      frameDt,
      player.yawRate,
      player.acceleration,
    );
    if (headTelemetry) {
      const pose = playerActor.headRotation();
      if (pose) {
        const yaw = pose[1];
        if (headLastYaw !== null) {
          const step = Math.abs(((yaw - headLastYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          headMaxStep = Math.max(headMaxStep, step);
          headTravel += step;
        }
        headLastYaw = yaw;
        headMaxAbsYaw = Math.max(headMaxAbsYaw, Math.abs(yaw));
        headTelemetry.textContent = `state=${conversation?.active ? 'conversation' : player.moving ? 'moving' : 'idle'} yaw=${THREE.MathUtils.radToDeg(yaw).toFixed(1)}° max=${THREE.MathUtils.radToDeg(headMaxAbsYaw).toFixed(1)}° step=${THREE.MathUtils.radToDeg(headMaxStep).toFixed(1)}° travel=${THREE.MathUtils.radToDeg(headTravel).toFixed(1)}° t=${metricSimTime.toFixed(1)}s`;
      }
    }
    if (driveTelemetry) {
      const driveStatus = DEV_DRIVE.status();
      const cameraStatus = trailing.debugState();
      const cameraHit = world.lastRayHit;
      driveTelemetry.textContent = [
        `x=${player.x.toFixed(2)}`,
        `y=${player.y.toFixed(2)}`,
        `z=${player.z.toFixed(2)}`,
        `speed=${player.speed.toFixed(2)}`,
        `stairs=${player.onStairs ? 1 : 0}`,
        `drive=${driveStatus.index}:${driveStatus.elapsed.toFixed(2)}`,
        `cam=${camera.position.x.toFixed(2)},${camera.position.y.toFixed(2)},${camera.position.z.toFixed(2)}`,
        `camera=${cameraStatus.clear.toFixed(2)}/${cameraStatus.distance.toFixed(2)}/${cameraStatus.desired.toFixed(2)}`,
        `avoid=${cameraStatus.yaw.toFixed(2)},${cameraStatus.pitch.toFixed(2)}`,
        `preferred=${cameraStatus.preferredYaw.toFixed(2)},${cameraStatus.preferredClearance.toFixed(2)}`,
        `hit=${cameraHit ? `${cameraHit.x.toFixed(1)},${cameraHit.y0.toFixed(1)},${cameraHit.z.toFixed(1)},${cameraHit.y1.toFixed(1)}` : 'none'}`,
        ...(QUERY.has('walls') ? world.walls
          .filter((wall) => wall.enabled !== false
            && Math.abs(wall.x - player.x) < wall.hw + 1.2
            && Math.abs(wall.z - player.z) < wall.hd + 1.2)
          .slice(0, 8)
          .map((wall) => `wall=${wall.id ?? '-'}@${wall.x.toFixed(1)},${wall.z.toFixed(1)}±${wall.hw.toFixed(1)},${wall.hd.toFixed(1)}`) : []),
      ].join(' ');
    }
    audio.step(
      playerActor.locomotion.phase(),
      player.hurrying,
      player.y > audioJson.footsteps.woodAboveY,
    );

    if (!freecam.enabled && !CAM_PIN && !LINEUP) {
      trailing.update(frameDt, {
        x: ix, y: iy, z: iz,
        yaw: player.yaw,
        forwardHeld: lastPlayerInput.forward > 0,
        speed: player.speed,
        vx: player.vx,
        vz: player.vz,
        onStairs: player.onStairs,
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
    u.actor.update(p.currentSpeed, frameDt, dyaw * 60);
    u.fan.position.set(ix, world.groundHeight(ix, iz, 0.3) + 0.08, iz);
    u.fan.rotation.z = -iyaw;
    // intel gates cone VISIBILITY only: at no tier does the detection cone
    // move, turn, or shrink (pillar III). Withheld, never wrong.
    // bought intel bypasses the confidence gate (bible §5.5: permanent)
    const intel = run?.confidence.intel() ?? 'none';
    u.fan.visible = boughtIntel || intel !== 'none';
    (u.fan.material as THREE.MeshBasicMaterial).opacity = (boughtIntel || intel === 'full')
      ? tuning.cones.fullBase + p.alert * tuning.cones.fullAlert
      : tuning.cones.partialBase + p.alert * tuning.cones.partialAlert;
  }
  if (hud && run) {
    hud.tick(frameDt);
    hud.setConduct(run.lastConduct?.label ?? null, run.lastObservers);
    hud.setFilePages(Math.round(run.file.value), run.file.tierLabel().toUpperCase());
    hud.setConfidence(
      run.confidence.value,
      str(`confidence.note.${run.confidence.intel()}`),
    );
  }
  if (reactionTelemetry && run) {
    reactionTelemetry.textContent = walkers
      .map((walker) => ({
        walker,
        distance: Math.hypot(walker.x - run.player.x, walker.z - run.player.z),
      }))
      .filter(({ walker, distance }) => walker.awareness && distance < 9)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5)
      .map(({ walker, distance }) => (
        `${walker.id}: ${walker.reaction}/${walker.routine?.interruptionReason ?? 'routine'} ${distance.toFixed(1)}m @${walker.x.toFixed(1)},${walker.z.toFixed(1)}`
      ))
      .join('\n');
  }
  if (hud && radio && run) {
    const { player, mission, file, confidence, wallet } = run;
    for (const key of mission.radioQueue.splice(0)) {
      radio.show(str('speaker.handler'), str(key));
    }
    for (const event of mission.eventQueue.splice(0)) {
      hud.notify(
        str(`feedback.objective.${event.type}${event.optional ? '.optional' : ''}`),
        str(event.label),
        event.type === 'failed' ? 'warning' : 'good',
      );
    }
    for (const msg of ambientRadio.splice(0)) {
      radio.show(msg.speaker, msg.text, msg.cold);
    }
    radio.tick(frameDt);

    // exactly one prompt on screen: the mission's ask first, then a door
    let prompt: { label: string; progress: number; sub: string | null; key: string | null } | null = null;
    const meters = { file: file.value, confidence: confidence.value };
    const objective = mission.active;
    if (objective) {
      const check = mission.focusCheck(objective, player.x, player.z);
      const revealed = mission.revealed(objective, meters);
      const exactMarker = objective.marker !== 'none';
      hud.setObjective(
        str(objective.label),
        !revealed
          ? str('objective.withheld').toUpperCase()
          : exactMarker && check?.pos
            ? `${Math.round(Math.hypot(player.x - check.pos[0], player.z - check.pos[1]))} M`
            : null,
      );
      if (objectiveMarker) {
        objectiveMarker.visible = revealed && exactMarker && !!check?.pos;
        if (check?.pos) {
          objectiveMarker.position.set(
            check.pos[0],
            world.groundHeight(check.pos[0], check.pos[1], 0.3),
            check.pos[1],
          );
          objectiveMarker.scale.setScalar(1 + Math.sin(nowMs / 400) * 0.08);
        }
      }
      const holdType = check?.type === 'hold_at' || check?.type === 'talk_to';
      const near = check?.pos
        ? within(player.x, player.z, check.pos[0], check.pos[1], check.radius ?? REACH_RADIUS)
        : false;
      if (holdType && near) {
        const progress = mission.holdProgress();
        prompt = {
          label: progress > 0
            ? `${str('prompt.servicing')}… ${Math.round(progress * 100)}%`
            : str(check?.prompt ?? objective.label),
          progress,
          sub: progress > 0 && check?.conduct ? str('prompt.servicing.sub') : null,
          key: 'E',
        };
      }
    } else {
      hud.setObjective(null, null);
      if (objectiveMarker) objectiveMarker.visible = false;
    }

    if (!prompt && mission.status === 'running' && !conversation?.active) {
      const interaction = worldInteractions.view;
      if (interaction) {
        prompt = {
          label: interaction.progress > 0
            ? `${interaction.label}… ${Math.round(interaction.progress * 100)}%`
            : interaction.label,
          progress: interaction.progress,
          sub: interaction.sub,
          key: interaction.key,
        };
      }
    }
    if (conversation?.active) prompt = null;
    hud.setPrompt(
      prompt?.label ?? null, prompt?.progress ?? 0, prompt?.sub ?? null,
      prompt ? prompt.key : 'E',
    );

    hud.setMoney(wallet.value);
    const tier = confidence.intel();
    const patternState = boughtIntel ? str('kit.pattern.bought')
      : tier === 'full' ? str('kit.pattern.full')
        : tier === 'partial' ? str('kit.pattern.partial') : str('kit.pattern.none');
    hud.setKit([
      ...(parcel
        ? [{ text: str('carrying.parcel', { place: parcel.label, pay: parcel.pay }), dim: false }]
        : []),
      { text: `${str('kit.diversion')} ×${divCharges}`, dim: divCharges === 0 },
      { text: `${str('kit.pattern')} — ${patternState}`, dim: !boughtIntel && tier === 'none' },
      {
        text: `${str('kit.exfil')} — ${tier !== 'none' ? str('kit.exfil.marked') : str('kit.exfil.none')}`,
        dim: tier === 'none',
      },
    ]);
    if (parcelMarker?.visible) parcelMarker.scale.setScalar(1 + Math.sin(nowMs / 400) * 0.08);

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
        ` · confidence <b>${Math.round(confidence.value)}</b> · ₽<b>${Math.round(wallet.value)}</b>` +
        `<br>${verdict}${veraAlive ? '' : `<br><br>${str('ending.clear.vera_gone')}`}` +
        `<br><br>${formatDebrief(run).join('<br>')}`,
        '#ded2b8', str('ending.again'),
      );
    }
  }

  freecam.update(frameDt);
  if (LINEUP) updateLineupLabels();

  if (GRADE_OFF) {
    renderer.info.reset();
    renderer.render(scene, camera);
    sceneStats = readRenderStats(renderer);
  } else {
    sceneStats = grade.render(renderer, scene, camera, nowMs / 1000);
  }

  if (!statsLogged && bootstrapReady && nowMs > 4000 && sceneStats) {
    statsLogged = true;
    console.log(`[stats] triangles=${sceneStats.triangles} drawCalls=${sceneStats.calls}`);
  }
  if (!performanceLogged && bootstrapReady
    && frameProfiler.count >= tuning.performance.profileFrames && sceneStats) {
    const summary = frameProfiler.summary();
    if (summary) {
      performanceLogged = true;
      const report = `fps=${summary.approximateFps.toFixed(1)} avg=${summary.averageMs.toFixed(2)}ms p95=${summary.p95Ms.toFixed(2)}ms p99=${summary.p99Ms.toFixed(2)}ms slow=${summary.framesOverBudget}/${summary.samples} triangles=${sceneStats.triangles} calls=${sceneStats.calls}`;
      console.log(`[performance] ${report}`);
      if (performanceTelemetry) performanceTelemetry.textContent = report;
    }
  }
});
