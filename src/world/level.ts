// Assembles Zamostye from src/data/map.zamostye.json and the facade kit.
// Buildings are generated — window grids with sills, shopfronts, entrances,
// cornices, string courses, balconies, drainpipes, chimneys and antennas —
// with seeded per-building variation, optional wings (L-shaped masses) and
// small yaws, so the district reads as grown rather than planned. Everything
// merges into one mesh per material; outline shells are merged oversize
// boxes drawn BackSide. Colliders and gameplay volumes come from the JSON,
// never from mesh names.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import mapJson from '../data/map.zamostye.json';
import { worldMaterial, toonColor } from '../render/worldmat';

export interface BoxCollider { x: number; z: number; hw: number; hd: number }

interface WingDef { dx: number; dz: number; w: number; d: number; floorsDelta: number }

interface BuildingDef {
  id: string;
  pos: [number, number];
  size: [number, number];
  floors: number;
  style: string;
  seed: number;
  yawDeg?: number;
  wings?: WingDef[];
  stateLintel?: boolean;
  chimney?: boolean;
}

interface MapData {
  ground: { size: [number, number]; material: string };
  pavements: { pos: [number, number]; size: [number, number] }[];
  buildings: BuildingDef[];
  garages: { pos: [number, number]; size: [number, number]; yawDeg: number }[];
  walls: { from: [number, number]; to: [number, number]; h: number }[];
  cars: { pos: [number, number]; yawDeg: number; color: string }[];
  plaza: { pos: [number, number]; r: number; material: string };
  monument: { pos: [number, number]; plinth: [number, number, number]; banner: [number, number, number] };
  tram: { x: number; railGap: number; from: number; to: number; wireHeight: number };
  lamps: { xs: number[]; from: number; to: number; step: number };
  manholes: [number, number][];
  trees: [number, number][];
  benches: { pos: [number, number]; yawDeg: number }[];
  kiosks: { pos: [number, number]; yawDeg: number }[];
  bins: [number, number][];
  boards: { pos: [number, number]; yawDeg: number }[];
  colliders: { type: string; pos: [number, number]; size: [number, number] }[];
  restricted: { id: string; pos: [number, number]; r: number; label: string }[];
  waypoints: Record<string, [number, number]>;
  spawns: Record<string, [number, number]>;
}

export interface LevelData {
  colliders: BoxCollider[];
  occluders: THREE.Object3D[];
  waypoints: Record<string, [number, number]>;
  spawns: Record<string, [number, number]>;
  restricted: { id: string; pos: [number, number]; r: number; label: string }[];
}

// Deterministic variation; Math.random would change the city every load.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const OUTLINE_T = 0.08;
const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x231d15, side: THREE.BackSide });

class KitBag {
  private buckets = new Map<string, THREE.BufferGeometry[]>();
  private shells: THREE.BufferGeometry[] = [];

  add(material: string, geo: THREE.BufferGeometry): void {
    let list = this.buckets.get(material);
    if (!list) this.buckets.set(material, (list = []));
    list.push(geo);
  }

  box(
    material: string,
    w: number, h: number, d: number,
    x: number, y: number, z: number,
    ry = 0, outline = false,
  ): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.add(material, g);
    if (outline) {
      const s = new THREE.BoxGeometry(w + OUTLINE_T, h + OUTLINE_T, d + OUTLINE_T);
      if (ry) s.rotateY(ry);
      s.translate(x, y, z);
      this.shells.push(s);
    }
  }

  cylinder(
    material: string,
    rTop: number, rBot: number, h: number, seg: number,
    x: number, y: number, z: number,
    rz = 0,
  ): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, z);
    this.add(material, g);
  }

  build(scene: THREE.Scene, occluders: THREE.Object3D[]): void {
    for (const [name, list] of this.buckets) {
      const merged = mergeGeometries(list);
      const material = name.startsWith('#') ? toonColor(name) : worldMaterial(name);
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = mesh.receiveShadow = true;
      scene.add(mesh);
      occluders.push(mesh);
      for (const g of list) g.dispose();
    }
    if (this.shells.length) {
      const shell = new THREE.Mesh(mergeGeometries(this.shells), OUTLINE_MATERIAL);
      scene.add(shell);
      for (const g of this.shells) g.dispose();
    }
  }
}

const FLOOR_H = 2.6;
const GROUND_FLOOR_H = 3.2;

function building(bag: KitBag, b: BuildingDef, colliders: BoxCollider[]): void {
  const rand = mulberry32(b.seed);
  const yaw = ((b.yawDeg ?? 0) * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  // building-local (lx, lz) → world, rotated about the building centre
  const wx = (lx: number, lz: number): number => b.pos[0] + lx * cy + lz * sy;
  const wz = (lx: number, lz: number): number => b.pos[1] - lx * sy + lz * cy;
  const put = (
    material: string,
    w: number, h: number, d: number,
    lx: number, ly: number, lz: number,
    outline = false,
  ): void => bag.box(material, w, h, d, wx(lx, lz), ly, wz(lx, lz), yaw, outline);

  // Per-building character: window proportions and which dressings appear.
  const winScale = 0.85 + rand() * 0.35;
  const hasStringCourse = rand() < 0.5;

  const mass = (
    ox: number, oz: number, w: number, d: number, floors: number, isMain: boolean,
  ): void => {
    const h = GROUND_FLOOR_H + floors * FLOOR_H;
    put(b.style, w, h, d, ox, h / 2, oz, true);
    put('roof', w * 1.03, 0.5, d * 1.03, ox, h + 0.25, oz);
    put('trim', w + 0.24, 0.3, d + 0.24, ox, h - 0.35, oz);
    if (hasStringCourse) put('trim', w + 0.16, 0.16, d + 0.16, ox, GROUND_FLOOR_H, oz);

    // Entrance faces the nearest street (toward the origin, dominant axis).
    const entranceAxis = Math.abs(b.pos[0]) > Math.abs(b.pos[1]) ? 'x' : 'z';
    const entranceSign = entranceAxis === 'x' ? -Math.sign(b.pos[0]) : -Math.sign(b.pos[1]);

    const facades: { axis: 'x' | 'z'; sign: number; len: number }[] = [
      { axis: 'z', sign: 1, len: w }, { axis: 'z', sign: -1, len: w },
      { axis: 'x', sign: 1, len: d }, { axis: 'x', sign: -1, len: d },
    ];

    for (const f of facades) {
      const half = (f.axis === 'x' ? w : d) / 2;
      const nx = Math.floor((f.len - 2.4) / 2.2);
      const x0 = -((nx - 1) * 2.2) / 2;
      const isEntrance = isMain && f.axis === entranceAxis && f.sign === entranceSign;
      const doorSlot = isEntrance ? Math.floor(rand() * nx) : -1;
      const balconyFloor = 1 + Math.floor(rand() * Math.max(1, floors - 1));

      const place = (
        along: number, y: number, bw: number, bh: number, depth: number, mat: string, extraOut = 0,
      ): void => {
        if (f.axis === 'z') put(mat, bw, bh, depth, ox + along, y, oz + f.sign * (half + extraOut));
        else put(mat, depth, bh, bw, ox + f.sign * (half + extraOut), y, oz + along);
      };

      for (let i = 0; i < nx; i++) {
        const along = x0 + i * 2.2;
        if (i === doorSlot) {
          place(along, 1.25, 1.5, 2.5, 0.3, 'trim');
          if (b.stateLintel) place(along, 2.75, 2.2, 0.5, 0.34, 'state_red');
          place(along, 0.12, 2.4, 0.24, 1.6, 'concrete_stone');
        } else if (rand() < 0.3) {
          place(along, 1.55, 1.7, 1.7, 0.14, 'trim');
        } else if (rand() < 0.25) {
          place(along, 0.42, 1.1, 0.55, 0.14, 'trim'); // cellar window
        }
        for (let fl = 1; fl <= floors; fl++) {
          if (rand() < 0.06) continue;
          const y = GROUND_FLOOR_H + (fl - 0.5) * FLOOR_H;
          place(along, y, 1.0 * winScale, 1.5 * winScale, 0.14, 'trim');
          place(along, y - 0.78 * winScale, 1.2 * winScale, 0.08, 0.1, 'concrete_stone', 0.06);
          if (fl === balconyFloor && rand() < 0.3) {
            place(along, y - 0.85, 1.7, 0.12, 0.85, 'concrete_stone', 0.42);
            place(along, y - 0.45, 1.7, 0.7, 0.06, 'trim', 0.82);
          }
        }
      }
    }

    // roof furniture: chimney stacks and a TV antenna or two
    const nChimneys = 1 + Math.floor(rand() * 2);
    for (let c = 0; c < nChimneys; c++) {
      const lx = ox + (rand() - 0.5) * (w - 3);
      const lz = oz + (rand() - 0.5) * (d - 3);
      const ch = 1.2 + rand() * 1.2;
      put('brick_rust', 0.75, ch, 0.75, lx, h + ch / 2, lz);
    }
    if (rand() < 0.65) {
      const lx = ox + (rand() - 0.5) * (w - 4);
      const lz = oz + (rand() - 0.5) * (d - 4);
      put('trim', 0.05, 2.2, 0.05, lx, h + 1.1, lz);
      put('trim', 1.1, 0.04, 0.04, lx, h + 1.9, lz);
    }

    // collider (padded AABB when the building is yawed)
    const pad = Math.abs(sy) * (w + d) * 0.5 * 0.5;
    colliders.push({
      x: wx(ox, oz), z: wz(ox, oz),
      hw: w / 2 + pad, hd: d / 2 + pad,
    });
  };

  mass(0, 0, b.size[0], b.size[1], b.floors, true);
  for (const wing of b.wings ?? []) {
    mass(wing.dx, wing.dz, wing.w, wing.d, Math.max(1, b.floors + wing.floorsDelta), false);
  }

  // drainpipes (done here so they use building-local coords cleanly)
  const dp = mulberry32(b.seed ^ 0xbeef);
  const [w0, d0] = b.size;
  for (const [lx, lz] of [
    [w0 / 2 + 0.1, d0 / 2 - 0.5], [-w0 / 2 - 0.1, -d0 / 2 + 0.5],
    [w0 / 2 - 0.5, -d0 / 2 - 0.1], [-w0 / 2 + 0.5, d0 / 2 + 0.1],
  ] as [number, number][]) {
    if (dp() < 0.7) {
      const h = GROUND_FLOOR_H + b.floors * FLOOR_H - 0.5;
      bag.cylinder('rust_metal', 0.06, 0.07, h, 6, wx(lx, lz), h / 2, wz(lx, lz));
    }
  }

  if (b.chimney) {
    const lx = b.size[0] / 2 - 1.6, lz = -b.size[1] / 2 + 1.6;
    bag.cylinder('brick_rust', 0.8, 1.05, 16, 10, wx(lx, lz), 8, wz(lx, lz));
  }
}

function furniture(bag: KitBag, map: MapData, colliders: BoxCollider[]): void {
  // lamps: jittered spacing, slight lean — municipal, not military
  const L = map.lamps;
  let lampIndex = 0;
  for (const x of L.xs) {
    for (let z = L.from; z <= L.to; z += L.step) {
      const rand = mulberry32(7000 + lampIndex++);
      const jz = z + (rand() - 0.5) * 5;
      const lean = (rand() - 0.5) * 0.05;
      bag.cylinder('trim', 0.12, 0.16, 7, 6, x, 3.5, jz, lean);
      bag.box('trim', 0.9, 0.35, 0.5, x + lean * 7, 7.1, jz);
    }
  }
  // tram rails and overhead wire
  const T = map.tram;
  const len = T.to - T.from;
  const zc = (T.to + T.from) / 2;
  for (const s of [-1, 1]) {
    bag.box('trim', 0.07, 0.06, len, T.x + (s * T.railGap) / 2, 0.03, zc);
    bag.box('trim', 0.03, 0.03, len, T.x + (s * T.railGap) / 2, T.wireHeight, zc);
  }
  for (let z = L.from; z <= L.to; z += L.step) {
    bag.box('trim', 27, 0.025, 0.025, 0, T.wireHeight + 0.35, z);
  }
  // manhole covers on the boulevard and roads
  for (const [x, z] of map.manholes) {
    const y = Math.abs(x) <= 13 ? 0.24 : 0.03;
    bag.cylinder('trim', 0.5, 0.5, 0.04, 12, x, y, z);
  }
  // trees: bare October — jittered positions, trunk lean, branch slivers
  for (let i = 0; i < map.trees.length; i++) {
    const rand = mulberry32(9000 + i);
    const x = map.trees[i]![0] + (rand() - 0.5) * 3;
    const z = map.trees[i]![1] + (rand() - 0.5) * 3;
    const th = 3.4 + rand() * 2.0;
    bag.cylinder('bark', 0.09, 0.15, th, 5, x, th / 2, z, (rand() - 0.5) * 0.08);
    const nb = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < nb; k++) {
      const a = rand() * Math.PI * 2;
      const tilt = 0.5 + rand() * 0.6;
      const bl = 1.2 + rand() * 1.3;
      const g = new THREE.BoxGeometry(0.05, bl, 0.05);
      g.translate(0, bl / 2, 0);
      g.rotateZ(tilt);
      g.rotateY(a);
      g.translate(x, th - 0.4 - rand() * 0.8, z);
      bag.add('bark', g);
    }
  }
  // benches
  for (const bn of map.benches) {
    const ry = (bn.yawDeg * Math.PI) / 180;
    bag.box('roof', 1.8, 0.07, 0.5, bn.pos[0], 0.45, bn.pos[1], ry);
    bag.box('roof', 1.8, 0.45, 0.06, bn.pos[0] + Math.sin(ry) * 0.24, 0.75, bn.pos[1] + Math.cos(ry) * 0.24, ry);
    bag.box('trim', 1.6, 0.42, 0.42, bn.pos[0], 0.21, bn.pos[1], ry);
  }
  // kiosks
  for (const k of map.kiosks) {
    const ry = (k.yawDeg * Math.PI) / 180;
    bag.box('render_sage', 2.4, 2.5, 2.0, k.pos[0], 1.25, k.pos[1], ry, true);
    bag.box('roof', 2.8, 0.18, 2.4, k.pos[0], 2.6, k.pos[1], ry);
    bag.box('trim', 1.6, 0.8, 0.1, k.pos[0] - Math.sin(ry) * 1.01, 1.5, k.pos[1] - Math.cos(ry) * 1.01, ry);
    colliders.push({ x: k.pos[0], z: k.pos[1], hw: 1.3, hd: 1.1 });
  }
  // bins and notice boards
  for (const [x, z] of map.bins) bag.cylinder('rust_metal', 0.26, 0.24, 0.75, 8, x, 0.38, z);
  for (const bd of map.boards) {
    const ry = (bd.yawDeg * Math.PI) / 180;
    for (const s of [-0.7, 0.7]) {
      bag.box('trim', 0.08, 2.0, 0.08, bd.pos[0] + Math.cos(ry) * s, 1.0, bd.pos[1] - Math.sin(ry) * s, ry);
    }
    bag.box('render_bone', 1.7, 1.1, 0.06, bd.pos[0], 1.55, bd.pos[1], ry);
  }
  // garages: single-storey brick rows with door strips
  for (const g of map.garages) {
    const ry = (g.yawDeg * Math.PI) / 180;
    const [gw, gd] = g.size;
    bag.box('brick_rust', gw, 2.7, gd, g.pos[0], 1.35, g.pos[1], ry, true);
    bag.box('roof', gw + 0.3, 0.16, gd + 0.3, g.pos[0], 2.78, g.pos[1], ry);
    const nDoors = Math.floor(gw / 3.4);
    for (let i = 0; i < nDoors; i++) {
      const along = -((nDoors - 1) * 3.4) / 2 + i * 3.4;
      const dx = along * Math.cos(ry) - (gd / 2 + 0.03) * Math.sin(ry);
      const dz = -along * Math.sin(ry) - (gd / 2 + 0.03) * Math.cos(ry);
      bag.box('rust_metal', 2.6, 2.1, 0.08, g.pos[0] + dx, 1.15, g.pos[1] + dz, ry);
    }
    colliders.push({ x: g.pos[0], z: g.pos[1], hw: gw / 2 + 0.5, hd: gd / 2 + 0.5 });
  }
  // courtyard walls
  for (const wl of map.walls) {
    const dx = wl.to[0] - wl.from[0], dz = wl.to[1] - wl.from[1];
    const len = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz);
    const cx = (wl.from[0] + wl.to[0]) / 2, cz = (wl.from[1] + wl.to[1]) / 2;
    bag.box('brick_rust', 0.35, wl.h, len, cx, wl.h / 2, cz, ry);
    bag.box('concrete_stone', 0.45, 0.12, len + 0.1, cx, wl.h + 0.06, cz, ry);
    colliders.push({ x: cx, z: cz, hw: Math.abs(dx) / 2 + 0.3, hd: Math.abs(dz) / 2 + 0.3 });
  }
  // parked cars: boxy Soviet saloons, body colour from the JSON
  for (const car of map.cars) {
    const ry = (car.yawDeg * Math.PI) / 180;
    const [x, z] = car.pos;
    bag.box(car.color, 1.65, 0.55, 4.1, x, 0.62, z, ry);
    bag.box(car.color, 1.5, 0.5, 2.0, x - Math.sin(ry) * 0.15, 1.12, z - Math.cos(ry) * 0.15, ry);
    for (const [sx, sz] of [[-0.78, 1.3], [0.78, 1.3], [-0.78, -1.3], [0.78, -1.3]]) {
      const wxp = x + sx! * Math.cos(ry) + sz! * Math.sin(ry);
      const wzp = z - sx! * Math.sin(ry) + sz! * Math.cos(ry);
      bag.cylinder('trim', 0.3, 0.3, 0.22, 8, wxp, 0.3, wzp, Math.PI / 2);
    }
    colliders.push({ x, z, hw: 1.2, hd: 2.2 });
  }
}

export function buildLevel(scene: THREE.Scene): LevelData {
  const map = mapJson as unknown as MapData;
  const occluders: THREE.Object3D[] = [];
  const bag = new KitBag();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.ground.size[0], map.ground.size[1]),
    worldMaterial(map.ground.material),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  for (const p of map.pavements) {
    bag.box('kerb', p.size[0], 0.22, p.size[1], p.pos[0], 0.11, p.pos[1]);
    // kerb edging stones break the slab edge
    bag.box('concrete_stone', p.size[0] + 0.3, 0.24, 0.35, p.pos[0], 0.12, p.pos[1] + p.size[1] / 2);
    bag.box('concrete_stone', p.size[0] + 0.3, 0.24, 0.35, p.pos[0], 0.12, p.pos[1] - p.size[1] / 2);
    bag.box('concrete_stone', 0.35, 0.24, p.size[1] + 0.3, p.pos[0] + p.size[0] / 2, 0.12, p.pos[1]);
    bag.box('concrete_stone', 0.35, 0.24, p.size[1] + 0.3, p.pos[0] - p.size[0] / 2, 0.12, p.pos[1]);
  }

  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(map.plaza.r, map.plaza.r, 0.3, 40),
    worldMaterial(map.plaza.material),
  );
  plaza.position.set(map.plaza.pos[0], 0.15, map.plaza.pos[1]);
  plaza.receiveShadow = true;
  scene.add(plaza);
  const [pw, ph, pd] = map.monument.plinth;
  bag.box('concrete_stone', pw, ph, pd, map.monument.pos[0], ph / 2 + 0.3, map.monument.pos[1], 0, true);
  const [bw, bh, bd] = map.monument.banner;
  bag.box('state_red', bw, bh, bd, map.monument.pos[0], ph + 0.3 + bh / 2 + 0.9, map.monument.pos[1]);

  const colliders: BoxCollider[] = [];
  for (const b of map.buildings) building(bag, b, colliders);
  for (const c of map.colliders) {
    colliders.push({ x: c.pos[0], z: c.pos[1], hw: c.size[0] / 2, hd: c.size[1] / 2 });
  }

  furniture(bag, map, colliders);
  bag.build(scene, occluders);

  return {
    colliders,
    occluders,
    waypoints: map.waypoints,
    spawns: map.spawns,
    restricted: map.restricted,
  };
}
