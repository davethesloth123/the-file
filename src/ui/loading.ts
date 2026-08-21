import { str } from '../core/strings';

export interface LoadingScreen {
  ready(): void;
  fail(): void;
}

export function createLoadingScreen(): LoadingScreen {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:30', 'display:flex',
    'align-items:center', 'justify-content:center', 'background:#14120e',
    'color:#ded2b8', 'font:11px SF Mono,Roboto Mono,Menlo,Consolas,monospace',
    'letter-spacing:0.2em', 'text-transform:uppercase',
  ].join(';');
  el.textContent = str('loading.game');
  document.body.appendChild(el);

  return {
    ready(): void {
      el.remove();
    },
    fail(): void {
      el.textContent = str('loading.error');
      el.style.color = '#b8322c';
    },
  };
}
