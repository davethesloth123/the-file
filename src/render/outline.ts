// Outline shells for skinned meshes. Scaling a SkinnedMesh scales about the
// mesh origin at the feet, so the outline grows upward and floats off the
// ground. Instead: clone the geometry, push each vertex 16mm along its own
// normal (bible §9), and bind the shell to the SAME skeleton, drawn BackSide.
// (Post-process depth+normal edge pass is the ship-quality answer; shell is
// the sanctioned MVP approach.)
import * as THREE from 'three';

const SHELL_THICKNESS = 0.016;

const OUTLINE_MATERIAL = new THREE.MeshBasicMaterial({
  color: 0x231d15,
  side: THREE.BackSide,
});

const shellGeometryCache = new Map<string, THREE.BufferGeometry>();

function shellGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  let geo = shellGeometryCache.get(source.uuid);
  if (!geo) {
    geo = source.clone();
    const p = geo.attributes.position as THREE.BufferAttribute;
    const n = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      p.setXYZ(
        i,
        p.getX(i) + n.getX(i) * SHELL_THICKNESS,
        p.getY(i) + n.getY(i) * SHELL_THICKNESS,
        p.getZ(i) + n.getZ(i) * SHELL_THICKNESS,
      );
    }
    p.needsUpdate = true;
    shellGeometryCache.set(source.uuid, geo);
  }
  return geo;
}

/** Adds an inverted-hull shell alongside `body`, bound to the same skeleton. */
export function addOutlineShell(body: THREE.SkinnedMesh): THREE.SkinnedMesh {
  const shell = new THREE.SkinnedMesh(shellGeometry(body.geometry), OUTLINE_MATERIAL);
  shell.bind(body.skeleton, body.bindMatrix);
  shell.castShadow = false;
  shell.name = `${body.name}_outline`;
  body.parent?.add(shell);
  return shell;
}
