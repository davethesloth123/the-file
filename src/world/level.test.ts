import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { loadGameContent } from '../data/content';

vi.mock('../render/worldmat', () => ({
  worldMaterial: () => new THREE.MeshBasicMaterial(),
  toonColor: () => new THREE.MeshBasicMaterial(),
}));

import { buildLevel } from './level';

describe('level build smoke test', () => {
  it('constructs the validated Zamostye scene and gameplay metadata', () => {
    const content = loadGameContent();
    const scene = new THREE.Scene();
    const level = buildLevel(scene, content.map);

    expect(scene.children.length).toBeGreaterThan(0);
    expect(level.walls.length).toBeGreaterThan(content.map.buildings.length);
    expect(level.cameraObstacles.length).toBeGreaterThan(0);
    expect(level.surfaces.length).toBeGreaterThan(content.map.pavements.length);
    expect(level.patrols).toHaveLength(content.map.patrols.length);
    expect(level.ambientCast).toHaveLength(content.map.ambientCast.length);
    expect(level.staticActors.map((actor) => actor.id)).toEqual(['grigori', 'vera']);
    expect(level.interactions.fence).toEqual(content.map.spawns['grigori']);
    expect(level.dynamicDoors.records_staff_door).toBeDefined();
  });
});
