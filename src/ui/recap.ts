// Écran de fin de sortie : le récap de la séance, avec de quoi enregistrer la sortie dans un fichier.

import type { RideSummary } from '../app/game';
import { canShareRide, type RideRecord, saveRide, shareRide } from '../app/rideExport';
import { formatTime } from '../hud/hud';
import { BEST_WINDOWS_S, estimateFtp, powerBests } from '../sim/rideStats';
import { timeInZones, ZONES } from '../sim/zones';
import { fr } from './format';
import { RideChart } from './rideChart';
import './recap.css';

export interface RecapOptions {
  name: string;
  summary: RideSummary;
  ftp: number;
  /** Meilleures puissances d'avant cette sortie, pour repérer les records battus. */
  previousBests?: Record<number, number>;
  /** Propose d'adopter la FTP estimée. */
  onApplyFtp?(ftp: number): void;
  onMenu(): void;
  /** Texte du bouton de retour. */
  menuLabel?: string;
}

/** Une sortie sans pédalage n'a rien à enregistrer. */
const MIN_SAVED_S = 10;
/** En dessous de cet écart, la FTP estimée n'est pas proposée. */
const MIN_FTP_GAP_W = 3;

const STRAVA_UPLOAD = 'https://www.strava.com/upload/select';

const stat = (value: string, label: string, hint = ''): string =>
  `<div class="recap-stat"><b>${value}</b><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div>`;

function dateLabel(ms: number): string {
  const label = new Date(ms).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const windowLabel = (s: number): string => (s < 60 ? `${s} s` : `${s / 60} min`);

export function showRecap(root: HTMLElement, { name, summary, ftp, previousBests, onApplyFtp, onMenu, menuLabel }: RecapOptions): void {
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

  const bests = powerBests(samples);
  const bestCells = BEST_WINDOWS_S.filter((w) => bests[w] !== undefined)
    .map((w) => {
      const before = previousBests?.[w];
      const record = before !== undefined && bests[w] > before;
      return `<div class="recap-best${record ? ' is-record' : ''}"><b>${bests[w]} W</b><span>${windowLabel(w)}</span>${record ? '<small>Record !</small>' : before !== undefined ? `<small>record ${before} W</small>` : ''}</div>`;
    })
    .join('');
  const estimate = estimateFtp(bests[1200]);
  const estimateLine =
    estimate !== null
      ? `<div class="recap-ftp"><span>FTP estimée : <b>${estimate} W</b> <small>(95 % de ta meilleure puissance sur 20 min)</small></span>${
          onApplyFtp && Math.abs(estimate - ftp) >= MIN_FTP_GAP_W ? `<button class="btn" data-a="ftp">Utiliser ${estimate} W</button>` : ''
        }</div>`
      : '';

  const zoneSeconds = timeInZones(samples.map((s) => s.powerW), ftp);
  const zoneTotal = zoneSeconds.reduce((a, b) => a + b, 0);
  const zones =
    zoneTotal > 0
      ? `<h3 class="recap-title">Temps dans chaque zone <small>(FTP ${ftp} W)</small></h3>
         <div class="recap-zones">${ZONES.map((z, i) => (zoneSeconds[i] > 0 ? `<i style="flex:${zoneSeconds[i]};background:${z.color}" title="Z${z.id} ${z.name}"></i>` : '')).join('')}</div>
         <div class="recap-zone-list">${ZONES.map((z, i) => `<span><i style="background:${z.color}"></i>Z${z.id} ${z.name} <b>${formatTime(zoneSeconds[i])}</b></span>`).join('')}</div>`
      : '';

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
    ${
      samples.length >= 2
        ? `<canvas class="recap-chart" aria-label="Puissance, cardio et relief de la séance"></canvas>
    <div class="recap-chart-bar">
      <p class="recap-readout" data-r="readout" aria-live="off"></p>
      <span class="recap-zoom">
        <button class="btn" data-a="zoom-out" aria-label="Dézoomer">−</button>
        <button class="btn" data-a="zoom-in" aria-label="Zoomer">+</button>
        <button class="btn" data-a="zoom-reset" hidden>Tout afficher</button>
      </span>
    </div>
    <p class="recap-legend"><i style="background:#ff8a2b"></i>Puissance <i style="background:#ff6b5e"></i>Cardio <i style="background:rgba(255,255,255,0.3)"></i>Relief <em>Glisse sur la courbe pour zoomer sur un effort</em></p>`
        : ''
    }
    ${bestCells ? `<h3 class="recap-title">Meilleures puissances</h3><div class="recap-bests">${bestCells}</div>${estimateLine}` : ''}
    ${zones}
    ${segs}
    <div class="recap-actions">
      <button class="btn primary" data-a="save" ${saveable ? '' : 'disabled'}>Enregistrer la sortie</button>
      <button class="btn" data-a="share" hidden>Envoyer vers une autre application</button>
      <button class="btn recap-menu" data-a="menu">${menuLabel ?? 'Retour au menu'}</button>
    </div>
    <p class="recap-note" data-r="note" role="status">${saveable ? 'Le fichier .tcx s’importe dans Strava, Garmin Connect, TrainingPeaks…' : 'Sortie trop courte pour être enregistrée.'}</p>
  </div>`;
  root.appendChild(screen);

  const q = <T extends HTMLElement>(selector: string): T => screen.querySelector(selector) as T;
  if (samples.length >= 2) {
    new RideChart(
      { canvas: q('canvas'), readout: q('[data-r="readout"]'), zoomIn: q('[data-a="zoom-in"]'), zoomOut: q('[data-a="zoom-out"]'), reset: q('[data-a="zoom-reset"]') },
      samples,
    );
  }

  const record: RideRecord = { name, startedAt: summary.startedAt, elapsedS: summary.elapsedS, samples, stats };
  const save = q<HTMLButtonElement>('[data-a="save"]');
  const note = q('[data-r="note"]');
  save.addEventListener('click', () => {
    const file = saveRide(record);
    save.textContent = '✓ Sortie enregistrée';
    note.replaceChildren(`Fichier « ${file} » téléchargé : importe-le dans ton service d’entraînement. `);
    const link = document.createElement('a');
    link.href = STRAVA_UPLOAD;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'Ouvrir la page d’envoi de Strava';
    note.appendChild(link);
  });
  const share = q<HTMLButtonElement>('[data-a="share"]');
  if (saveable && canShareRide(record)) {
    share.hidden = false;
    share.addEventListener('click', () => {
      shareRide(record).catch((err) => {
        note.textContent = `Partage impossible : ${err instanceof Error ? err.message : err}`;
      });
    });
  }
  const apply = screen.querySelector<HTMLButtonElement>('[data-a="ftp"]');
  apply?.addEventListener('click', () => {
    onApplyFtp?.(estimate!);
    apply.textContent = `✓ FTP réglée sur ${estimate} W`;
    apply.disabled = true;
  });
  q('[data-a="menu"]').addEventListener('click', onMenu);
}
