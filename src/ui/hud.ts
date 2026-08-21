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
  /** Handler confidence: 6px track, fills paper (bible §12). */
  setConfidence(value: number, note: string): void;
  /** Objective bottom-left, sentence case, with a distance readout. */
  setObjective(label: string | null, distance: string | null): void;
  /** Action prompt bottom-centre: keycap + label; progress 0..1 while a
   *  hold is running; optional line under it (red). Pass key null for an
   *  information-only prompt with no keycap. */
  setPrompt(label: string | null, progress: number, sub: string | null, key?: string | null): void;
  /** Roubles, top-right under confidence. */
  setMoney(value: number): void;
  /** Kit lines bottom-right: diversion charges, pattern intel, exfil. */
  setKit(lines: { text: string; dim: boolean }[]): void;
  notify(title: string, text: string, tone?: 'neutral' | 'good' | 'warning'): void;
  tick(dt: number): void;
  /** End card. Fires once; the button reloads the run. */
  showEnd(title: string, body: string, colour: string, button: string): void;
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

  // handler confidence under the file: 6px track, 1px border, fills paper
  const confLabelRow = document.createElement('div');
  confLabelRow.style.cssText =
    'display:flex;justify-content:space-between;width:132px;margin-top:14px;align-items:baseline';
  const confLabel = document.createElement('span');
  confLabel.textContent = 'CONFIDENCE';
  confLabel.style.cssText = `color:${MUTE};font:10px ${MONO};letter-spacing:0.24em`;
  const confValue = document.createElement('span');
  confValue.style.cssText = `color:${PAPER};font:700 12px ${MONO}`;
  confLabelRow.append(confLabel, confValue);
  const confTrack = document.createElement('div');
  confTrack.style.cssText =
    'width:132px;height:6px;border:1px solid rgba(222,210,184,0.22);margin-top:5px';
  const confFill = document.createElement('div');
  confFill.style.cssText = `height:100%;background:${PAPER};width:0%`;
  confTrack.appendChild(confFill);
  const confNote = document.createElement('div');
  confNote.style.cssText =
    `color:${MUTE};font:10px ${MONO};letter-spacing:0.08em;margin-top:5px;text-transform:uppercase`;
  // money: earned in the street, spent at counters — gains read gold (§12)
  const moneyRow = document.createElement('div');
  moneyRow.style.cssText =
    `color:#cbb37a;font:700 13px ${MONO};letter-spacing:0.08em;margin-top:12px`;
  moneyRow.textContent = '₽ 0';
  fileBox.append(confLabelRow, confTrack, confNote, moneyRow);
  root.appendChild(fileBox);

  // bottom-left: the errand, sentence case (design canvas), with distance
  const objBox = document.createElement('div');
  objBox.style.cssText = 'position:absolute;left:30px;bottom:24px';
  const objLabel = document.createElement('div');
  objLabel.style.cssText = `color:${PAPER};font:13px ${MONO};letter-spacing:0.02em`;
  const objDist = document.createElement('div');
  objDist.style.cssText = `color:${MUTE};font:10px ${MONO};letter-spacing:0.16em;margin-top:4px`;
  objBox.append(objLabel, objDist);
  root.appendChild(objBox);

  // Short-lived world and objective feedback. This is prose, not a marker:
  // discoveries are acknowledged without turning the environment into UI.
  const feedback = document.createElement('aside');
  feedback.dataset.testid = 'feedback';
  feedback.style.cssText = [
    'position:absolute', 'left:30px', 'bottom:82px', 'max-width:430px',
    'display:none', 'padding:11px 14px 12px', 'background:rgba(20,18,14,0.9)',
    'border-left:2px solid rgba(222,210,184,0.45)',
  ].join(';');
  const feedbackTitle = document.createElement('div');
  feedbackTitle.style.cssText = `color:#b99d68;font:700 9px ${MONO};letter-spacing:0.22em;text-transform:uppercase`;
  const feedbackText = document.createElement('div');
  feedbackText.style.cssText = `color:${PAPER};font:11px ${MONO};line-height:1.55;margin-top:5px`;
  feedback.append(feedbackTitle, feedbackText);
  root.appendChild(feedback);
  const feedbackQueue: { title: string; text: string; tone: 'neutral' | 'good' | 'warning' }[] = [];
  let feedbackRemaining = 0;
  const showNextFeedback = (): void => {
    const next = feedbackQueue.shift();
    if (!next) {
      feedback.style.display = 'none';
      return;
    }
    feedbackTitle.textContent = next.title;
    feedbackText.textContent = next.text;
    feedback.style.borderLeftColor = next.tone === 'warning'
      ? '#b8322c' : next.tone === 'good' ? '#b99d68' : 'rgba(222,210,184,0.45)';
    feedback.style.display = 'block';
    feedbackRemaining = Math.min(7.5, Math.max(3.2, next.text.length / 24));
  };

  // bottom-centre: the action prompt — keycap in a 1px outlined box
  const promptBox = document.createElement('div');
  promptBox.style.cssText = [
    'position:absolute', 'bottom:56px', 'left:50%', 'transform:translateX(-50%)',
    'padding:9px 16px', 'background:rgba(20,18,14,0.88)', 'display:none',
    'text-align:center',
  ].join(';');
  const promptRow = document.createElement('div');
  promptRow.style.cssText = `color:${PAPER};font:12px ${MONO};letter-spacing:0.06em`;
  const promptKey = document.createElement('span');
  promptKey.textContent = 'F';
  promptKey.style.cssText = [
    'display:inline-block', 'border:1px solid rgba(222,210,184,0.55)',
    'padding:1px 7px', 'margin-right:9px', `font:700 11px ${MONO}`,
  ].join(';');
  const promptLabel = document.createElement('span');
  promptRow.append(promptKey, promptLabel);
  const promptTrack = document.createElement('div');
  promptTrack.style.cssText =
    'height:3px;background:rgba(222,210,184,0.18);margin-top:7px;display:none';
  const promptFill = document.createElement('div');
  promptFill.style.cssText = `height:100%;background:${PAPER};width:0%`;
  promptTrack.appendChild(promptFill);
  const promptSub = document.createElement('div');
  promptSub.style.cssText =
    'color:#b8322c;font:10px ' + MONO + ';letter-spacing:0.08em;margin-top:6px;display:none';
  promptBox.append(promptRow, promptTrack, promptSub);
  root.appendChild(promptBox);

  // end card: full-screen, shown once, reload to run again
  const card = document.createElement('div');
  card.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(14,12,9,0.94)', 'display:none',
    'align-items:center', 'justify-content:center', 'text-align:center',
    'pointer-events:auto', 'z-index:9',
  ].join(';');
  root.appendChild(card);

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
  keysHint.innerHTML = 'WASD MOVE · SHIFT HURRY · DRAG LOOK<br>E INTERACT · F LEGACY · G DIVERSION · V CAMERA';
  root.appendChild(keysHint);

  // kit lines above the controls hint: what Andrei is holding and knows
  const kitBox = document.createElement('div');
  kitBox.style.cssText = [
    'position:absolute', 'bottom:68px', 'right:30px', 'text-align:right',
    `font:10px ${MONO}`, 'letter-spacing:0.14em', 'line-height:2.0',
  ].join(';');
  root.appendChild(kitBox);

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
    setConfidence(value: number, noteText: string): void {
      confValue.textContent = String(Math.round(value));
      confFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
      confNote.textContent = noteText;
    },
    setObjective(label: string | null, distance: string | null): void {
      objLabel.textContent = label ?? '';
      objDist.textContent = distance ?? '';
    },
    setPrompt(label: string | null, progress: number, sub: string | null, key: string | null = 'E'): void {
      if (!label) {
        promptBox.style.display = 'none';
        return;
      }
      promptBox.style.display = 'block';
      promptLabel.textContent = label;
      promptKey.textContent = key ?? '';
      promptKey.style.display = key && progress <= 0 ? 'inline-block' : 'none';
      promptTrack.style.display = progress > 0 ? 'block' : 'none';
      promptFill.style.width = `${Math.round(progress * 100)}%`;
      promptSub.style.display = sub ? 'block' : 'none';
      promptSub.textContent = sub ?? '';
    },
    setMoney(value: number): void {
      moneyRow.textContent = `₽ ${Math.round(value)}`;
    },
    setKit(lines: { text: string; dim: boolean }[]): void {
      kitBox.innerHTML = '';
      for (const line of lines) {
        const el = document.createElement('div');
        el.textContent = line.text;
        el.style.color = line.dim ? 'rgba(222,210,184,0.22)' : 'rgba(222,210,184,0.55)';
        kitBox.appendChild(el);
      }
    },
    notify(title, text, tone = 'neutral'): void {
      feedbackQueue.push({ title, text, tone });
      if (feedback.style.display === 'none') showNextFeedback();
    },
    tick(dt): void {
      if (feedback.style.display === 'none') return;
      feedbackRemaining -= dt;
      if (feedbackRemaining <= 0) showNextFeedback();
    },
    showEnd(title: string, body: string, colour: string, button: string): void {
      if (card.style.display === 'flex') return;
      const inner = document.createElement('div');
      const eyebrow = document.createElement('div');
      eyebrow.textContent = 'ZAMOSTYE · X.1978';
      eyebrow.style.cssText =
        `color:${colour};font:10px ${MONO};letter-spacing:0.3em;margin-bottom:18px`;
      const h = document.createElement('div');
      h.textContent = title.toUpperCase();
      h.style.cssText =
        `color:${PAPER};font:700 clamp(40px,7vw,70px) ${MONO};letter-spacing:-0.03em`;
      const sub = document.createElement('div');
      sub.innerHTML = body;
      sub.style.cssText =
        `color:${MUTE};font:13px ${MONO};letter-spacing:0.03em;margin-top:16px;line-height:1.7;max-width:420px`;
      const btn = document.createElement('button');
      btn.textContent = button;
      btn.style.cssText = [
        `color:${PAPER}`, 'background:none', 'border:1px solid rgba(222,210,184,0.4)',
        `font:12px ${MONO}`, 'letter-spacing:0.2em', 'padding:10px 30px',
        'margin-top:28px', 'cursor:pointer',
      ].join(';');
      btn.onclick = () => location.reload();
      inner.append(eyebrow, h, sub, btn);
      card.appendChild(inner);
      card.style.display = 'flex';
    },
  };
}
