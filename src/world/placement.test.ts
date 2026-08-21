import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../data/content';
import { placementBaseY } from './level';

const content = loadGameContent();

describe('world placement', () => {
  it('uses the authored surface height as the base for outdoor props', () => {
    expect(placementBaseY(content.map, 0, 62)).toBe(0.22);
    expect(placementBaseY(content.map, -47.4, -9.6)).toBe(0.22);
    expect(placementBaseY(content.map, -14.7, -4)).toBe(0.22);
    expect(placementBaseY(content.map, 60, 40)).toBe(0);
    expect(placementBaseY(content.map, 0, -88)).toBe(0.3);
  });

  it('keeps parked-car centres outside building footprints', () => {
    for (const car of content.map.cars) {
      for (const building of content.map.buildings) {
        const yaw = ((building.yawDeg ?? 0) * Math.PI) / 180;
        const dx = car.pos[0] - building.pos[0];
        const dz = car.pos[1] - building.pos[1];
        const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
        const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
        const overlaps = Math.abs(lx) < building.size[0] / 2 + 1
          && Math.abs(lz) < building.size[1] / 2 + 2.2;
        expect(overlaps, `car at ${car.pos.join(',')} overlaps ${building.id}`).toBe(false);
      }
    }
  });

  it('keeps primary building footprints physically separate', () => {
    const buildings = content.map.buildings;
    for (let i = 0; i < buildings.length; i++) {
      for (let j = i + 1; j < buildings.length; j++) {
        const a = buildings[i]!;
        const b = buildings[j]!;
        const overlapX = a.size[0] / 2 + b.size[0] / 2 - Math.abs(a.pos[0] - b.pos[0]);
        const overlapZ = a.size[1] / 2 + b.size[1] / 2 - Math.abs(a.pos[1] - b.pos[1]);
        expect(
          overlapX > 0 && overlapZ > 0,
          `${a.id} footprint overlaps ${b.id} by ${overlapX.toFixed(2)} × ${overlapZ.toFixed(2)} m`,
        ).toBe(false);
      }
    }
  });
});
