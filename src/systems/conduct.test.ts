// The null case comes first and stays green forever (CLAUDE.md): walk
// through a patrol cone for sixty seconds and the file is EXACTLY zero.
// That single assertion protects the entire design thesis — presence is
// free, conduct is priced.
import { describe, it, expect } from 'vitest';
import { evaluateConduct, type ConductState } from './conduct';
import { FileMeter } from './file';

const SIM_DT = 1 / 60;

function state(over: Partial<ConductState> = {}): ConductState {
  return {
    servicing: false,
    talkingToFlagged: false,
    afterCurfew: false,
    restrictedLabel: null,
    hurrying: false,
    moving: true,
    stillSeconds: 0,
    atBench: false,
    offDistrict: false,
    ...over,
  };
}

describe('the null case', () => {
  it('walking through a cone for 60 seconds accrues exactly zero', () => {
    const file = new FileMeter();
    for (let step = 0; step < 60 * 60; step++) {
      const conduct = evaluateConduct(state());
      // fully observed the whole time, by several watchers
      file.accrue(conduct, 3, 1, SIM_DT);
    }
    expect(file.value).toBe(0);
  });

  it('standing observed under the loitering threshold accrues exactly zero', () => {
    const file = new FileMeter();
    for (let step = 0; step < 8 * 60; step++) {
      const conduct = evaluateConduct(state({ moving: false, stillSeconds: step * SIM_DT }));
      file.accrue(conduct, 2, 1, SIM_DT);
    }
    expect(file.value).toBe(0);
  });
});

describe('conduct pricing', () => {
  it('running within a cone accrues rate x observers per second', () => {
    const file = new FileMeter();
    const conduct = evaluateConduct(state({ hurrying: true }));
    expect(conduct?.id).toBe('running');
    for (let step = 0; step < 60; step++) file.accrue(conduct, 2, 1, SIM_DT);
    expect(file.value).toBeCloseTo(conduct!.rate * 2, 6);
  });

  it('unobserved conduct accrues nothing', () => {
    const file = new FileMeter();
    const conduct = evaluateConduct(state({ hurrying: true }));
    for (let step = 0; step < 600; step++) file.accrue(conduct, 0, 1, SIM_DT);
    expect(file.value).toBe(0);
  });

  it('only one rule reports, highest in the array', () => {
    const both = evaluateConduct(state({
      servicing: true, hurrying: true, restrictedLabel: 'the station steps',
    }));
    expect(both?.id).toBe('service');
    const two = evaluateConduct(state({ hurrying: true, restrictedLabel: 'the station steps' }));
    expect(two?.id).toBe('threshold');
  });

  it('the threshold rule names the place', () => {
    const conduct = evaluateConduct(state({ restrictedLabel: 'the station steps' }));
    expect(conduct?.label).toBe('Loitering on the station steps');
  });

  it('benches exempt loitering; past nine seconds standing is priced', () => {
    expect(evaluateConduct(state({ moving: false, stillSeconds: 20, atBench: true }))).toBeNull();
    const conduct = evaluateConduct(state({ moving: false, stillSeconds: 9.5 }));
    expect(conduct?.id).toBe('loitering');
  });

  it('the file never decays on its own', () => {
    const file = new FileMeter();
    const conduct = evaluateConduct(state({ hurrying: true }));
    file.accrue(conduct, 1, 1, 1);
    const after = file.value;
    for (let step = 0; step < 6000; step++) file.accrue(null, 0, 1, SIM_DT);
    expect(file.value).toBe(after);
  });
});
