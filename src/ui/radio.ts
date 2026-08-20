// The radio (bible §12): left border 2px, paper for the handler, red only
// when the relationship is damaged. Speaker attribution 10px UPPER, message
// 13px sentence case. Messages hold for tuning.interaction.radioHold.
import tuning from '../data/tuning.json';

const MONO = 'SF Mono,Roboto Mono,Menlo,Consolas,monospace';
const HOLD = tuning.interaction.radioHold;

export class Radio {
  private readonly el: HTMLDivElement;
  private readonly who: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private t = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:absolute', 'left:30px', 'bottom:110px', 'max-width:340px',
      'padding:10px 14px', 'background:rgba(20,18,14,0.90)',
      'border-left:2px solid #ded2b8', 'display:none',
    ].join(';');
    this.who = document.createElement('div');
    this.who.style.cssText =
      `color:rgba(222,210,184,0.42);font:10px ${MONO};letter-spacing:0.22em;text-transform:uppercase`;
    this.body = document.createElement('div');
    this.body.style.cssText =
      `color:#ded2b8;font:13px ${MONO};letter-spacing:0.03em;margin-top:5px;line-height:1.5`;
    this.el.append(this.who, this.body);
    root.appendChild(this.el);
  }

  show(speaker: string, text: string, cold = false): void {
    this.who.textContent = speaker;
    this.body.textContent = text;
    this.el.style.borderLeftColor = cold ? '#b8322c' : '#ded2b8';
    this.el.style.display = 'block';
    this.t = HOLD;
  }

  tick(dt: number): void {
    if (this.t > 0 && (this.t -= dt) <= 0) this.el.style.display = 'none';
  }
}
