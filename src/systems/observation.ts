// Who sees whom (bible §5.2). One function decides detection, and the drawn
// cone derives from the SAME observer pose and the SAME tuning numbers —
// there is no code path where the rendered fan and the detection cone can
// disagree (pillar III). Line of sight raycasts the same wall set the
// player collides with.
import tuning from '../data/tuning.json';
import type { CollisionWorld } from '../world/collision';

const V = tuning.vision;
export const CONE_RANGE = V.range;
export const CONE_FOV = (V.fovDeg * Math.PI) / 180;

const EYE_HEIGHT = 1.6;
const TARGET_HEIGHT = 1.2;

export interface ObserverPose {
  x: number;
  z: number;
  yaw: number;
}

export function canSee(
  obs: ObserverPose,
  tx: number, tz: number,
  world: CollisionWorld,
): boolean {
  const dx = tx - obs.x, dz = tz - obs.z;
  const dist = Math.hypot(dx, dz);
  if (dist > CONE_RANGE) return false;
  const angleTo = Math.atan2(dx, dz);
  const off = Math.abs(((angleTo - obs.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (off > CONE_FOV / 2) return false;
  return world.rayClear(obs.x, EYE_HEIGHT, obs.z, tx, TARGET_HEIGHT, tz) >= 1;
}
