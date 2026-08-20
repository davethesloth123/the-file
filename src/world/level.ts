// Assembles Zamostye from src/data/map.zamostye.json and the facade kit.
// Closed buildings are dressed solids (window grids with frames and sills,
// shopfronts with awnings and signs, cornices, balconies, drainpipes, roof
// furniture). Buildings marked `open` are built hollow: punched window
// openings, a doorway with the door ajar, storey floor slabs, a dog-leg
// stair, partition walls and furnished rooms — the player walks in and
// climbs. Everything merges into one mesh per material. Colliders (vertical
// bands) and walkable surfaces come from the JSON-driven build, never from
// mesh names.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import mapJson from '../data/map.zamostye.json';
import { worldMaterial, toonColor } from '../render/worldmat';
import type { WallBox, Surface } from './collision';

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
  open?: 'flats' | 'office' | 'works';
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
  phoneBooths: { pos: [number, number]; yawDeg: number }[];
  postBoxes: [number, number][];
  pumps: [number, number][];
  washing: { from: [number, number]; to: [number, number] }[];
  roadDashes: { from: [number, number]; to: [number, number] }[];
  crossings: { pos: [number, number]; len: number; across: string }[];
  colliders: { type: string; pos: [number, number]; size: [number, number] }[];
  restricted: { id: string; pos: [number, number]; r: number; label: string }[];
  waypoints: Record<string, [number, number]>;
  spawns: Record<string, [number, number]>;
}

export interface LevelData {
  walls: WallBox[];
  surfaces: Surface[];
  occluders: THREE.Object3D[];
  waypoints: Record<string, [number, number]>;
  spawns: Record<string, [number, number]>;
  restricted: { id: string; pos: [number, number]; r: number; label: string }[];
}

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
const BIG = 1000;

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
    ry = 0, outline = false, rx = 0,
  ): void {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.add(material, g);
    if (outline) {
      const s = new THREE.BoxGeometry(w + OUTLINE_T, h + OUTLINE_T, d + OUTLINE_T);
      if (rx) s.rotateX(rx);
      if (ry) s.rotateY(ry);
      s.translate(x, y, z);
      this.shells.push(s);
    }
  }

  cylinder(
    material: string,
    rTop: number, rBot: number, h: number, seg: number,
    x: number, y: number, z: number,
    rz = 0, rx = 0,
  ): void {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
    if (rz) g.rotateZ(rz);
    if (rx) g.rotateX(rx);
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
const WALL_T = 0.32;

function storeyBase(s: number): number {
  // top surface of the floor slab of storey s (0 = ground)
  return s === 0 ? 0.16 : GROUND_FLOOR_H + (s - 1) * FLOOR_H;
}

// ------------------------------------------------------------- buildings
function building(
  bag: KitBag, b: BuildingDef, walls: WallBox[], surfaces: Surface[],
  lights: THREE.PointLight[],
): void {
  const rand = mulberry32(b.seed);
  const yaw = ((b.yawDeg ?? 0) * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const wxOf = (lx: number, lz: number): number => b.pos[0] + lx * cy + lz * sy;
  const wzOf = (lx: number, lz: number): number => b.pos[1] - lx * sy + lz * cy;
  const put = (
    material: string,
    w: number, h: number, d: number,
    lx: number, ly: number, lz: number,
    outline = false,
  ): void => bag.box(material, w, h, d, wxOf(lx, lz), ly, wzOf(lx, lz), yaw, outline);

  const winScale = 0.85 + rand() * 0.35;
  const hasStringCourse = rand() < 0.5;
  const entranceAxis: 'x' | 'z' = Math.abs(b.pos[0]) > Math.abs(b.pos[1]) ? 'x' : 'z';
  const entranceSign = entranceAxis === 'x' ? -Math.sign(b.pos[0]) : -Math.sign(b.pos[1]);

  const dressings = (w: number, d: number, h: number, ox: number, oz: number): void => {
    put('roof', w * 1.03, 0.5, d * 1.03, ox, h + 0.25, oz);
    put('trim', w + 0.24, 0.3, d + 0.24, ox, h - 0.35, oz);
    if (hasStringCourse) put('trim', w + 0.16, 0.16, d + 0.16, ox, GROUND_FLOOR_H, oz);
    const nChimneys = 1 + Math.floor(rand() * 2);
    for (let c = 0; c < nChimneys; c++) {
      const ch = 1.2 + rand() * 1.2;
      put('brick_rust', 0.75, ch, 0.75, ox + (rand() - 0.5) * (w - 3), h + ch / 2, oz + (rand() - 0.5) * (d - 3));
    }
    if (rand() < 0.65) {
      const lx = ox + (rand() - 0.5) * (w - 4);
      const lz = oz + (rand() - 0.5) * (d - 4);
      put('trim', 0.05, 2.2, 0.05, lx, h + 1.1, lz);
      put('trim', 1.1, 0.04, 0.04, lx, h + 1.9, lz);
    }
  };

  // ---- closed mass: dressed solid
  const solidMass = (
    ox: number, oz: number, w: number, d: number, floors: number, isMain: boolean,
  ): void => {
    const h = GROUND_FLOOR_H + floors * FLOOR_H;
    put(b.style, w, h, d, ox, h / 2, oz, true);
    dressings(w, d, h, ox, oz);

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
          // shopfront with awning and, sometimes, a hanging sign
          place(along, 1.55, 1.7, 1.7, 0.14, 'trim');
          place(along, 1.62, 1.9, 0.08, 0.06, 'render_bone', 0.1);
          if (rand() < 0.75) {
            const mat = rand() < 0.5 ? 'render_sage' : 'brick_rust';
            const ay = 2.62, aout = 0.55;
            if (f.axis === 'z') {
              bag.box(mat, 2.0, 0.07, 1.1, wxOf(ox + along, oz + f.sign * (half + aout)), ay,
                wzOf(ox + along, oz + f.sign * (half + aout)), yaw, false, -f.sign * 0.35);
            } else {
              bag.box(mat, 1.1, 0.07, 2.0, wxOf(ox + f.sign * (half + aout), oz + along), ay,
                wzOf(ox + f.sign * (half + aout), oz + along), yaw, false, 0);
            }
          }
          if (rand() < 0.35) {
            place(along + 0.9, 2.9, 0.06, 0.06, 0.7, 'trim', 0.35);
            place(along + 0.9, 2.55, 0.55, 0.45, 0.06, 'render_bone', 0.55);
          }
        } else if (rand() < 0.25) {
          place(along, 0.42, 1.1, 0.55, 0.14, 'trim');
        }
        for (let fl = 1; fl <= floors; fl++) {
          if (rand() < 0.06) continue;
          const y = GROUND_FLOOR_H + (fl - 0.5) * FLOOR_H;
          place(along, y, 1.16 * winScale, 1.66 * winScale, 0.1, 'render_bone');   // frame
          place(along, y, 1.0 * winScale, 1.5 * winScale, 0.14, 'trim');           // glass
          place(along, y - 0.78 * winScale, 1.2 * winScale, 0.08, 0.1, 'concrete_stone', 0.06);
          if (fl === balconyFloor && rand() < 0.3) {
            place(along, y - 0.85, 1.7, 0.12, 0.85, 'concrete_stone', 0.42);
            place(along, y - 0.45, 1.7, 0.7, 0.06, 'trim', 0.82);
          }
        }
      }
    }
    const pad = Math.abs(sy) * (w + d) * 0.25;
    walls.push({ x: wxOf(ox, oz), z: wzOf(ox, oz), hw: w / 2 + pad, hd: d / 2 + pad, y0: 0, y1: h });
  };

  // ---- open mass: hollow shell with punched openings, floors and stairs.
  // Interiors are axis-aligned (open buildings carry no yaw in the data).
  const openMass = (): void => {
    const [w0, d0] = b.size;
    const floors = b.floors;
    const h = GROUND_FLOOR_H + floors * FLOOR_H;
    const es = entranceSign;
    const Din = entranceAxis === 'x' ? w0 : d0;    // depth along entrance axis
    const Wt = entranceAxis === 'x' ? d0 : w0;     // width along tangent

    // frame → local: `iin` inward from the entrance face, `tt` tangent
    const putF = (
      material: string, wt: number, hh: number, win: number,
      tt: number, y: number, iin: number,
    ): void => {
      if (entranceAxis === 'z') put(material, wt, hh, win, tt, y, es * (d0 / 2 - iin));
      else put(material, win, hh, wt, es * (w0 / 2 - iin), y, tt);
    };
    const worldOfF = (tt: number, iin: number): [number, number] => {
      const lx = entranceAxis === 'z' ? tt : es * (w0 / 2 - iin);
      const lz = entranceAxis === 'z' ? es * (d0 / 2 - iin) : tt;
      return [wxOf(lx, lz), wzOf(lx, lz)];
    };
    // A bare bulb: the stairwell light every Soviet building runs on.
    const bulb = (tt: number, y: number, iin: number): void => {
      const [lxw, lzw] = worldOfF(tt, iin);
      const light = new THREE.PointLight(0xffeec4, 15, 11, 2);
      light.position.set(lxw, y - 0.35, lzw);
      lights.push(light);
      putF('render_bone', 0.15, 0.15, 0.15, tt, y + 0.12, iin);
    };
    const flatF = (tt0: number, tt1: number, in0: number, in1: number, y: number): void => {
      const [cxw, czw] = worldOfF((tt0 + tt1) / 2, (in0 + in1) / 2);
      const hwT = Math.abs(tt1 - tt0) / 2, hdI = Math.abs(in1 - in0) / 2;
      surfaces.push({
        kind: 'flat', x: cxw, z: czw,
        hw: entranceAxis === 'z' ? hwT : hdI,
        hd: entranceAxis === 'z' ? hdI : hwT,
        y,
      });
    };
    const wallF = (tt0: number, tt1: number, in0: number, in1: number, y0: number, y1: number): void => {
      const [cxw, czw] = worldOfF((tt0 + tt1) / 2, (in0 + in1) / 2);
      const hwT = Math.abs(tt1 - tt0) / 2 + 0.02, hdI = Math.abs(in1 - in0) / 2 + 0.02;
      walls.push({
        x: cxw, z: czw,
        hw: entranceAxis === 'z' ? hwT : hdI,
        hd: entranceAxis === 'z' ? hdI : hwT,
        y0, y1,
      });
    };

    // -- punched perimeter walls with window frames
    const facades: { axis: 'x' | 'z'; sign: number; len: number }[] = [
      { axis: 'z', sign: 1, len: w0 }, { axis: 'z', sign: -1, len: w0 },
      { axis: 'x', sign: 1, len: d0 }, { axis: 'x', sign: -1, len: d0 },
    ];
    for (const f of facades) {
      const half = (f.axis === 'x' ? w0 : d0) / 2 - WALL_T / 2;
      const L = f.len;
      const nx = Math.floor((L - 2.4) / 2.2);
      const x0 = -((nx - 1) * 2.2) / 2;
      const ow = 1.0 * winScale;
      const isEntrance = f.axis === entranceAxis && f.sign === entranceSign;
      const doorSlot = isEntrance ? Math.floor(nx / 2) : -1;

      const seg = (from: number, to: number, y0f: number, y1f: number): void => {
        if (to - from < 0.02) return;
        const c = (from + to) / 2, wseg = to - from;
        if (f.axis === 'z') put(b.style, wseg, y1f - y0f, WALL_T, c, (y0f + y1f) / 2, f.sign * half);
        else put(b.style, WALL_T, y1f - y0f, wseg, f.sign * half, (y0f + y1f) / 2, c);
      };
      // piers full height
      let cursor = -L / 2;
      for (let i = 0; i < nx; i++) {
        const ci = x0 + i * 2.2;
        const openW = i === doorSlot ? 1.6 : ow;
        seg(cursor, ci - openW / 2, 0, h);
        cursor = ci + openW / 2;
      }
      seg(cursor, L / 2, 0, h);
      // spandrels and lintels per column per storey + frames
      for (let i = 0; i < nx; i++) {
        const ci = x0 + i * 2.2;
        const openW = i === doorSlot ? 1.6 : ow;
        const colL = ci - openW / 2, colR = ci + openW / 2;
        for (let s = 0; s <= floors; s++) {
          const base = s === 0 ? 0 : GROUND_FLOOR_H + (s - 1) * FLOOR_H;
          const top = s === floors ? h : GROUND_FLOOR_H + s * FLOOR_H;
          const winB = s === 0 ? (i === doorSlot ? 0 : 1.15) : base + 0.72;
          const winT = s === 0 ? (i === doorSlot ? 2.5 : 2.65) : winB + 1.5 * winScale;
          if (winB > base) seg(colL, colR, base, winB);
          if (top > winT) seg(colL, colR, winT, top);
          if (i !== doorSlot || s > 0) {
            // slender frame around the opening
            const fy = (winB + winT) / 2, fh = winT - winB;
            const fput = (wseg: number, hh: number, cc: number, yy: number): void => {
              if (f.axis === 'z') put('render_bone', wseg, hh, 0.12, cc, yy, f.sign * (half + WALL_T / 2 - 0.05));
              else put('render_bone', 0.12, hh, wseg, f.sign * (half + WALL_T / 2 - 0.05), yy, cc);
            };
            fput(0.08, fh + 0.16, colL - 0.04, fy);
            fput(0.08, fh + 0.16, colR + 0.04, fy);
            fput(openW + 0.16, 0.08, ci, winT + 0.04);
            fput(openW + 0.16, 0.08, ci, winB - 0.04);
          }
        }
      }
      // collision: solid facade (players don't fit through windows), door gap
      if (isEntrance) {
        const dc = x0 + doorSlot * 2.2;
        const mk = (a: number, bb: number): void => {
          if (bb - a < 0.05) return;
          const c = (a + bb) / 2, wseg = bb - a;
          if (f.axis === 'z') walls.push({ x: wxOf(c, f.sign * half), z: wzOf(c, f.sign * half), hw: wseg / 2, hd: WALL_T / 2 + 0.03, y0: 0, y1: h });
          else walls.push({ x: wxOf(f.sign * half, c), z: wzOf(f.sign * half, c), hw: WALL_T / 2 + 0.03, hd: wseg / 2, y0: 0, y1: h });
        };
        mk(-L / 2, dc - 0.8);
        mk(dc + 0.8, L / 2);
      } else {
        if (f.axis === 'z') walls.push({ x: wxOf(0, f.sign * half), z: wzOf(0, f.sign * half), hw: L / 2, hd: WALL_T / 2 + 0.03, y0: 0, y1: h });
        else walls.push({ x: wxOf(f.sign * half, 0), z: wzOf(f.sign * half, 0), hw: WALL_T / 2 + 0.03, hd: L / 2, y0: 0, y1: h });
      }
    }

    dressings(w0, d0, h, 0, 0);
    // door ajar + threshold step
    putF('roof', 0.1, 2.4, 0.9, 1.05, 1.2, 0.62);
    putF('concrete_stone', 2.4, 0.24, 1.6, 0, 0.12, -0.6);
    flatF(-1.2, 1.2, -1.4, 0.2, 0.24);

    const innerT = Wt / 2 - WALL_T;
    if (b.open === 'works') {
      // one tall hall: boilers, pipework, mezzanine with a straight stair
      putF('roof', Wt - 2 * WALL_T, 0.14, Din - 2 * WALL_T, 0, 0.09, Din / 2);
      flatF(-innerT, innerT, WALL_T, Din - WALL_T, 0.16);
      bulb(0, 2.6, Din * 0.3);
      bulb(0, 5.2, Din * 0.72);
      for (const tt of [-Wt / 4, Wt / 4]) {
        const [bx, bz] = worldOfF(tt, Din * 0.62);
        bag.cylinder('rust_metal', 1.05, 1.05, 4.2, 12, bx, 1.35, bz, Math.PI / 2, entranceAxis === 'z' ? 0 : Math.PI / 2);
        putF('concrete_stone', 2.4, 0.5, 1.0, tt, 0.25, Din * 0.62);
      }
      for (let i = 0; i < 4; i++) {
        const [px2, pz2] = worldOfF(-innerT + 0.25, Din * 0.25 + i * 1.1);
        bag.cylinder('rust_metal', 0.09, 0.09, 5.5, 6, px2, 2.8, pz2);
      }
      // mezzanine over the back half
      const mezY = 3.1;
      putF('concrete_stone', Wt - 2 * WALL_T, 0.18, Din * 0.32, 0, mezY - 0.09, Din * 0.80);
      flatF(-innerT, innerT, Din * 0.64, Din - WALL_T, mezY);
      putF('trim', Wt - 2 * WALL_T, 0.65, 0.06, 0, mezY + 0.33, Din * 0.64);
      // straight stair up the side
      const runIn0 = Din * 0.64 - 3.4, runIn1 = Din * 0.64;
      const rampTT: [number, number] = [innerT - 1.2, innerT];
      const [rcx, rcz] = worldOfF((rampTT[0] + rampTT[1]) / 2, (runIn0 + runIn1) / 2);
      surfaces.push({
        kind: 'ramp', x: rcx, z: rcz,
        hw: entranceAxis === 'z' ? 0.6 : 1.7, hd: entranceAxis === 'z' ? 1.7 : 0.6,
        axis: entranceAxis === 'z' ? 'z' : 'x',
        // rises inward; orient by entrance sign
        y0: es > 0 ? mezY : 0.16, y1: es > 0 ? 0.16 : mezY,
      });
      for (let st = 0; st < 8; st++) {
        const t01 = (st + 0.5) / 8;
        putF('concrete_stone', 1.2, 0.12, 0.42, innerT - 0.6, 0.16 + (mezY - 0.16) * t01, runIn0 + (runIn1 - runIn0) * t01);
      }
      return;
    }

    // -- flats / office: storey slabs with a dog-leg stair at the back
    const bayIn0 = Din - 3.8, bayIn1 = Din - 1.0;
    const bayT0 = -2.2, bayT1 = 2.5;
    const hTot = GROUND_FLOOR_H + floors * FLOOR_H;
    // enclosed stair shaft: walls on three sides; entry and each storey's
    // exit are on the tangent-min side
    putF('render_bone', bayT1 - bayT0 + 0.3, hTot - 0.2, 0.14, (bayT0 + bayT1) / 2, hTot / 2, bayIn0 - 0.12);
    putF('render_bone', bayT1 - bayT0 + 0.3, hTot - 0.2, 0.14, (bayT0 + bayT1) / 2, hTot / 2, bayIn1 + 0.12);
    putF('render_bone', 0.14, hTot - 0.2, bayIn1 - bayIn0 + 0.5, bayT1 + 0.1, hTot / 2, (bayIn0 + bayIn1) / 2);
    wallF(bayT0 - 0.2, bayT1 + 0.2, bayIn0 - 0.2, bayIn0 - 0.04, 0, hTot);
    wallF(bayT0 - 0.2, bayT1 + 0.2, bayIn1 + 0.04, bayIn1 + 0.2, 0, hTot);
    wallF(bayT1 + 0.02, bayT1 + 0.18, bayIn0, bayIn1, 0, hTot);
    // ground interior floor + hallway bulb + ground-level partition, so the
    // entrance reads as a stair hall, not a barn
    putF('roof', Wt - 2 * WALL_T, 0.14, Din - 2 * WALL_T, 0, 0.09, Din / 2);
    flatF(-innerT, innerT, WALL_T, Din - WALL_T, 0.16);
    bulb(0.2, 2.6, Din - 3.0);
    {
      const partIn = Din - 4.8;
      putF('render_bone', innerT - 0.9, 2.9, 0.16, (-innerT - 0.9) / 2, 1.61, partIn);
      putF('render_bone', innerT - 1.2, 2.9, 0.16, (1.2 + innerT) / 2, 1.61, partIn);
      wallF(-innerT, -0.9, partIn - 0.08, partIn + 0.08, 0, GROUND_FLOOR_H);
      wallF(1.2, innerT, partIn - 0.08, partIn + 0.08, 0, GROUND_FLOOR_H);
      // the doorway stays open: it is the corridor to the stairs
    }

    for (let s = 1; s <= floors; s++) {
      const y = storeyBase(s);
      const slab = (tt0: number, tt1: number, in0: number, in1: number): void => {
        if (tt1 - tt0 < 0.05 || in1 - in0 < 0.05) return;
        putF('roof', tt1 - tt0, 0.22, in1 - in0, (tt0 + tt1) / 2, y - 0.11, (in0 + in1) / 2);
        // plaster ceiling sheet under the slab
        putF('render_bone', tt1 - tt0, 0.02, in1 - in0, (tt0 + tt1) / 2, y - 0.235, (in0 + in1) / 2);
        flatF(tt0, tt1, in0, in1, y);
      };
      slab(-innerT, innerT, WALL_T, bayIn0);
      slab(-innerT, innerT, bayIn1, Din - WALL_T);
      slab(-innerT, bayT0, bayIn0, bayIn1);
      slab(bayT1, innerT, bayIn0, bayIn1);

      // dog-leg stair up to this storey
      const yPrev = storeyBase(s - 1);
      const rise = y - yPrev;
      const inA: [number, number] = [Din - 3.8, Din - 2.6];
      const inB: [number, number] = [Din - 2.2, Din - 1.0];
      const runT: [number, number] = [-2.2, 0.6];
      const rampF = (inBand: [number, number], yLo: number, yHi: number, upTangent: boolean): void => {
        const [rcx, rcz] = worldOfF((runT[0] + runT[1]) / 2, (inBand[0] + inBand[1]) / 2);
        const hwT = (runT[1] - runT[0]) / 2, hdI = (inBand[1] - inBand[0]) / 2;
        // tangent tt maps directly onto world +x (entrance axis z) or +z
        // (entrance axis x); no sign flip in either case
        const lowAtMin = upTangent;
        surfaces.push({
          kind: 'ramp', x: rcx, z: rcz,
          hw: entranceAxis === 'z' ? hwT : hdI,
          hd: entranceAxis === 'z' ? hdI : hwT,
          axis: entranceAxis === 'z' ? 'x' : 'z',
          y0: lowAtMin ? yLo : yHi,
          y1: lowAtMin ? yHi : yLo,
        });
        const steps = 7;
        for (let st = 0; st < steps; st++) {
          const t01 = (st + 0.5) / steps;
          const tt = upTangent ? runT[0] + (runT[1] - runT[0]) * t01 : runT[1] - (runT[1] - runT[0]) * t01;
          putF('concrete_stone', 0.42, 0.12, inBand[1] - inBand[0], tt, yLo + (yHi - yLo) * t01, (inBand[0] + inBand[1]) / 2);
        }
      };
      rampF(inA, yPrev, yPrev + rise / 2, true);
      putF('concrete_stone', bayT1 - 0.6, 0.16, inB[1] - inA[0], (0.6 + bayT1) / 2, yPrev + rise / 2 - 0.08, (inA[0] + inB[1]) / 2);
      flatF(0.6, bayT1, inA[0], inB[1], yPrev + rise / 2);
      rampF(inB, yPrev + rise / 2, y, false);
      // railing along the open side of the flights
      putF('trim', runT[1] - runT[0], 0.7, 0.05, (runT[0] + runT[1]) / 2, yPrev + rise * 0.3 + 0.5, inA[1] + 0.03);

      // partition between the front room and the stair hall
      const partIn = bayIn0 - 1.0;
      const partY0 = y, partY1 = s === floors ? h : storeyBase(s + 1);
      const roomOpen = b.open === 'flats' ? (s === 2 || s === floors) : false;
      putF(b.style === 'brick_rust' ? 'render_bone' : 'render_bone', innerT - 0.9, partY1 - partY0 - 0.2, 0.16, (-innerT + (-0.9)) / 2 + 0, (partY0 + partY1) / 2 - 0.1, partIn);
      putF('render_bone', innerT - 1.2, partY1 - partY0 - 0.2, 0.16, (1.2 + innerT) / 2, (partY0 + partY1) / 2 - 0.1, partIn);
      wallF(-innerT, -0.9, partIn - 0.08, partIn + 0.08, partY0, partY1);
      wallF(1.2, innerT, partIn - 0.08, partIn + 0.08, partY0, partY1);
      if (!roomOpen && s > 0) {
        // closed door panel in the partition opening
        putF('roof', 2.1, partY1 - partY0 - 0.9, 0.1, 0.15, partY0 + (partY1 - partY0 - 0.9) / 2, partIn);
        wallF(-0.9, 1.2, partIn - 0.08, partIn + 0.08, partY0, partY1);
      }

      // stairwell bulb on alternating landings keeps light count modest
      if (s % 2 === 1) bulb(1.4, storeyBase(s) + 2.2, Din - 2.4);

      if (roomOpen) {
        // a lived-in room: bed, table and stools, wardrobe, stove
        const rIn = partIn / 2 + WALL_T / 2;
        bulb(0.3, y + 2.25, rIn);
        putF('roof', 0.95, 0.45, 2.0, -innerT + 0.75, y + 0.3, rIn - 1.2);
        putF('render_bone', 0.9, 0.18, 1.9, -innerT + 0.75, y + 0.6, rIn - 1.2);
        putF('roof', 1.25, 0.1, 0.85, 0.4, y + 0.76, rIn);
        for (const [dtx, diz] of [[-0.45, 0.55], [1.15, -0.4]] as [number, number][]) {
          putF('roof', 0.38, 0.46, 0.38, 0.4 + dtx, y + 0.28, rIn + diz);
        }
        putF('trim', 1.2, 2.0, 0.55, innerT - 0.85, y + 1.05, rIn - 1.3);
        putF('rust_metal', 0.6, 0.85, 0.6, innerT - 0.6, y + 0.48, rIn + 1.5);
        const [sx2, sz2] = worldOfF(innerT - 0.6, rIn + 1.5);
        bag.cylinder('rust_metal', 0.07, 0.07, (s === floors ? h : storeyBase(s + 1)) - y - 0.9, 6, sx2, y + 0.9 + ((s === floors ? h : storeyBase(s + 1)) - y - 0.9) / 2, sz2);
      }
    }

    if (b.open === 'office') {
      // records office ground floor: counter, desks, shelving, and the
      // state's own red pennant on the counter
      bulb(-2.2, 2.7, 3.4);
      putF('roof', 4.6, 1.05, 0.6, -0.4, 0.68, 4.4);
      putF('state_red', 0.05, 0.4, 0.3, 1.2, 1.45, 4.4);
      for (const tt of [-innerT + 0.55, -innerT + 1.65] as number[]) {
        putF('trim', 0.9, 2.1, 0.4, tt, 1.21, Din - 5.6);
      }
      for (let i = 0; i < 3; i++) {
        putF('trim', 0.5, 2.1, 2.2, innerT - 0.45, 1.21, 2.2 + i * 3.0);
        putF('render_bone', 0.42, 0.25, 2.0, innerT - 0.45, 1.5, 2.2 + i * 3.0);
      }
      putF('roof', 1.6, 0.78, 0.8, -innerT + 1.4, 0.55, 2.6);
      putF('roof', 0.42, 0.5, 0.42, -innerT + 1.4, 0.3, 3.5);
    }
  };

  if (b.open) openMass();
  else {
    solidMass(0, 0, b.size[0], b.size[1], b.floors, true);
    for (const wing of b.wings ?? []) {
      solidMass(wing.dx, wing.dz, wing.w, wing.d, Math.max(1, b.floors + wing.floorsDelta), false);
    }
  }

  // drainpipes
  const dp = mulberry32(b.seed ^ 0xbeef);
  const [w0, d0] = b.size;
  for (const [lx, lz] of [
    [w0 / 2 + 0.1, d0 / 2 - 0.5], [-w0 / 2 - 0.1, -d0 / 2 + 0.5],
    [w0 / 2 - 0.5, -d0 / 2 - 0.1], [-w0 / 2 + 0.5, d0 / 2 + 0.1],
  ] as [number, number][]) {
    if (dp() < 0.7) {
      const h = GROUND_FLOOR_H + b.floors * FLOOR_H - 0.5;
      bag.cylinder('rust_metal', 0.06, 0.07, h, 6, wxOf(lx, lz), h / 2, wzOf(lx, lz));
    }
  }
  if (b.chimney) {
    const lx = b.size[0] / 2 - 1.6, lz = -b.size[1] / 2 + 1.6;
    bag.cylinder('brick_rust', 0.8, 1.05, 16, 10, wxOf(lx, lz), 8, wzOf(lx, lz));
  }
}

// ------------------------------------------------------------- furniture
function furniture(
  bag: KitBag, map: MapData, walls: WallBox[], surfaces: Surface[],
): void {
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
  const T = map.tram;
  const len = T.to - T.from;
  const zc = (T.to + T.from) / 2;
  for (const s of [-1, 1]) {
    bag.box('trim', 0.07, 0.06, len, T.x + (s * T.railGap) / 2, 0.03 + 0.22, zc);
    bag.box('trim', 0.03, 0.03, len, T.x + (s * T.railGap) / 2, T.wireHeight, zc);
  }
  for (let z = L.from; z <= L.to; z += L.step) {
    bag.box('trim', 27, 0.025, 0.025, 0, T.wireHeight + 0.35, z);
  }
  for (const [x, z] of map.manholes) {
    const y = Math.abs(x) <= 13 ? 0.24 : 0.03;
    bag.cylinder('trim', 0.5, 0.5, 0.04, 12, x, y, z);
  }
  // road markings: centre dashes and zebra crossings
  for (const rd of map.roadDashes) {
    const dx = rd.to[0] - rd.from[0], dz = rd.to[1] - rd.from[1];
    const ln = Math.hypot(dx, dz);
    const n = Math.floor(ln / 6);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      bag.box('render_bone', dz === 0 ? 2.4 : 0.14, 0.02, dz === 0 ? 0.14 : 2.4,
        rd.from[0] + dx * t, 0.015, rd.from[1] + dz * t);
    }
  }
  for (const cr of map.crossings) {
    for (let i = -3; i <= 3; i++) {
      bag.box('render_bone', cr.len, 0.02, 0.5, cr.pos[0], 0.015, cr.pos[1] + i * 1.0);
    }
  }
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
  for (const bn of map.benches) {
    const ry = (bn.yawDeg * Math.PI) / 180;
    bag.box('roof', 1.8, 0.07, 0.5, bn.pos[0], 0.45, bn.pos[1], ry);
    bag.box('roof', 1.8, 0.45, 0.06, bn.pos[0] + Math.sin(ry) * 0.24, 0.75, bn.pos[1] + Math.cos(ry) * 0.24, ry);
    bag.box('trim', 1.6, 0.42, 0.42, bn.pos[0], 0.21, bn.pos[1], ry);
  }
  for (const k of map.kiosks) {
    const ry = (k.yawDeg * Math.PI) / 180;
    bag.box('render_sage', 2.4, 2.5, 2.0, k.pos[0], 1.25, k.pos[1], ry, true);
    bag.box('roof', 2.8, 0.18, 2.4, k.pos[0], 2.6, k.pos[1], ry);
    bag.box('trim', 1.6, 0.8, 0.1, k.pos[0] - Math.sin(ry) * 1.01, 1.5, k.pos[1] - Math.cos(ry) * 1.01, ry);
    walls.push({ x: k.pos[0], z: k.pos[1], hw: 1.3, hd: 1.1, y0: 0, y1: 2.6 });
  }
  for (const [x, z] of map.bins) bag.cylinder('rust_metal', 0.26, 0.24, 0.75, 8, x, 0.38, z);
  for (const bd of map.boards) {
    const ry = (bd.yawDeg * Math.PI) / 180;
    for (const s of [-0.7, 0.7]) {
      bag.box('trim', 0.08, 2.0, 0.08, bd.pos[0] + Math.cos(ry) * s, 1.0, bd.pos[1] - Math.sin(ry) * s, ry);
    }
    bag.box('render_bone', 1.7, 1.1, 0.06, bd.pos[0], 1.55, bd.pos[1], ry);
  }
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
    walls.push({ x: g.pos[0], z: g.pos[1], hw: gw / 2 + 0.5, hd: gd / 2 + 0.5, y0: 0, y1: 2.8 });
  }
  for (const wl of map.walls) {
    const dx = wl.to[0] - wl.from[0], dz = wl.to[1] - wl.from[1];
    const ln = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz);
    const cx = (wl.from[0] + wl.to[0]) / 2, cz = (wl.from[1] + wl.to[1]) / 2;
    bag.box('brick_rust', 0.35, wl.h, ln, cx, wl.h / 2, cz, ry);
    bag.box('concrete_stone', 0.45, 0.12, ln + 0.1, cx, wl.h + 0.06, cz, ry);
    walls.push({ x: cx, z: cz, hw: Math.abs(dx) / 2 + 0.3, hd: Math.abs(dz) / 2 + 0.3, y0: 0, y1: wl.h });
  }
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
    walls.push({ x, z, hw: 1.2, hd: 2.2, y0: 0, y1: 1.4 });
  }
  // phone booths, post boxes, water pump, washing lines
  for (const pb of map.phoneBooths) {
    const ry = (pb.yawDeg * Math.PI) / 180;
    bag.box('render_sage', 1.15, 2.5, 1.15, pb.pos[0], 1.25, pb.pos[1], ry, true);
    bag.box('trim', 0.85, 1.2, 0.06, pb.pos[0] - Math.sin(ry) * 0.56, 1.5, pb.pos[1] - Math.cos(ry) * 0.56, ry);
    bag.box('roof', 1.3, 0.12, 1.3, pb.pos[0], 2.56, pb.pos[1], ry);
    walls.push({ x: pb.pos[0], z: pb.pos[1], hw: 0.65, hd: 0.65, y0: 0, y1: 2.6 });
  }
  for (const [x, z] of map.postBoxes) {
    bag.box('trim', 0.1, 1.0, 0.1, x, 0.5, z);
    bag.box('render_sage', 0.5, 0.65, 0.32, x, 1.25, z);
  }
  for (const [x, z] of map.pumps) {
    bag.cylinder('rust_metal', 0.16, 0.18, 1.1, 8, x, 0.55, z);
    bag.box('rust_metal', 0.12, 0.1, 0.5, x, 0.95, z + 0.2);
    bag.box('rust_metal', 0.06, 0.45, 0.06, x, 1.25, z - 0.06);
  }
  for (let i = 0; i < map.washing.length; i++) {
    const wsh = map.washing[i]!;
    const rand = mulberry32(6000 + i);
    for (const p of [wsh.from, wsh.to]) bag.cylinder('trim', 0.05, 0.06, 2.3, 5, p[0], 1.15, p[1]);
    const dx = wsh.to[0] - wsh.from[0], dz = wsh.to[1] - wsh.from[1];
    const ln = Math.hypot(dx, dz);
    const ry = Math.atan2(dx, dz);
    bag.box('render_bone', 0.02, 0.02, ln, (wsh.from[0] + wsh.to[0]) / 2, 2.1, (wsh.from[1] + wsh.to[1]) / 2, ry);
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.7) / (n + 0.7);
      const mat = rand() < 0.5 ? 'render_bone' : 'render_sage';
      bag.box(mat, 0.03, 0.75 + rand() * 0.3, 0.55 + rand() * 0.4,
        wsh.from[0] + dx * t, 1.68, wsh.from[1] + dz * t, ry);
    }
  }
}

export function buildLevel(scene: THREE.Scene): LevelData {
  const map = mapJson as unknown as MapData;
  const occluders: THREE.Object3D[] = [];
  const bag = new KitBag();
  const walls: WallBox[] = [];
  const surfaces: Surface[] = [];
  const lights: THREE.PointLight[] = [];

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(map.ground.size[0], map.ground.size[1]),
    worldMaterial(map.ground.material),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  for (const p of map.pavements) {
    bag.box('kerb', p.size[0], 0.22, p.size[1], p.pos[0], 0.11, p.pos[1]);
    bag.box('concrete_stone', p.size[0] + 0.3, 0.24, 0.35, p.pos[0], 0.12, p.pos[1] + p.size[1] / 2);
    bag.box('concrete_stone', p.size[0] + 0.3, 0.24, 0.35, p.pos[0], 0.12, p.pos[1] - p.size[1] / 2);
    bag.box('concrete_stone', 0.35, 0.24, p.size[1] + 0.3, p.pos[0] + p.size[0] / 2, 0.12, p.pos[1]);
    bag.box('concrete_stone', 0.35, 0.24, p.size[1] + 0.3, p.pos[0] - p.size[0] / 2, 0.12, p.pos[1]);
    surfaces.push({ kind: 'flat', x: p.pos[0], z: p.pos[1], hw: p.size[0] / 2 + 0.3, hd: p.size[1] / 2 + 0.3, y: 0.22 });
  }

  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(map.plaza.r, map.plaza.r, 0.3, 40),
    worldMaterial(map.plaza.material),
  );
  plaza.position.set(map.plaza.pos[0], 0.15, map.plaza.pos[1]);
  plaza.receiveShadow = true;
  scene.add(plaza);
  occluders.push(plaza);
  surfaces.push({ kind: 'flat', x: map.plaza.pos[0], z: map.plaza.pos[1], hw: map.plaza.r * 0.92, hd: map.plaza.r * 0.92, y: 0.3 });

  const [pw, ph, pd] = map.monument.plinth;
  bag.box('concrete_stone', pw, ph, pd, map.monument.pos[0], ph / 2 + 0.3, map.monument.pos[1], 0, true);
  const [bw2, bh2, bd2] = map.monument.banner;
  bag.box('state_red', bw2, bh2, bd2, map.monument.pos[0], ph + 0.3 + bh2 / 2 + 0.9, map.monument.pos[1]);

  for (const b of map.buildings) building(bag, b, walls, surfaces, lights);
  for (const l of lights) scene.add(l);
  for (const c of map.colliders) {
    walls.push({ x: c.pos[0], z: c.pos[1], hw: c.size[0] / 2, hd: c.size[1] / 2, y0: 0, y1: BIG });
  }

  furniture(bag, map, walls, surfaces);
  bag.build(scene, occluders);

  return {
    walls,
    surfaces,
    occluders,
    waypoints: map.waypoints,
    spawns: map.spawns,
    restricted: map.restricted,
  };
}
