import * as THREE from 'three';

// The grade was authored against r128's gamma-naive pipeline: hex colours go
// in untouched and the shader operates on what you see. Modern three.js would
// otherwise convert colours to linear and re-encode on output, which shifts
// all three tint anchors. Keep the whole pipeline passthrough so the anchors
// mean what the bible says they mean.
THREE.ColorManagement.enabled = false;

export function createRenderer(): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}
