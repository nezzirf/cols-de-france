// HUD minimal pour rouler devant une série ou un film : tout tient dans une ou deux barres, en haut
// et/ou en bas de l'écran, et rien n'est posé sur l'image. La zone du milieu est celle de la vidéo.

import type { RideSnapshot } from '../app/game';
import type { ConnectionState } from '../hardware/types';
import type { WorkoutStep } from '../sim/workout';
import { drawWorkout } from '../ui/charts';
import { formatTime } from './hud';
import './mini.css';

export type BarPlacement = 'haut' | 'bas' | 'les-deux';

export interface MiniHudOptions {
  placement: BarPlacement;
  steps: WorkoutStep[] | null;
  /** Barre flottante : une seule barre, sans zone de vidéo. */
  floating?: boolean;
}

const UPDATE_MS = 200;
/** Écart toléré entre la puissance et la cible avant de colorer le chiffre. */
const ON_TARGET = 0.05;

const fr1 = (v: number): string => v.toFixed(1).replace('.', ',');

function metric(label: string, unit: string, id: string, cls = ''): string {
  return `<div class="mini-metric ${cls}"><span class="mini-label">${label}</span><b data-m="${id}">--</b><small>${unit}</small></div>`;
}

export class MiniHud {
  readonly el: HTMLElement;
  /** Zone entre les barres : c'est là que se place la vidéo capturée. */
  readonly stage: HTMLElement | null;
  private values = new Map<string, HTMLElement>();
  private chart: HTMLCanvasElement | null;
  private status: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private last = 0;

  constructor(
    parent: HTMLElement,
    private options: MiniHudOptions,
  ) {
    const { placement, steps, floating } = options;
    const hasPlan = steps !== null;
    const metrics = `<div class="mini-metrics">
        ${metric('Puissance', 'W', 'power', 'mini-power')}
        ${hasPlan ? metric('Cible', 'W', 'target', 'mini-target') : ''}
        ${metric('Cadence', 'rpm', 'cadence')}
        ${metric('Cardio', 'bpm', 'hr')}
        ${metric('Vitesse', 'km/h', 'speed')}
        ${hasPlan ? metric('Bloc', '', 'left') : ''}
      </div>`;
    const line = `<div class="mini-line">
        ${hasPlan ? '<canvas data-r="chart" aria-label="Déroulé de la séance"></canvas>' : '<span class="mini-fill"></span>'}
        <span class="mini-time" data-r="time">00:00</span>
        <span class="mini-status" data-r="status"></span>
      </div>`;
    const both = placement === 'les-deux' && !floating;
    const top = both ? metrics : placement === 'bas' && !floating ? '' : `${metrics}${line}`;
    const bottom = both ? line : placement === 'bas' && !floating ? `${metrics}${line}` : '';

    this.el = document.createElement('div');
    this.el.className = `mini${floating ? ' mini-floating' : ''}`;
    this.el.innerHTML = `
      ${top ? `<header class="mini-bar mini-top">${top}</header>` : ''}
      ${floating ? '' : '<main class="mini-stage"></main>'}
      ${bottom ? `<footer class="mini-bar mini-bottom">${bottom}</footer>` : ''}
      <div class="mini-toast" data-r="toast" hidden></div>`;
    parent.appendChild(this.el);
    this.stage = this.el.querySelector('.mini-stage');
    this.chart = this.el.querySelector('[data-r="chart"]');
    this.status = this.el.querySelector('[data-r="status"]') as HTMLElement;
    this.toastEl = this.el.querySelector('[data-r="toast"]') as HTMLElement;
    this.el.querySelectorAll<HTMLElement>('[data-m]').forEach((e) => this.values.set(e.dataset.m!, e));
  }

  private set(id: string, text: string): void {
    const e = this.values.get(id);
    if (e && e.textContent !== text) e.textContent = text;
  }

  update(s: RideSnapshot, now: number): void {
    if (now - this.last < UPDATE_MS) return;
    this.last = now;
    const power = Math.round(s.powerW);
    this.set('power', String(power));
    this.set('cadence', String(Math.round(s.cadenceRpm)));
    this.set('hr', s.heartRateBpm === null ? '--' : String(Math.round(s.heartRateBpm)));
    this.set('speed', fr1(s.speedKmh));

    const plan = s.workout;
    const timeEl = this.el.querySelector('[data-r="time"]') as HTMLElement;
    if (plan) {
      this.set('target', String(plan.targetW));
      this.set('left', formatTime(Math.ceil(plan.stepLeftS)));
      timeEl.textContent = `${formatTime(plan.elapsedS)} / ${formatTime(plan.totalS)}`;
      // La couleur dit d'un coup d'œil si l'on tient la consigne, sans lire de chiffre.
      const power$ = this.values.get('power')!;
      const gap = plan.targetW > 0 ? (power - plan.targetW) / plan.targetW : 0;
      power$.dataset.state = plan.targetW === 0 ? '' : Math.abs(gap) <= ON_TARGET ? 'ok' : gap < 0 ? 'low' : 'high';
      if (this.chart && this.options.steps) drawWorkout(this.chart, this.options.steps, { elapsedS: plan.elapsedS, line: 'rgba(255,255,255,0.4)' });
    } else {
      timeEl.textContent = `${formatTime(s.elapsedS)} · ${fr1(s.totalM / 1000)} km`;
    }
  }

  setConnection(label: string, state: ConnectionState): void {
    const names: Record<ConnectionState, string> = {
      connected: 'connecté',
      connecting: 'connexion…',
      reconnecting: 'reconnexion…',
      disconnected: 'déconnecté',
    };
    this.status.textContent = `${label} · ${names[state]}`;
    this.status.dataset.state = state;
  }

  toast(text: string): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), 5000);
  }

  /** Remplace le contenu de la zone du milieu par un message, quand il n'y a pas d'image à montrer. */
  say(text: string): void {
    if (!this.stage) return;
    this.stage.querySelector('.mini-say')?.remove();
    const note = document.createElement('p');
    note.className = 'mini-say';
    note.textContent = text;
    this.stage.appendChild(note);
  }

  dispose(): void {
    clearTimeout(this.toastTimer);
    this.el.remove();
  }
}
