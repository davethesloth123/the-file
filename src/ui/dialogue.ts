import type { DialogueView } from '../systems/dialogue';

const MONO = 'SF Mono,Roboto Mono,Menlo,Consolas,monospace';
const PAPER = '#ded2b8';
const MUTE = 'rgba(222,210,184,0.58)';

export interface DialogueUi {
  readonly visible: boolean;
  show(
    view: DialogueView,
    resolve: (key: string) => string,
    choose: (responseId: string) => void,
    close: () => void,
  ): void;
  hide(): void;
}

/** Restrained, screen-bottom conversation panel. It uses ordinary text and
 * numbered responses—no portraits, giant speech bubbles, or world outlines. */
export function createDialogueUi(parent: HTMLElement): DialogueUi {
  const root = document.createElement('section');
  root.dataset.testid = 'dialogue';
  root.style.cssText = [
    'position:fixed', 'left:50%', 'bottom:5vh', 'transform:translateX(-50%)',
    'width:min(720px,calc(100vw - 48px))', 'display:none',
    'background:rgba(18,16,12,0.95)', 'border-top:1px solid rgba(222,210,184,0.38)',
    'box-shadow:0 16px 46px rgba(0,0,0,0.38)', 'padding:18px 22px 16px',
    'pointer-events:auto', 'z-index:20',
  ].join(';');
  const speaker = document.createElement('div');
  speaker.style.cssText = `color:#b99d68;font:700 10px ${MONO};letter-spacing:0.24em;text-transform:uppercase`;
  const line = document.createElement('div');
  line.style.cssText = `color:${PAPER};font:14px ${MONO};line-height:1.65;margin-top:9px`;
  const responses = document.createElement('div');
  responses.style.cssText = 'display:flex;flex-direction:column;gap:5px;margin-top:14px';
  const leaveHint = document.createElement('div');
  leaveHint.textContent = 'ESC · END CONVERSATION';
  leaveHint.style.cssText = `color:${MUTE};font:9px ${MONO};letter-spacing:0.16em;text-align:right;margin-top:11px`;
  root.append(speaker, line, responses, leaveHint);
  parent.appendChild(root);

  let currentChoose: ((responseId: string) => void) | null = null;
  let currentClose: (() => void) | null = null;
  let responseIds: string[] = [];

  const keyHandler = (event: KeyboardEvent): void => {
    if (root.style.display === 'none') return;
    if (event.key === 'Escape') {
      event.preventDefault();
      currentClose?.();
      return;
    }
    const index = Number(event.key) - 1;
    const id = Number.isInteger(index) ? responseIds[index] : undefined;
    if (!id) return;
    event.preventDefault();
    currentChoose?.(id);
  };
  addEventListener('keydown', keyHandler);

  return {
    get visible(): boolean { return root.style.display !== 'none'; },
    show(view, resolve, choose, close): void {
      root.style.display = 'block';
      speaker.textContent = resolve(view.speaker);
      line.textContent = resolve(view.text);
      currentChoose = choose;
      currentClose = close;
      responseIds = view.responses.map((response) => response.id);
      responses.innerHTML = '';
      for (let i = 0; i < view.responses.length; i++) {
        const response = view.responses[i]!;
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.responseId = response.id;
        button.style.cssText = [
          'display:grid', 'grid-template-columns:24px 1fr', 'gap:9px', 'width:100%',
          'border:0', 'background:transparent', `color:${MUTE}`, 'padding:5px 0',
          `font:12px ${MONO}`, 'line-height:1.45', 'text-align:left', 'cursor:pointer',
        ].join(';');
        button.innerHTML = `<span style="color:${PAPER}">${i + 1}</span><span></span>`;
        button.lastElementChild!.textContent = resolve(response.text);
        button.onmouseenter = () => { button.style.color = PAPER; };
        button.onmouseleave = () => { button.style.color = MUTE; };
        button.onclick = () => choose(response.id);
        responses.appendChild(button);
      }
    },
    hide(): void {
      root.style.display = 'none';
      responses.innerHTML = '';
      responseIds = [];
      currentChoose = null;
      currentClose = null;
    },
  };
}
