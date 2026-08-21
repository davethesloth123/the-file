// The economy and the three doors (bible §5.5, §5.7). The structural
// assertion at the end is the session's acceptance criterion: every door
// carries a real cost on a different axis, so none is strictly better.
import { describe, expect, it } from 'vitest';
import prices from '../data/prices.json';
import { Wallet, courierPay, clerkAvailable, stationAvailable } from './economy';
import { FileMeter } from './file';
import { ConfidenceMeter } from './confidence';
import { Patrol } from '../actors/patrol';
import { CollisionWorld } from '../world/collision';

describe('wallet and courier pay', () => {
  it('starts empty — the clerk must be earned', () => {
    expect(new Wallet().value).toBe(prices.start);
  });

  it('refuses payment when short, without taking anything', () => {
    const w = new Wallet();
    w.earn(100);
    expect(w.pay(prices.clerk.price)).toBe(false);
    expect(w.value).toBe(100);
  });

  it('courier pay cycles within the ₽55–85 band', () => {
    const pays = [0, 1, 2, 3, 4].map(courierPay);
    for (const p of pays) {
      expect(p).toBeGreaterThanOrEqual(prices.courier.payBase);
      expect(p).toBeLessThanOrEqual(
        prices.courier.payBase + (prices.courier.paySteps - 1) * prices.courier.payStep,
      );
    }
    expect(pays[4]).toBe(pays[0]);
  });
});

describe('the doors', () => {
  it('the clerk has thresholds: a file worth clearing, money to pay', () => {
    expect(clerkAvailable(prices.clerk.minFile - 1, 999)).toBe('nothing');
    expect(clerkAvailable(50, prices.clerk.price - 1)).toBe('poor');
    expect(clerkAvailable(50, prices.clerk.price)).toBe('ok');
  });

  it('the clerk trades money for file, confidence untouched', () => {
    const w = new Wallet(); w.earn(200);
    const f = new FileMeter(); f.value = 50;
    const c = new ConfidenceMeter();
    const before = c.value;
    w.pay(prices.clerk.price);
    f.transact(prices.clerk.fileCut);
    expect(w.value).toBe(200 - prices.clerk.price);
    expect(f.value).toBe(50 - prices.clerk.fileCut);
    expect(c.value).toBe(before);
  });

  it('the station only listens once the file is past the threshold', () => {
    expect(stationAvailable(prices.station.overFile)).toBe(false);
    expect(stationAvailable(prices.station.overFile + 1)).toBe(true);
  });

  it('informing cuts the file AND the handler, and never below zero', () => {
    const f = new FileMeter(); f.value = 30;
    const c = new ConfidenceMeter();
    f.transact(prices.station.inform.fileCut);
    c.spend(prices.station.inform.confidenceCost);
    expect(f.value).toBe(0); // 30 − 45 floors at zero
    expect(c.value).toBe(100 - prices.station.inform.confidenceCost);
  });

  it('no door is strictly better: each costs on a different axis', () => {
    // clerk: roubles, zero confidence. inform: confidence, zero roubles.
    // run clean: nothing but time (no transaction at all).
    expect(prices.clerk.price).toBeGreaterThan(0);
    expect(prices.station.inform.confidenceCost).toBeGreaterThan(0);
    expect(prices.station.inform.fileCut).toBeGreaterThan(prices.clerk.fileCut);
  });
});

describe('patrols under the economy', () => {
  const world = new CollisionWorld([], []);

  it("Vera's tip slows the beat by the tuned factor", () => {
    const route: [number, number][] = [[0, 0], [0, 100]];
    const a = new Patrol(route, 2.0);
    const b = new Patrol(route, 2.0);
    b.speedFactor = prices.vera.patrolSlow;
    for (let i = 0; i < 60; i++) {
      a.step(1 / 60, 500, 500, false, world);
      b.step(1 / 60, 500, 500, false, world);
    }
    expect(b.z / a.z).toBeCloseTo(prices.vera.patrolSlow, 5);
  });

  it('a diversion pulls the patrol off its beat, then expires', () => {
    const p = new Patrol([[0, 0], [0, 100]], 2.0);
    p.investigate(50, 0, 1.0);
    for (let i = 0; i < 30; i++) p.step(1 / 60, 500, 500, false, world);
    expect(p.x).toBeGreaterThan(0.5); // walking toward the noise
    for (let i = 0; i < 120; i++) p.step(1 / 60, 500, 500, false, world);
    expect(p.z).toBeGreaterThan(p.x); // probe expired, back on the beat
  });
});
