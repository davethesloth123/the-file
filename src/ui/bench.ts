// Dev tuning bench (Tab). Lets the human — who reviews over a preview URL and
// cannot edit files live — find grade values, then copy them back into
// src/data/tuning.json. Styling follows the interface system in bible §12.
import type { GradePass, GradeUniformName } from '../render/grade';
import { GRADE_UNIFORM_NAMES } from '../render/grade';

const RANGES: Record<GradeUniformName, [min: number, max: number, step: number]> = {
  uSat: [0, 1, 0.01],
  uSepia: [0, 1, 0.01],
  uWarm: [0, 1.5, 0.01],
  uContrast: [0.8, 1.6, 0.01],
  uLift: [0, 1, 0.01],
  uVignette: [0, 1, 0.01],
  uGrain: [0, 0.15, 0.005],
  uRedKeep: [0, 1, 0.01],
  uEdge: [0, 1, 0.01],
  uEdgeDepth: [0.001, 0.08, 0.001],
  uEdgeCrease: [0.001, 0.12, 0.001],
  uEdgeFade: [20, 300, 5],
};

export function createBench(grade: GradePass): void {
  const panel = document.createElement('div');
  panel.style.cssText = [
    'position:fixed', 'top:16px', 'right:16px', 'width:240px', 'z-index:10',
    'background:rgba(20,18,14,0.90)', 'color:#ded2b8',
    'font:10px SF Mono,Roboto Mono,Menlo,Consolas,monospace',
    'letter-spacing:0.08em', 'padding:14px 16px', 'display:none',
    'border:1px solid rgba(222,210,184,0.22)', 'user-select:none',
  ].join(';');

  const title = document.createElement('div');
  title.textContent = 'GRADE BENCH';
  title.style.cssText = 'letter-spacing:0.24em;margin-bottom:10px;color:rgba(222,210,184,0.42)';
  panel.appendChild(title);

  const readouts = new Map<GradeUniformName, HTMLElement>();
  const sliders = new Map<GradeUniformName, HTMLInputElement>();

  for (const name of GRADE_UNIFORM_NAMES) {
    const [min, max, step] = RANGES[name];
    const row = document.createElement('label');
    row.style.cssText = 'display:block;margin-bottom:8px;cursor:pointer';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;margin-bottom:2px';
    const label = document.createElement('span');
    label.textContent = name.slice(1).toUpperCase();
    const value = document.createElement('span');
    head.append(label, value);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(grade.uniforms[name].value);
    slider.style.cssText = 'width:100%;accent-color:#ded2b8';
    slider.addEventListener('input', () => {
      grade.uniforms[name].value = Number(slider.value);
      sync();
    });

    row.append(head, slider);
    panel.appendChild(row);
    readouts.set(name, value);
    sliders.set(name, slider);
  }

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:12px';
  for (const [text, onClick] of [
    ['RESET', () => { grade.reset(); sync(); }],
    ['COPY JSON', () => { void copyJson(); }],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = [
      'flex:1', 'background:none', 'color:#ded2b8', 'font:inherit',
      'letter-spacing:0.2em', 'padding:6px 0', 'cursor:pointer',
      'border:1px solid rgba(222,210,184,0.42)',
    ].join(';');
    b.addEventListener('click', onClick);
    buttons.appendChild(b);
  }
  panel.appendChild(buttons);

  const note = document.createElement('div');
  note.style.cssText = 'margin-top:8px;color:rgba(222,210,184,0.42)';
  panel.appendChild(note);

  function sync(): void {
    for (const name of GRADE_UNIFORM_NAMES) {
      const v = grade.uniforms[name].value;
      readouts.get(name)!.textContent = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0');
      sliders.get(name)!.value = String(v);
    }
  }

  async function copyJson(): Promise<void> {
    const values = Object.fromEntries(
      GRADE_UNIFORM_NAMES.map((name) => [name, grade.uniforms[name].value]),
    );
    const json = JSON.stringify({ grade: values }, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      note.textContent = 'COPIED — PASTE INTO tuning.json';
    } catch {
      note.textContent = json;
    }
  }

  sync();
  document.body.appendChild(panel);

  addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  });
}
