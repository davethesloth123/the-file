// Sound (bible §11): sparse and diegetic. Footsteps synced to the same
// gait phase the locomotion plays, and a city ambience bed. That is all.
// There is NO stinger when a patrol notices you — the state does not
// announce itself; the only cue is the readout and footsteps stopping.
//
// Autoplay policy: the context starts suspended; the first key or click
// resumes it and starts the ambience. Every call before that is a silent
// no-op, never a throw.
import audioJson from '../data/audio.json';

const A = audioJson;

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private lastPhase = -1;
  private roundRobin = 0;
  // tiny LCG for gain/pitch jitter — cosmetic, deterministic
  private jitterState = 12345;

  constructor() {
    const arm = (): void => {
      void this.start();
      removeEventListener('keydown', arm);
      removeEventListener('mousedown', arm);
      removeEventListener('touchstart', arm);
    };
    addEventListener('keydown', arm);
    addEventListener('mousedown', arm);
    addEventListener('touchstart', arm);
  }

  private jitter(): number {
    this.jitterState = (this.jitterState * 48271) % 2147483647;
    return this.jitterState / 2147483647;
  }

  private async start(): Promise<void> {
    if (this.ctx) return;
    const Ctor = (window.AudioContext ?? (window as unknown as
      { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = A.master;
    this.master.connect(this.ctx.destination);
    void this.ctx.resume();
    const load = async (path: string): Promise<void> => {
      try {
        const res = await fetch(import.meta.env.BASE_URL + path);
        const buf = await res.arrayBuffer();
        this.buffers.set(path, await this.ctx!.decodeAudioData(buf));
      } catch { /* a missing file mutes that sound, never crashes the game */ }
    };
    const m = A.manifest;
    await Promise.all([...m.stoneWalk, ...m.stoneHurry, ...m.wood, m.ambience].map(load));
    const amb = this.buffers.get(m.ambience);
    if (amb) {
      const src = this.ctx.createBufferSource();
      src.buffer = amb;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = A.ambience.gain;
      src.connect(g).connect(this.master);
      src.start();
    }
  }

  private play(path: string, gain: number): void {
    if (!this.ctx || !this.master) return;
    const buffer = this.buffers.get(path);
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.detune.value = (this.jitter() * 2 - 1) * A.footsteps.pitchJitterCents;
    const g = this.ctx.createGain();
    g.gain.value = gain * (1 - A.footsteps.gainJitter * this.jitter());
    src.connect(g).connect(this.master);
    src.start();
  }

  /** Feed the player's gait phase every frame; a footstep fires whenever
   *  the phase crosses one of the authored heel-strike points. phase < 0
   *  means not walking (resets the tracker so stopping is silent). */
  step(phase: number, hurrying: boolean, elevated: boolean): void {
    if (phase < 0) {
      this.lastPhase = -1;
      return;
    }
    if (this.lastPhase >= 0) {
      for (const trigger of A.footsteps.phases) {
        const crossed = phase >= this.lastPhase
          ? this.lastPhase < trigger && trigger <= phase
          : trigger > this.lastPhase || trigger <= phase;
        if (crossed) {
          const set = elevated ? A.manifest.wood
            : hurrying ? A.manifest.stoneHurry : A.manifest.stoneWalk;
          const path = set[this.roundRobin++ % set.length]!;
          this.play(path, hurrying ? A.footsteps.gainHurry : A.footsteps.gainWalk);
        }
      }
    }
    this.lastPhase = phase;
  }
}
