import { describe, expect, it } from 'vitest';
import { DriveSequence, parseDriveStages } from './dev-drive';

describe('development drive sequence', () => {
  it('parses, clamps, and advances deterministic controller input', () => {
    const drive = new DriveSequence(parseDriveStages('0,-4,0,1;1,0,1,0.5'));
    expect(drive.sample(0.5)).toEqual({ forward: 0, strafe: -1, hurrying: false });
    expect(drive.sample(0.51)).toEqual({ forward: 1, strafe: 0, hurrying: true });
    expect(drive.sample(0.5)).toBeNull();
  });

  it('ignores malformed and zero-duration stages', () => {
    expect(parseDriveStages('bad;0,1,0,0;1,0,0,2')).toEqual([
      { forward: 1, strafe: 0, hurrying: false, duration: 2 },
    ]);
  });
});
