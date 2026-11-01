// HUD : chrono et segments en haut à gauche, métriques en haut au milieu,
// altimétrie du prochain kilomètre et pente en haut à droite. Le centre reste libre.

import type { RideSnapshot } from '../app/game';
import type { ConnectionState } from '../hardware/types';
import { GEAR_COUNT } from '../sim/gears';
import { gradeColor, gradeTextColor } from '../sim/gradeColor';
import type { WorkoutStep } from '../sim/workout';
import type { Route } from '../sim/route';
import type { SegmentStatus } from '../sim/segments';
import { drawWorkout } from '../ui/charts';
import { drawNextKilometer, drawRouteStrip } from './minimap';

const UPDATE_MS = 100;

export function formatTime(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatGap(gapS: number): string {
  const sign = gapS < 0 ? '−' : '+';
  const a = Math.abs(gapS);
  if (a < 60) return `${sign}${a.toFixed(1).replace('.', ',')} s`;
  return `${sign}${Math.floor(a / 60)}:${String(Math.floor(a % 60)).padStart(2, '0')}`;
}

const fr1 = (v: number): string => v.toFixed(1).replace('.', ',');

function metric(label: string, unit: string, id: string, cls = ''): string {
  return `<div class="metric ${cls}"><span class="metric-value" data-m="${id}">--</span><span class="metric-unit">${unit}</span><span class="metric-label">${label}</span></div>`;
}

export class Hud {
  readonly el: HTMLElement;
  private values = new Map<string, HTMLElement>();
  private lastUpdate = 0;
  private toastTimer = 0;
  private profile: HTMLCanvasElement;
  private strip: HTMLCanvasElement;
  private time: HTMLElement;
  private segments: HTMLElement;
  private slope: HTMLElement;
  private slopeValue: HTMLElement;
  private altitude: HTMLElement;
  private doneKm: HTMLElement;
  private leftKm: HTMLElement;
  private progress: HTMLElement;
  private timeLabel: HTMLElement;
  private lap = 0;
  private toastEl: HTMLElement;
  private status: HTMLElement;
  private pause: HTMLElement;
  private hint: HTMLElement;
  private exploreInfo: HTMLElement | null = null;
  private slider: HTMLInputElement | null = null;
  private dragging = false;
  private workout: { steps: WorkoutStep[]; chart: HTMLCanvasElement; target: HTMLElement; left: HTMLElement } | null = null;

  constructor(
    parent: HTMLElement,
    private route: Route,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <section class="hud-left panel">
        <div class="hud-time" data-r="time">00:00</div>
        <div class="hud-time-label" data-r="timeLabel">Temps écoulé</div>
        <div class="hud-route">
          <div class="hud-route-values">
            <div><b data-r="doneKm">0,0</b> km<span data-r="doneLabel">Réalisés</span></div>
            <div><b data-r="leftKm">--</b> km<span data-r="leftLabel">Restants</span></div>
          </div>
          <div class="hud-track"><i data-r="progress"></i><u data-r="foot" title="Pied du col"></u></div>
        </div>
        <div class="hud-segments" data-r="segments"></div>
      </section>
      <section class="hud-center panel">
        ${metric('Vitesse', 'km/h', 'speed', 'metric-main')}
        ${metric('Puissance', 'W', 'power', 'metric-main')}
        ${metric('Cadence', 'rpm', 'cadence')}
        ${metric('Cardio', 'bpm', 'hr')}
        ${metric('Vit. moy.', 'km/h', 'avg')}
        ${metric('Rapport', '/ ' + GEAR_COUNT, 'gear', 'metric-gear')}
      </section>
      <section class="hud-right panel">
        <div class="hud-right-head">
          <div class="slope" data-r="slope"><span data-r="slopeValue">0,0</span><small>%</small></div>
          <div class="hud-right-info">
            <div><span data-r="altitude">--</span> m</div>
            <div class="dim">Altitude</div>
          </div>
        </div>
        <canvas class="profile" data-r="profile" width="560" height="200" aria-label="Profil du prochain kilomètre"></canvas>
        <div class="profile-legend"><span>0 m</span><span>Prochain kilomètre</span><span>1 km</span></div>
        <canvas class="strip" data-r="strip" width="560" height="44" aria-label="Profil complet du parcours"></canvas>
      </section>
      <div class="hud-toast" data-r="toast" hidden></div>
      <div class="hud-status" data-r="status"></div>
      <div class="hud-hint" data-r="hint" hidden></div>
      <div class="hud-pause" data-r="pause" hidden>Pause</div>
    `;
    parent.appendChild(this.el);
    const q = <T extends HTMLElement>(name: string) => this.el.querySelector(`[data-r="${name}"]`) as T;
    this.time = q('time');
    this.segments = q('segments');
    this.slope = q('slope');
    this.slopeValue = q('slopeValue');
    this.altitude = q('altitude');
    this.doneKm = q('doneKm');
    this.leftKm = q('leftKm');
    this.progress = q('progress');
    this.timeLabel = q('timeLabel');
    // Sur une boucle, on compte tous les tours et on annonce ce qui reste avant le suivant.
    q('foot').hidden = route.data.loop !== undefined;
    q('foot').style.left = `${(route.data.footM / route.lengthM) * 100}%`;
    if (route.data.loop) {
      q('doneLabel').textContent = 'Parcourus';
      q('leftLabel').textContent = 'Avant le tour suivant';
    }
    this.profile = q('profile');
    this.strip = q('strip');
    this.toastEl = q('toast');
    this.status = q('status');
    this.pause = q('pause');
    this.hint = q('hint');
    this.el.querySelectorAll<HTMLElement>('[data-m]').forEach((e) => this.values.set(e.dataset.m!, e));
  }

  update(s: RideSnapshot, now: number): void {
    if (now - this.lastUpdate < UPDATE_MS) return;
    this.lastUpdate = now;
    this.time.textContent = formatTime(s.elapsedS);
    this.set('speed', fr1(s.speedKmh));
    this.set('power', String(Math.round(s.powerW)));
    this.set('cadence', String(Math.round(s.cadenceRpm)));
    this.set('hr', s.heartRateBpm === null ? '--' : String(Math.round(s.heartRateBpm)));
    this.set('avg', s.avgSpeedKmh > 0 ? fr1(s.avgSpeedKmh) : '--');

    this.set('gear', String(s.gear ?? '--'));
    (this.el.querySelector('.metric-gear') as HTMLElement).hidden = s.gear === null;

    this.slopeValue.textContent = fr1(s.gradePct);
    this.slope.style.background = gradeColor(s.gradePct);
    this.slope.style.color = gradeTextColor(s.gradePct);
    this.altitude.textContent = String(Math.round(s.altitudeM));
    const loop = this.route.data.loop;
    if (loop) {
      const span = loop.toM - loop.fromM;
      const inLap = Math.max(0, Math.min(span, s.distanceM - loop.fromM));
      this.doneKm.textContent = fr1(s.totalM / 1000);
      this.leftKm.textContent = fr1((span - inLap) / 1000);
      this.progress.style.transform = `scaleX(${inLap / span})`;
      if (s.lap !== this.lap) {
        this.lap = s.lap;
        this.timeLabel.textContent = `Temps écoulé · Tour ${s.lap}`;
      }
    } else {
      const done = Math.min(s.distanceM, this.route.lengthM);
      this.doneKm.textContent = fr1(done / 1000);
      this.leftKm.textContent = fr1((this.route.lengthM - done) / 1000);
      this.progress.style.transform = `scaleX(${done / this.route.lengthM})`;
    }
    drawNextKilometer(this.profile, this.route, s.distanceM);
    drawRouteStrip(this.strip, this.route, s.distanceM);
    this.renderSegments(s.segments);
    this.pause.hidden = !s.paused;
    if (this.workout && s.workout) {
      this.workout.target.textContent = String(s.workout.targetW);
      this.workout.left.textContent = formatTime(Math.ceil(s.workout.stepLeftS));
      drawWorkout(this.workout.chart, this.workout.steps, { elapsedS: s.workout.elapsedS, line: 'rgba(255,255,255,0.5)' });
    }
  }

  private set(id: string, text: string): void {
    const e = this.values.get(id);
    if (e && e.textContent !== text) e.textContent = text;
  }

  private renderSegments(list: SegmentStatus[]): void {
    this.segments.innerHTML = list
      .slice(0, 2)
      .map((s) => {
        const gap =
          s.gapS === null
            ? `<span class="seg-gap none">${s.prTimeS === null ? 'Premier passage' : '--'}</span>`
            : `<span class="seg-gap ${s.gapS <= 0 ? 'ahead' : 'behind'}">${formatGap(s.gapS)}</span>`;
        return `<div class="seg">
          <div class="seg-name">${s.def.name}</div>
          <div class="seg-row">${gap}<span class="seg-time">${formatTime(s.elapsedS)}</span></div>
          <div class="seg-row dim"><span>PR ${s.prTimeS === null ? '--' : formatTime(s.prTimeS)}</span><span>${fr1(s.remainingM / 1000)} km</span></div>
        </div>`;
      })
      .join('');
  }

  /** Bandeau de séance : consigne, temps restant dans le bloc et déroulé complet. */
  showWorkout(steps: WorkoutStep[]): void {
    const box = document.createElement('section');
    box.className = 'hud-workout panel';
    box.innerHTML = `<div class="hud-workout-values">
        <div><b data-w="target">--</b><span>W cible</span></div>
        <div><b data-w="left">--</b><span>Reste</span></div>
      </div>
      <canvas aria-label="Déroulé de la séance"></canvas>`;
    this.el.appendChild(box);
    this.workout = {
      steps,
      chart: box.querySelector('canvas')!,
      target: box.querySelector('[data-w="target"]')!,
      left: box.querySelector('[data-w="left"]')!,
    };
  }

  toast(text: string, strong = false): void {
    this.toastEl.textContent = text;
    this.toastEl.hidden = false;
    this.toastEl.classList.toggle('strong', strong);
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.hidden = true), strong ? 9000 : 5500);
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

  /** Barre de position du mode démo : glisser saute à n'importe quel point du parcours. */
  enableExplore(onSeek: (distM: number) => void): void {
    const box = document.createElement('div');
    box.className = 'hud-explore';
    box.innerHTML = `<input type="range" min="0" max="${this.route.lengthM}" step="10" value="0" aria-label="Position sur le parcours"><div class="explore-info"></div>`;
    this.el.appendChild(box);
    this.slider = box.querySelector('input')!;
    this.exploreInfo = box.querySelector('.explore-info')!;
    const s = this.slider;
    s.addEventListener('pointerdown', () => (this.dragging = true));
    s.addEventListener('input', () => onSeek(Number(s.value)));
    s.addEventListener('change', () => {
      this.dragging = false;
      // Sans cela, les flèches du clavier déplaceraient la barre au lieu de régler la puissance.
      s.blur();
    });
  }

  updateExplore(distM: number, info: string): void {
    if (!this.slider || !this.exploreInfo) return;
    if (!this.dragging) this.slider.value = String(distM);
    this.exploreInfo.textContent = info;
  }

  setHint(text: string | null): void {
    this.hint.hidden = text === null;
    if (text) this.hint.textContent = text;
  }
}
