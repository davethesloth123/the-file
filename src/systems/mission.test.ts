// Mission runner: the closed objective set, reveal gating, flags, failure.
// Uses the real "Ordinary Traffic" data where possible — the tutorial IS
// the spec.
import { describe, expect, it } from 'vitest';
import tuning from '../data/tuning.json';
import conductJson from '../data/conduct.json';
import ordinaryTraffic from '../data/missions/ordinary_traffic.json';
import { MissionRunner, type MissionDef } from './mission';

const STEP = 1 / 60;
const OT = ordinaryTraffic as unknown as MissionDef;
const FULL = { file: 0, confidence: 100 };

function run(m: MissionRunner, seconds: number, x: number, z: number, held: boolean,
  meters = FULL): void {
  for (let t = 0; t < seconds; t += STEP) m.step(STEP, x, z, held, meters);
}

describe('ordinary traffic', () => {
  it('queues the brief on start', () => {
    const m = new MissionRunner(OT);
    expect(m.radioQueue).toContain('handler.brief.ordinary_traffic');
  });

  it('hold_at completes only after the full hold, at the drop, holding F', () => {
    const m = new MissionRunner(OT);
    const [x, z] = OT.objectives[0]!.pos!;
    run(m, 1.0, x, z, true);
    expect(m.index).toBe(0); // 1s of a 2.6s hold
    run(m, 2.0, x, z, true);
    expect(m.index).toBe(1);
    expect(m.flags['carrying']).toBe(true);
    expect(m.radioQueue).toContain('handler.now_carrying');
  });

  it('releasing F resets the hold — no banked progress', () => {
    const m = new MissionRunner(OT);
    const [x, z] = OT.objectives[0]!.pos!;
    run(m, 2.0, x, z, true);
    run(m, 0.1, x, z, false);
    run(m, 2.0, x, z, true);
    expect(m.index).toBe(0); // 2.0 < 2.6 both times
  });

  it('servicing reports the service conduct while holding, and only then', () => {
    const m = new MissionRunner(OT);
    const [x, z] = OT.objectives[0]!.pos!;
    expect(m.activeConductId()).toBeNull();
    run(m, 1.0, x, z, true);
    expect(m.activeConductId()).toBe('service');
    run(m, 0.1, x, z, false);
    expect(m.activeConductId()).toBeNull();
  });

  it('carrying applies the operational multiplier from conduct.json', () => {
    const m = new MissionRunner(OT);
    expect(m.multiplier()).toBe(1);
    m.flags['carrying'] = true;
    expect(m.multiplier()).toBe(conductJson.multipliers.operational);
  });

  it('the exit is revealed at confidence 33 and withheld below', () => {
    const m = new MissionRunner(OT);
    const exit = OT.objectives[1]!;
    expect(m.revealed(exit, { file: 0, confidence: 100 })).toBe(true);
    expect(m.revealed(exit, { file: 0, confidence: 33 })).toBe(true);
    expect(m.revealed(exit, { file: 0, confidence: 32 })).toBe(false);
  });

  it('an unrevealed exit still works — intel is withheld, never wrong', () => {
    const m = new MissionRunner(OT);
    const [dx, dz] = OT.objectives[0]!.pos!;
    run(m, 3.0, dx, dz, true);
    const [ex, ez] = OT.objectives[1]!.pos!;
    const lowIntel = { file: 0, confidence: 0 };
    run(m, 0.1, ex, ez, false, lowIntel);
    expect(m.status).toBe('complete');
  });

  it('reach completes inside the tuned radius and not outside it', () => {
    const m = new MissionRunner(OT);
    const [dx, dz] = OT.objectives[0]!.pos!;
    run(m, 3.0, dx, dz, true);
    const [ex, ez] = OT.objectives[1]!.pos!;
    run(m, 0.1, ex, ez + tuning.interaction.reachRadius + 0.5, false);
    expect(m.status).toBe('running');
    run(m, 0.1, ex, ez, false);
    expect(m.status).toBe('complete');
  });

  it('fails with the burned ending at file 100', () => {
    const m = new MissionRunner(OT);
    run(m, 0.1, 0, 0, false, { file: 100, confidence: 100 });
    expect(m.status).toBe('failed');
    expect(m.ending).toBe('burned');
  });

  it('cannot fail below the threshold — the tutorial has no fail state short of arrest', () => {
    const m = new MissionRunner(OT);
    run(m, 60, 0, 0, false, { file: 99.9, confidence: 0 });
    expect(m.status).toBe('running');
  });
});

describe('remaining objective types', () => {
  const def = (objectives: MissionDef['objectives']): MissionDef => ({
    id: 't', act: 1, date: '1978-01-01', brief: 'b', objectives,
  });

  it('wait_until completes on mission elapsed time', () => {
    const m = new MissionRunner(def([
      { id: 'w', type: 'wait_until', seconds: 2.0, label: 'Wait' },
    ]));
    run(m, 1.5, 0, 0, false);
    expect(m.status).toBe('running');
    run(m, 0.6, 0, 0, false);
    expect(m.status).toBe('complete');
  });

  it('deliver requires the flag AND the place', () => {
    const m = new MissionRunner(def([
      { id: 'd', type: 'deliver', pos: [5, 5], label: 'Deliver' },
    ]));
    run(m, 0.1, 5, 5, false);
    expect(m.status).toBe('running'); // at the place, not carrying
    m.flags['carrying'] = true;
    run(m, 0.1, 0, 0, false);
    expect(m.status).toBe('running'); // carrying, wrong place
    run(m, 0.1, 5, 5, false);
    expect(m.status).toBe('complete');
  });

  it('talk_to is a short hold within the prompt radius', () => {
    const m = new MissionRunner(def([
      { id: 't', type: 'talk_to', pos: [1, 1], label: 'Talk' },
    ]));
    run(m, tuning.interaction.talkHold + 0.1, 1, 1, true);
    expect(m.status).toBe('complete');
  });
});
