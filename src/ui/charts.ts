// Petits graphiques des menus et du HUD : profil d'un parcours et déroulé d'une séance.

import { totalDuration, type WorkoutStep, zoneColor } from '../sim/workout';

/** Ajuste le canvas à sa taille affichée pour rester net sur tous les écrans. */
function fit(canvas: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const box = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(box.width * ratio);
  const h = Math.round(box.height * ratio);
  if (w === 0 || h === 0) return null;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const g = canvas.getContext('2d');
  return g && { g, w, h };
}

export interface ProfilePoint {
  km: number;
  ele: number;
}

/** Silhouette d'un parcours ; la partie d'approche est plus discrète que la montée. */
export function drawProfile(canvas: HTMLCanvasElement, points: ProfilePoint[], footKm: number): void {
  const area = fit(canvas);
  if (!area || points.length < 2) return;
  const { g, w, h } = area;
  g.clearRect(0, 0, w, h);
  const lastKm = points[points.length - 1].km;
  const low = Math.min(...points.map((p) => p.ele));
  // Une marge minimale évite qu'un parcours presque plat ressemble à un mur.
  const range = Math.max(120, Math.max(...points.map((p) => p.ele)) - low);
  const x = (km: number) => (km / lastKm) * w;
  const y = (ele: number) => h - 2 - ((ele - low) / range) * (h * 0.86);
  const area_ = (from: number, to: number) => {
    g.beginPath();
    g.moveTo(x(from), h);
    for (const p of points) if (p.km >= from && p.km <= to) g.lineTo(x(p.km), y(p.ele));
    g.lineTo(x(to), h);
    g.closePath();
    g.fill();
  };
  g.fillStyle = 'rgba(255,255,255,0.3)';
  area_(0, footKm);
  g.fillStyle = 'rgba(255,255,255,0.66)';
  area_(footKm, lastKm);
}

export interface WorkoutChartOptions {
  elapsedS?: number;
  selectedBlock?: number | null;
  /** Couleur de la ligne de FTP, selon le fond. */
  line?: string;
}

/** Barres de puissance : la hauteur suit la consigne, la couleur sa zone. */
export function drawWorkout(canvas: HTMLCanvasElement, steps: WorkoutStep[], options: WorkoutChartOptions = {}): void {
  const area = fit(canvas);
  if (!area) return;
  const { g, w, h } = area;
  g.clearRect(0, 0, w, h);
  const total = totalDuration(steps);
  if (total === 0) return;
  const peak = Math.max(135, ...steps.flatMap((s) => [s.fromPct, s.toPct])) * 1.06;
  const y = (pct: number) => h - (pct / peak) * h;
  const pxPerS = w / total;
  const { elapsedS, selectedBlock = null, line = 'rgba(0,0,0,0.3)' } = options;
  for (const s of steps) {
    const x0 = s.startS * pxPerS;
    const width = s.durationS * pxPerS;
    const slices = s.fromPct === s.toPct ? 1 : Math.max(1, Math.ceil(width / 5));
    g.globalAlpha = selectedBlock === null || selectedBlock === s.block ? 1 : 0.42;
    for (let i = 0; i < slices; i++) {
      const pct = s.fromPct + ((s.toPct - s.fromPct) * (i + 0.5)) / slices;
      g.fillStyle = zoneColor(pct);
      const left = x0 + (width * i) / slices;
      // Le léger recouvrement évite un fil clair entre deux tranches d'une rampe.
      g.fillRect(left, y(pct), width / slices + 0.6, h - y(pct));
    }
  }
  g.globalAlpha = 1;
  g.strokeStyle = line;
  g.setLineDash([6, 6]);
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, y(100));
  g.lineTo(w, y(100));
  g.stroke();
  g.setLineDash([]);
  if (elapsedS !== undefined) {
    const cursor = Math.min(w, elapsedS * pxPerS);
    g.fillStyle = 'rgba(0,0,0,0.42)';
    g.fillRect(0, 0, cursor, h);
    g.fillStyle = '#fff';
    g.fillRect(cursor - 1, 0, 2, h);
  }
}
