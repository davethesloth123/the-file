import type * as THREE from 'three';

export interface SceneRenderStats {
  calls: number;
  triangles: number;
  lines: number;
  points: number;
}

/** Snapshot the current pass before a later post-process render mutates it. */
export function readRenderStats(renderer: THREE.WebGLRenderer): SceneRenderStats {
  const render = renderer.info.render;
  return {
    calls: render.calls,
    triangles: render.triangles,
    lines: render.lines,
    points: render.points,
  };
}
