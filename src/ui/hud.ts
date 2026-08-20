// HUD shell, laid out per the design canvas in reference/design/ (which
// overrides bible §12 where they differ): location top-left, YOUR FILE as
// accumulating page-lines top-right. Values are honest — the file is empty
// until the conduct and file systems land; this is the frame they fill.
const MONO = 'SF Mono,Roboto Mono,Menlo,Consolas,monospace';
const PAPER = '#ded2b8';
const MUTE = 'rgba(222,210,184,0.42)';

export interface Hud {
  setLocation(text: string): void;
  setFilePages(count: number, note: string): void;
  /** The conduct banner: reason and observer count, whenever conduct is
   *  active. A rule the player cannot see is not a rule, it is a trap. */
  setConduct(label: string | null, observers: number): void;
}

export function createHud(): Hud {
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
  document.body.appendChild(root);

  // top-left: place line
  const loc = document.createElement('div');
  loc.style.cssText = [
    'position:absolute', 'top:24px', 'left:30px',
    `color:${MUTE}`, `font:10.5px ${MONO}`, 'letter-spacing:0.2em',
  ].join(';');
  loc.textContent = 'ZAMOSTYE · MOSCOW · X.1978';
  root.appendChild(loc);
  const rule = document.createElement('div');
  rule.style.cssText = 'position:absolute;top:44px;left:30px;width:118px;height:1px;background:rgba(222,210,184,0.28)';
  root.appendChild(rule);

  // top-right: the file as page-lines
  const fileBox = document.createElement('div');
  fileBox.style.cssText = [
    'position:absolute', 'top:24px', 'right:30px',
    'display:flex', 'flex-direction:column', 'align-items:flex-end', 'gap:7px',
  ].join(';');
  const label = document.createElement('div');
  label.textContent = 'YOUR FILE';
  label.style.cssText = `color:${MUTE};font:10.5px ${MONO};letter-spacing:0.24em`;
  fileBox.appendChild(label);
  const pages = document.createElement('div');
  pages.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:2px';
  const pageEls: HTMLDivElement[] = [];
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('div');
    p.style.cssText = `height:2px;width:${34 + ((i * 13) % 46)}px;background:rgba(222,210,184,0.16)`;
    pages.appendChild(p);
    pageEls.push(p);
  }
  fileBox.appendChild(pages);
  const countRow = document.createElement('div');
  countRow.style.cssText = 'display:flex;align-items:baseline;gap:7px';
  const count = document.createElement('span');
  count.style.cssText = `color:${PAPER};font:700 20px ${MONO}`;
  count.textContent = '0';
  const note = document.createElement('span');
  note.style.cssText = `color:${MUTE};font:10px ${MONO};letter-spacing:0.16em`;
  note.textContent = 'NO ADVERSE TRACES';
  countRow.append(count, note);
  fileBox.appendChild(countRow);
  root.appendChild(fileBox);

  // top-centre: the conduct banner (bible §12 — solid red when observed,
  // ink when not)
  const banner = document.createElement('div');
  banner.style.cssText = [
    'position:absolute', 'top:22px', 'left:50%', 'transform:translateX(-50%)',
    'padding:8px 18px', 'text-align:center', 'display:none',
    `font:11px ${MONO}`, 'letter-spacing:0.2em', 'color:#ded2b8',
  ].join(';');
  const bannerReason = document.createElement('div');
  const bannerSub = document.createElement('div');
  bannerSub.style.cssText = `font:10px ${MONO};letter-spacing:0.08em;margin-top:4px;opacity:0.8`;
  banner.append(bannerReason, bannerSub);
  root.appendChild(banner);

  // bottom-right: controls, quietly
  const keysHint = document.createElement('div');
  keysHint.style.cssText = [
    'position:absolute', 'bottom:22px', 'right:30px',
    `color:rgba(222,210,184,0.30)`, `font:10px ${MONO}`, 'letter-spacing:0.18em',
    'text-align:right', 'line-height:1.9',
  ].join(';');
  keysHint.innerHTML = 'WASD MOVE · SHIFT HURRY · DRAG LOOK<br>V CAMERA · TAB BENCH';
  root.appendChild(keysHint);

  return {
    setLocation(text: string): void {
      loc.textContent = text;
    },
    setConduct(label: string | null, observers: number): void {
      if (!label) {
        banner.style.display = 'none';
        return;
      }
      banner.style.display = 'block';
      banner.style.background = observers > 0 ? 'rgba(184,50,44,0.92)' : 'rgba(20,18,14,0.85)';
      bannerReason.textContent = label.toUpperCase();
      bannerSub.textContent = observers > 0
        ? `OBSERVED · ${observers} ${observers === 1 ? 'WATCHER' : 'WATCHERS'}`
        : 'UNOBSERVED';
    },
    setFilePages(n: number, noteText: string): void {
      count.textContent = String(n);
      note.textContent = noteText;
      const filled = Math.round((n / 100) * pageEls.length);
      for (let i = 0; i < pageEls.length; i++) {
        pageEls[i]!.style.background =
          i < filled ? 'rgba(222,210,184,0.82)' : 'rgba(222,210,184,0.16)';
      }
    },
  };
}
