// Hand-rolled collision, prototype lineage: axis-aligned boxes with vertical
// bands, plus walkable surfaces (floors, landings, stair ramps) so the
// player can climb interiors. Rapier replaces this when physics-grade
// collision is needed; the shapes all come from level data already.
import tuning from '../data/tuning.json';

const P = tuning.player;

export interface WallBox {
  x: number; z: number; hw: number; hd: number;
  id?: string;
  enabled?: boolean;
  /** vertical extent; walls only block a body whose torso band overlaps */
  y0: number; y1: number;
  /** broad gameplay bands such as railings can opt out of camera occlusion */
  camera?: boolean;
}

export interface FlatSurface {
  kind: 'flat';
  x: number; z: number; hw: number; hd: number;
  y: number;
}

export interface StairSurface {
  kind: 'stair';
  x: number; z: number; hw: number; hd: number;
  y: number;
}

export interface RampSurface {
  kind: 'ramp';
  x: number; z: number; hw: number; hd: number;
  /** rises along `axis` from y0 (at min coord) to y1 (at max coord) */
  axis: 'x' | 'z';
  y0: number; y1: number;
}

export type Surface = FlatSurface | StairSurface | RampSurface;

export interface GroundInfo {
  height: number;
  kind: 'road' | Surface['kind'];
}

export class CollisionWorld {
  lastRayHit: WallBox | null = null;

  constructor(
    readonly walls: WallBox[],
    readonly surfaces: Surface[],
    readonly cameraObstacles: WallBox[] = [],
  ) {}

  setWallEnabled(id: string, enabled: boolean): boolean {
    const wall = this.walls.find((candidate) => candidate.id === id);
    if (!wall) return false;
    wall.enabled = enabled;
    return true;
  }

  /** Push (px,pz) out of any wall whose band overlaps a body at foot height py. */
  resolve(px: number, pz: number, py: number, r = P.radius): [number, number] {
    const torso0 = py + P.stepUp;
    const torso1 = py + 1.7;
    // Re-evaluate after each pass: a push away from a railing can otherwise
    // leave the capsule embedded in the landing wall at the same corner.
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const c of this.walls) {
        if (c.enabled === false) continue;
        if (c.y1 <= torso0 || c.y0 >= torso1) continue;
        const dx = px - c.x, dz = pz - c.z;
        const ox = c.hw + r - Math.abs(dx);
        const oz = c.hd + r - Math.abs(dz);
        if (ox > 0 && oz > 0) {
          if (ox < oz) px += Math.sign(dx || 1) * ox;
          else pz += Math.sign(dz || 1) * oz;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return [px, pz];
  }

  /** Height of the highest walkable surface under (px,pz) reachable from py. */
  groundHeight(px: number, pz: number, py: number): number {
    return this.groundInfo(px, pz, py).height;
  }

  groundInfo(px: number, pz: number, py: number): GroundInfo {
    let best = 0;
    let kind: GroundInfo['kind'] = 'road';
    const reach = py + P.stepUp;
    for (const s of this.surfaces) {
      if (Math.abs(px - s.x) > s.hw || Math.abs(pz - s.z) > s.hd) continue;
      let y: number;
      if (s.kind === 'flat' || s.kind === 'stair') {
        y = s.y;
      } else {
        const along = s.axis === 'x' ? px - (s.x - s.hw) : pz - (s.z - s.hd);
        const span = s.axis === 'x' ? s.hw * 2 : s.hd * 2;
        const t = Math.min(1, Math.max(0, along / span));
        y = s.y0 + (s.y1 - s.y0) * t;
      }
      if (y <= reach && y > best) {
        best = y;
        kind = s.kind;
      }
    }
    return { height: best, kind };
  }

  /**
   * Camera obstruction: furthest fraction t in (0,1] of the segment from
   * `from` toward `to` before hitting a wall band. Analytic slab test.
   */
  rayClear(
    fx: number, fy: number, fz: number,
    tx: number, ty: number, tz: number,
    padding = 0,
  ): number {
    let best = 1;
    let bestBox: WallBox | null = null;
    const dx = tx - fx, dy = ty - fy, dz = tz - fz;
    for (const boxes of [this.walls, this.cameraObstacles]) {
      for (const c of boxes) {
        if (c.enabled === false) continue;
        if (c.camera === false) continue;
        let t0 = 0, t1 = 1;
        let ok = true;
        for (const [f, d, lo, hi] of [
          [fx, dx, c.x - c.hw - padding, c.x + c.hw + padding],
          [fy, dy, c.y0 - padding, c.y1 + padding],
          [fz, dz, c.z - c.hd - padding, c.z + c.hd + padding],
        ] as [number, number, number, number][]) {
          if (Math.abs(d) < 1e-9) {
            if (f < lo || f > hi) { ok = false; break; }
          } else {
            let a = (lo - f) / d, b = (hi - f) / d;
            if (a > b) [a, b] = [b, a];
            t0 = Math.max(t0, a); t1 = Math.min(t1, b);
            if (t0 > t1) { ok = false; break; }
          }
        }
        if (ok && t0 > 0.001 && t0 < best) {
          best = t0;
          bestBox = c;
        }
      }
    }
    this.lastRayHit = bestBox;
    return best;
  }
}
