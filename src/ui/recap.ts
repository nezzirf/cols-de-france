// Écran de fin de sortie : le récap de la séance, avec de quoi enregistrer la sortie dans un fichier.

import type { RideSummary } from '../app/game';
import { saveRide } from '../app/rideExport';
import { formatTime } from '../hud/hud';
import type { RideSample } from '../sim/rideStats';
import { fr } from './format';
import './recap.css';

export interface RecapOptions {
  name: string;
  summary: RideSummary;
  onMenu(): void;
}

/** Une sortie sans pédalage n'a rien à enregistrer. */
const MIN_SAVED_S = 10;

const stat = (value: string, label: string, hint = ''): string =>
  `<div class="recap-stat"><b>${value}</b><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div>`;

function dateLabel(ms: number): string {
  const label = new Date(ms).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Courbes de la séance : le relief en fond, la puissance en orange et le cardio en rouge. */
function drawRide(canvas: HTMLCanvasElement, samples: RideSample[]): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d')!;
  g.scale(dpr, dpr);
  if (samples.length < 2) return;
  const t1 = samples[samples.length - 1].t;
  const x = (t: number) => (t / t1) * w;
  const line = (value: (s: RideSample) => number, lo: number, hi: number) => (s: RideSample) => h - 6 - ((value(s) - lo) / (hi - lo || 1)) * (h - 12);

  const alt = samples.map((s) => s.altitudeM);
  const yAlt = line((s) => s.altitudeM, Math.min(...alt), Math.max(...alt));
  g.beginPath();
  g.moveTo(0, h);
  for (const s of samples) g.lineTo(x(s.t), yAlt(s));
  g.lineTo(w, h);
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fill();

  // La puissance est lissée sur 10 s : à la seconde, la courbe serait illisible.
  const smooth = samples.map((s, i) => {
    const part = samples.slice(Math.max(0, i - 9), i + 1);
    return { ...s, powerW: part.reduce((a, b) => a + b.powerW, 0) / part.length };
  });
  const yPower = line((s) => s.powerW, 0, Math.max(100, ...smooth.map((s) => s.powerW)) * 1.1);
  g.beginPath();
  smooth.forEach((s, i) => (i === 0 ? g.moveTo(x(s.t), yPower(s)) : g.lineTo(x(s.t), yPower(s))));
  g.strokeStyle = '#ff8a2b';
  g.lineWidth = 2;
  g.stroke();

  const beats = samples.filter((s) => s.heartRateBpm);
  if (beats.length > 1) {
    const bpm = beats.map((s) => s.heartRateBpm!);
    const yHr = line((s) => s.heartRateBpm!, Math.min(...bpm) - 5, Math.max(...bpm) + 5);
    g.beginPath();
    beats.forEach((s, i) => (i === 0 ? g.moveTo(x(s.t), yHr(s)) : g.lineTo(x(s.t), yHr(s))));
    g.strokeStyle = '#ff6b5e';
    g.lineWidth = 1.5;
    g.stroke();
  }
}

export function showRecap(root: HTMLElement, { name, summary, onMenu }: RecapOptions): void {
  const { stats, samples } = summary;
  const screen = document.createElement('div');
  screen.className = 'screen over';
  const segs = summary.results
    .map((r) => {
      const detail = r.isNewPr ? `<span class="pr">Nouveau record</span>` : `<span>record ${formatTime(r.previousPrS ?? 0)}</span>`;
      return `<div class="result-seg"><span>${r.def.name}</span><span>${formatTime(r.timeS)} · ${detail}</span></div>`;
    })
    .join('');
  const saveable = summary.elapsedS >= MIN_SAVED_S && samples.length >= 2;
  const heart = stats.avgHeartRateBpm !== null ? stat(`${Math.round(stats.avgHeartRateBpm)} bpm`, 'Cardio moyen', `max ${Math.round(stats.maxHeartRateBpm!)}`) : '';
  const load = stats.tss !== null ? stat(`${Math.round(stats.tss)}`, 'Charge (TSS)', `intensité ${fr(stats.intensityFactor!, 2)}`) : '';
  screen.innerHTML = `<div class="result recap">
    <h2>Récap de la séance</h2>
    <p class="recap-sub">${name} · ${dateLabel(summary.startedAt)}</p>
    <div class="recap-grid">
      ${stat(formatTime(summary.elapsedS), 'Temps')}
      ${stat(`${fr(summary.distanceKm)} km`, 'Distance')}
      ${stat(`${fr(summary.avgSpeedKmh)} km/h`, 'Vitesse moyenne')}
      ${stat(`${Math.round(stats.elevationGainM)} m`, 'Dénivelé positif')}
      ${stat(`${Math.round(stats.avgPowerW)} W`, 'Puissance moyenne', `max ${Math.round(stats.maxPowerW)} W`)}
      ${stat(`${Math.round(stats.normalizedPowerW)} W`, 'Puissance normalisée')}
      ${stat(stats.avgCadenceRpm > 0 ? `${Math.round(stats.avgCadenceRpm)} rpm` : '--', 'Cadence moyenne')}
      ${stat(`${Math.round(stats.energyKJ)} kJ`, 'Énergie', `≈ ${Math.round(stats.energyKJ)} kcal`)}
      ${heart}
      ${load}
    </div>
    <canvas class="recap-chart" aria-label="Puissance, cardio et relief de la séance"></canvas>
    <p class="recap-legend"><i style="background:#ff8a2b"></i>Puissance <i style="background:#ff6b5e"></i>Cardio <i style="background:rgba(255,255,255,0.3)"></i>Relief</p>
    ${segs}
    <div class="recap-actions">
      <button class="btn primary" data-a="save" ${saveable ? '' : 'disabled'}>Enregistrer la sortie</button>
      <button class="btn recap-menu" data-a="menu">Retour au menu</button>
    </div>
    <p class="recap-note" data-r="note" role="status">${saveable ? 'Le fichier .tcx s’importe dans Strava, Garmin Connect, TrainingPeaks…' : 'Sortie trop courte pour être enregistrée.'}</p>
  </div>`;
  root.appendChild(screen);
  drawRide(screen.querySelector('canvas')!, samples);

  const save = screen.querySelector<HTMLButtonElement>('[data-a="save"]')!;
  const note = screen.querySelector<HTMLElement>('[data-r="note"]')!;
  save.addEventListener('click', () => {
    const file = saveRide({ name, startedAt: summary.startedAt, elapsedS: summary.elapsedS, samples, stats });
    save.textContent = '✓ Sortie enregistrée';
    note.textContent = `Fichier « ${file} » téléchargé : importe-le dans ton service d’entraînement.`;
  });
  screen.querySelector('[data-a="menu"]')!.addEventListener('click', onMenu);
}
