import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sunOffset } from './atmosphere';

describe('sunOffset', () => {
  it('uses the authored azimuth/elevation convention and radius', () => {
    const offset = sunOffset({
      skyColor: '#000000', skyZenith: '#000000', skyHorizon: '#000000',
      sunAzimuthDeg: 225, sunElevationDeg: 21, sunColor: '#ffffff', sunIntensity: 1,
      hemiSky: '#ffffff', hemiGround: '#000000', hemiIntensity: 1,
      shadowMapSize: 1024, shadowExtent: 60, shadowNormalBias: 0.05, shadowFar: 250,
    });
    expect(offset.length()).toBeCloseTo(150, 5);
    expect(offset.x).toBeLessThan(0);
    expect(offset.y).toBeGreaterThan(0);
    expect(offset.z).toBeLessThan(0);
    expect(THREE.MathUtils.radToDeg(Math.asin(offset.y / offset.length())))
      .toBeCloseTo(21, 5);
  });
});
