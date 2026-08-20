// Pipeline-verification scene only: a ground plane and three boxes under the
// bible's §8 sky, fog and sun, in pre-warmed base materials. No gameplay, no
// tuning values. Session 1 proper replaces this bootstrap with the fixed-step
// clock and the grade pass.
import * as THREE from 'three';

const P = {
  road: 0x46423a,
  ochre: 0xc09550,
  sage: 0x77785f,
  bone: 0xb4a88e,
} as const;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb3a992);
scene.fog = new THREE.Fog(0xb3a992, 52, 180);

const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 400);
camera.position.set(8, 5, 12);
camera.lookAt(0, 1, 0);

const sun = new THREE.DirectionalLight(0xffeec4, 1.2);
sun.position.set(30, 45, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 30;
sun.shadow.camera.bottom = -30;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xc4baa2, 0x453c2c, 0.6));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.MeshLambertMaterial({ color: P.road }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const boxes: [number, number, number, number][] = [
  [-4, 0, 3, P.ochre],
  [0, -2, 6, P.sage],
  [5, 1, 2, P.bone],
];
for (const [x, z, h, color] of boxes) {
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(3, h, 3),
    new THREE.MeshLambertMaterial({ color }),
  );
  box.position.set(x, h / 2, z);
  box.castShadow = box.receiveShadow = true;
  scene.add(box);
}

function resize(): void {
  const dpr = Math.min(devicePixelRatio, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

renderer.setAnimationLoop(() => renderer.render(scene, camera));
