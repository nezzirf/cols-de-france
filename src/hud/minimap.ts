// Profils dessinés sur canvas : prochain kilomètre (zoom) et parcours complet.

import { gradeColor } from '../sim/gradeColor';
import type { Route } from '../sim/route';

const WINDOW_M = 1000;
const BAR_M = 20;
const MIN_RANGE_M = 25;

/** Fond clair : sans lui, les pentes noires disparaîtraient sur un panneau sombre. */
const TRACK = 'rgba(214, 220, 226, 0.26)';

export function drawNextKilometer(canvas: HTMLCanvasElement, route: Route, distM: number): void {
  const g = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  g.fillStyle = TRACK;
  g.fillRect(0, 0, w, h);

  const end = distM + WINDOW_M;
  let lo = Infinity;
  let hi = -Infinity;
  for (let d = distM; d <= end; d += BAR_M) {
    const e = route.eleAt(d);
    lo = Math.min(lo, e);
    hi = Math.max(hi, e);
  }
  // Échelle verticale minimale : un faux-plat ne doit pas ressembler à un mur.
  const span = Math.max(MIN_RANGE_M, hi - lo);
  const base = lo - span * 0.12;
  const top = base + span * 1.3;
  const px = (e: number) => h - ((e - base) / (top - base)) * h;
  const xOf = (d: number) => ((d - distM) / WINDOW_M) * w;

  const first = Math.floor(distM / BAR_M) * BAR_M;
  for (let d = first; d < end; d += BAR_M) {
    const x0 = Math.max(0, xOf(d));
    const x1 = Math.min(w, xOf(d + BAR_M));
    const grade = route.averageGrade(d, d + BAR_M);
    g.fillStyle = gradeColor(grade);
    g.beginPath();
    g.moveTo(x0, h);
    g.lineTo(x0, px(route.eleAt(Math.max(distM, d))));
    g.lineTo(x1, px(route.eleAt(Math.min(end, d + BAR_M))));
    g.lineTo(x1, h);
    g.closePath();
    g.fill();
  }

  // Ligne de crête blanche : elle garde le profil lisible sur les zones noires.
  g.strokeStyle = '#ffffff';
  g.lineWidth = 3;
  g.beginPath();
  for (let d = distM; d <= end; d += BAR_M / 2) {
    const x = xOf(d);
    const y = px(route.eleAt(d));
    if (d === distM) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();

  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(5, px(route.eleAt(distM)), 7, 0, Math.PI * 2);
  g.fill();

  g.font = '600 22px Bahnschrift, "Segoe UI", sans-serif';
  g.textBaseline = 'top';
  g.textAlign = 'right';
  const gain = route.eleAt(end) - route.eleAt(distM);
  const avg = route.averageGrade(distM, end);
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  const label = `${gain >= 0 ? '+' : ''}${Math.round(gain)} m · moy. ${avg.toFixed(1).replace('.', ',')} %`;
  g.strokeText(label, w - 10, 8);
  g.fillText(label, w - 10, 8);
}

/** Barre fine de tout le parcours, avec le pied du col et la position actuelle. */
export function drawRouteStrip(canvas: HTMLCanvasElement, route: Route, distM: number): void {
  const g = canvas.getContext('2d')!;
  const { width: w, height: h } = canvas;
  g.clearRect(0, 0, w, h);
  const { ele, footM, endM } = route.data;
  const lo = Math.min(...ele);
  const hi = Math.max(...ele);
  const y = (e: number) => h - 3 - ((e - lo) / (hi - lo || 1)) * (h - 8);
  const step = endM / w;
  for (let x = 0; x < w; x += 2) {
    const d = x * step;
    g.fillStyle = gradeColor(route.averageGrade(d, d + step * 6));
    g.globalAlpha = d <= distM ? 0.45 : 1;
    g.fillRect(x, y(route.eleAt(d)), 2, h);
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillRect((footM / endM) * w, 0, 2, h);
  g.fillStyle = '#35c8ff';
  g.fillRect((distM / endM) * w - 2, 0, 4, h);
}

/** Vignette de profil pour le menu. */
export function drawClimbCard(canvas: HTMLCanvasElement, route: Route): void {
  drawRouteStrip(canvas, route, 0);
}
