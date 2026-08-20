// Hand-rolled collision, prototype lineage: axis-aligned boxes with vertical
// bands, plus walkable surfaces (floors, landings, stair ramps) so the
// player can climb interiors. Rapier replaces this when physics-grade
// collision is needed; the shapes all come from level data already.
import tuning from '../data/tuning.json';

const P = tuning.player;

export interface WallBox {
  x: number; z: number; hw: number; hd: number;
  /** vertical extent; walls only block a body whose torso band overlaps */
  y0: number; y1: number;
}

export interface FlatSurface {
  kind: 'flat';
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

export type Surface = FlatSurface | RampSurface;

export class CollisionWorld {
  constructor(
    readonly walls: WallBox[],
    readonly surfaces: Surface[],
  ) {}

  /** Push (px,pz) out of any wall whose band overlaps a body at foot height py. */
  resolve(px: number, pz: number, py: number, r = P.radius): [number, number] {
    const torso0 = py + P.stepUp;
    const torso1 = py + 1.7;
    for (const c of this.walls) {
      if (c.y1 <= torso0 || c.y0 >= torso1) continue;
      const dx = px - c.x, dz = pz - c.z;
      const ox = c.hw + r - Math.abs(dx);
      const oz = c.hd + r - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) px += Math.sign(dx || 1) * ox;
        else pz += Math.sign(dz || 1) * oz;
      }
    }
    return [px, pz];
  }

  /** Height of the highest walkable surface under (px,pz) reachable from py. */
  groundHeight(px: number, pz: number, py: number): number {
    let best = 0;
    const reach = py + P.stepUp;
    for (const s of this.surfaces) {
      if (Math.abs(px - s.x) > s.hw || Math.abs(pz - s.z) > s.hd) continue;
      let y: number;
      if (s.kind === 'flat') {
        y = s.y;
      } else {
        const along = s.axis === 'x' ? px - (s.x - s.hw) : pz - (s.z - s.hd);
        const span = s.axis === 'x' ? s.hw * 2 : s.hd * 2;
        const t = Math.min(1, Math.max(0, along / span));
        y = s.y0 + (s.y1 - s.y0) * t;
      }
      if (y <= reach && y > best) best = y;
    }
    return best;
  }

  /**
   * Camera obstruction: furthest fraction t in (0,1] of the segment from
   * `from` toward `to` before hitting a wall band. Analytic slab test.
   */
  rayClear(
    fx: number, fy: number, fz: number,
    tx: number, ty: number, tz: number,
  ): number {
    let best = 1;
    const dx = tx - fx, dy = ty - fy, dz = tz - fz;
    for (const c of this.walls) {
      let t0 = 0, t1 = 1;
      let ok = true;
      for (const [f, d, lo, hi] of [
        [fx, dx, c.x - c.hw, c.x + c.hw],
        [fy, dy, c.y0, c.y1],
        [fz, dz, c.z - c.hd, c.z + c.hd],
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
      if (ok && t0 > 0.001 && t0 < best) best = t0;
    }
    return best;
  }
}
