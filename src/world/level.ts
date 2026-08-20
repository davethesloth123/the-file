// Assembles Zamostye from src/data/map.zamostye.json and the facade kit.
// Buildings are generated (window grids, cornices, entrances, balconies,
// drainpipes) with seeded per-building variation so no two on the avenue
// are identical, then everything merges into one mesh per world material —
// the whole district renders in a few dozen draw calls. Outline shells are
// merged oversize boxes drawn BackSide, the same inverted-hull idea as the
// characters. Colliders and gameplay volumes come from the JSON, never
// from mesh names.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import mapJson from '../data/map.zamostye.json';
import { worldMaterial } from '../render/worldmat';

export interface BoxCollider { x: number; z: number; hw: number; hd: number }

interface MapData {
  ground: { size: [number, number]; material: string };
  pavements: { pos: [number, number]; size: [number, number] }[];
  buildings: BuildingDef[];
  plaza: { pos: [number, number]; r: number; material: string };
  monument: { pos: [number, number]; plinth: [number, number, number]; banner: [number, number, number] };
  tram: { x: number; railGap: number; from: number; to: number; wireHeight: number };
  lamps: { xs: number[]; from: number; to: number; step: number };
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

// Deterministic per-building variation; Math.random would change the city
// every load.
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
  ): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    g.translate(x, y, z);
    this.add(material, g);
  }

  build(scene: THREE.Scene, occluders: THREE.Object3D[]): void {
    for (const [name, list] of this.buckets) {
      const merged = mergeGeometries(list);
      const mesh = new THREE.Mesh(merged, worldMaterial(name));
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

interface BuildingDef {
  id: string;
  pos: [number, number];
  size: [number, number];
  floors: number;
  style: string;
  seed: number;
  stateLintel?: boolean;
}

const FLOOR_H = 2.6;
const GROUND_FLOOR_H = 3.2;

function building(bag: KitBag, b: BuildingDef): void {
  const rand = mulberry32(b.seed);
  const [cx, cz] = b.pos;
  const [w, d] = b.size;
  const h = GROUND_FLOOR_H + b.floors * FLOOR_H;

  bag.box(b.style, w, h, d, cx, h / 2, cz, 0, true);
  // roof cap and cornice
  bag.box('roof', w * 1.03, 0.5, d * 1.03, cx, h + 0.25, cz);
  bag.box('trim', w + 0.24, 0.3, d + 0.24, cx, h - 0.35, cz);

  // Entrance faces the nearest street (toward the origin on the dominant axis).
  const entranceAxis = Math.abs(cx) > Math.abs(cz) ? 'x' : 'z';
  const entranceSign = entranceAxis === 'x' ? -Math.sign(cx) : -Math.sign(cz);

  // Four facades: n = outward normal axis/sign, len = facade width.
  const facades: { axis: 'x' | 'z'; sign: number; len: number }[] = [
    { axis: 'z', sign: 1, len: w }, { axis: 'z', sign: -1, len: w },
    { axis: 'x', sign: 1, len: d }, { axis: 'x', sign: -1, len: d },
  ];

  for (const f of facades) {
    const half = (f.axis === 'x' ? w : d) / 2;
    const nx = Math.floor((f.len - 2.4) / 2.2);
    const x0 = -((nx - 1) * 2.2) / 2;
    const isEntrance = f.axis === entranceAxis && f.sign === entranceSign;
    const doorSlot = isEntrance ? Math.floor(rand() * nx) : -1;
    const balconyFloor = 1 + Math.floor(rand() * Math.max(1, b.floors - 1));

    const place = (along: number, y: number, bw: number, bh: number, depth: number, mat: string): void => {
      if (f.axis === 'z') bag.box(mat, bw, bh, depth, cx + along, y, cz + f.sign * half, 0);
      else bag.box(mat, depth, bh, bw, cx + f.sign * half, y, cz + along, 0);
    };

    for (let i = 0; i < nx; i++) {
      const along = x0 + i * 2.2;
      // ground floor: door, shopfront, or nothing
      if (i === doorSlot) {
        place(along, 1.25, 1.5, 2.5, 0.3, 'trim');
        if (b.stateLintel) place(along, 2.75, 2.2, 0.5, 0.34, 'state_red');
        place(along, 0.12, 2.4, 0.24, 1.6, 'concrete_stone'); // step
      } else if (rand() < 0.35) {
        place(along, 1.55, 1.7, 1.7, 0.14, 'trim'); // shopfront
      }
      // upper floors: window grid with occasional gaps
      for (let fl = 1; fl <= b.floors; fl++) {
        if (rand() < 0.06) continue;
        const y = GROUND_FLOOR_H + (fl - 0.5) * FLOOR_H;
        place(along, y, 1.0, 1.5, 0.14, 'trim');
        if (fl === balconyFloor && rand() < 0.3) {
          const off = f.axis === 'z' ? cz + f.sign * (half + 0.42) : cx + f.sign * (half + 0.42);
          if (f.axis === 'z') {
            bag.box('concrete_stone', 1.7, 0.12, 0.85, cx + along, y - 0.85, off);
            bag.box('trim', 1.7, 0.7, 0.06, cx + along, y - 0.45, off + f.sign * 0.4);
          } else {
            bag.box('concrete_stone', 0.85, 0.12, 1.7, off, y - 0.85, cz + along);
            bag.box('trim', 0.06, 0.7, 1.7, off + f.sign * 0.4, y - 0.45, cz + along);
          }
        }
      }
    }
    // drainpipes at the facade's corners, most of the time
    if (rand() < 0.75) {
      const corner = f.len / 2 - 0.45;
      const pick = rand() < 0.5 ? corner : -corner;
      if (f.axis === 'z') bag.cylinder('rust_metal', 0.06, 0.07, h - 0.5, 6, cx + pick, (h - 0.5) / 2, cz + f.sign * (half + 0.1));
      else bag.cylinder('rust_metal', 0.06, 0.07, h - 0.5, 6, cx + f.sign * (half + 0.1), (h - 0.5) / 2, cz + pick);
    }
  }
}

function furniture(bag: KitBag, map: MapData): void {
  // lamps
  const L = map.lamps;
  for (const x of L.xs) {
    for (let z = L.from; z <= L.to; z += L.step) {
      bag.cylinder('trim', 0.12, 0.16, 7, 6, x, 3.5, z);
      bag.box('trim', 0.9, 0.35, 0.5, x, 7.1, z);
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
  // trees: bare October — trunk plus a few tilted branch slivers
  for (let i = 0; i < map.trees.length; i++) {
    const [x, z] = map.trees[i]!;
    const rand = mulberry32(9000 + i);
    const th = 3.6 + rand() * 1.6;
    bag.cylinder('bark', 0.09, 0.15, th, 5, x, th / 2, z);
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
}

export function buildLevel(scene: THREE.Scene): LevelData {
  const map = mapJson as unknown as MapData;
  const occluders: THREE.Object3D[] = [];
  const bag = new KitBag();

  // ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.ground.size[0], map.ground.size[1]),
    worldMaterial(map.ground.material),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // pavements
  for (const p of map.pavements) {
    bag.box('kerb', p.size[0], 0.22, p.size[1], p.pos[0], 0.11, p.pos[1]);
  }

  // plaza, monument, banner
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
  for (const b of map.buildings as BuildingDef[]) {
    building(bag, b);
    colliders.push({ x: b.pos[0], z: b.pos[1], hw: b.size[0] / 2, hd: b.size[1] / 2 });
  }
  for (const c of map.colliders) {
    colliders.push({ x: c.pos[0], z: c.pos[1], hw: c.size[0] / 2, hd: c.size[1] / 2 });
  }
  for (const k of map.kiosks) colliders.push({ x: k.pos[0], z: k.pos[1], hw: 1.3, hd: 1.1 });

  furniture(bag, map);
  bag.build(scene, occluders);

  return {
    colliders,
    occluders,
    waypoints: map.waypoints as Record<string, [number, number]>,
    spawns: map.spawns as Record<string, [number, number]>,
    restricted: map.restricted as LevelData['restricted'],
  };
}
