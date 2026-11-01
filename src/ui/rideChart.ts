// Courbes d'une sortie, que l'on survole pour lire les valeurs et que l'on zoome pour regarder un effort.

import { rangeStats, type RideSample } from '../sim/rideStats';
import { fr } from './format';

const MIN_SPAN_S = 10;

const clock = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = String(t % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Puissance lissée sur dix secondes : à la seconde, la courbe serait illisible. */
export function smoothPower(samples: RideSample[], window = 10): number[] {
  const out: number[] = [];
  let sum = 0;
  samples.forEach((s, i) => {
    sum += s.powerW;
    if (i >= window) sum -= samples[i - window].powerW;
    out.push(sum / Math.min(i + 1, window));
  });
  return out;
}

export interface RideChartParts {
  canvas: HTMLCanvasElement;
  readout: HTMLElement;
  zoomIn: HTMLButtonElement;
  zoomOut: HTMLButtonElement;
  reset: HTMLButtonElement;
}

export class RideChart {
  private from: number;
  private to: number;
  private hover: number | null = null;
  private drag: { startT: number; endT: number } | null = null;
  private smooth: number[];
  private maxPower: number;

  constructor(
    private parts: RideChartParts,
    private samples: RideSample[],
  ) {
    this.from = samples[0].t;
    this.to = samples[samples.length - 1].t;
    this.smooth = smoothPower(samples);
    this.maxPower = Math.max(100, ...this.smooth) * 1.1;
    const { canvas } = parts;
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerleave', () => {
      if (!this.drag) this.setHover(null);
    });
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      const t = this.timeAt(e);
      this.drag = { startT: t, endT: t };
    });
    canvas.addEventListener('pointerup', () => this.endDrag());
    canvas.addEventListener('pointercancel', () => {
      this.drag = null;
      this.draw();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAround(this.timeAt(e), e.deltaY < 0 ? 0.7 : 1 / 0.7);
      },
      { passive: false },
    );
    canvas.addEventListener('dblclick', () => this.resetZoom());
    parts.zoomIn.addEventListener('click', () => this.zoomAround((this.from + this.to) / 2, 0.5));
    parts.zoomOut.addEventListener('click', () => this.zoomAround((this.from + this.to) / 2, 2));
    parts.reset.addEventListener('click', () => this.resetZoom());
    new ResizeObserver(() => this.draw()).observe(canvas);
    this.draw();
  }

  private get firstT(): number {
    return this.samples[0].t;
  }

  private get lastT(): number {
    return this.samples[this.samples.length - 1].t;
  }

  private get zoomed(): boolean {
    return this.from > this.firstT || this.to < this.lastT;
  }

  private timeAt(e: { clientX: number }): number {
    const r = this.parts.canvas.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return this.from + f * (this.to - this.from);
  }

  private setRange(from: number, to: number): void {
    const total = this.lastT - this.firstT;
    const span = Math.max(Math.min(MIN_SPAN_S, total), Math.min(total, to - from));
    const start = Math.max(this.firstT, Math.min(this.lastT - span, from));
    this.from = start;
    this.to = start + span;
    this.hover = null;
    this.draw();
  }

  private zoomAround(t: number, factor: number): void {
    const f = (t - this.from) / (this.to - this.from);
    const span = (this.to - this.from) * factor;
    this.setRange(t - f * span, t - f * span + span);
  }

  resetZoom(): void {
    this.setRange(this.firstT, this.lastT);
  }

  private setHover(t: number | null): void {
    this.hover = t;
    this.draw();
  }

  private onMove(e: PointerEvent): void {
    const t = this.timeAt(e);
    if (this.drag) {
      this.drag.endT = t;
      this.draw();
    } else {
      this.setHover(t);
    }
  }

  private endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (d && Math.abs(d.endT - d.startT) >= MIN_SPAN_S) this.setRange(Math.min(d.startT, d.endT), Math.max(d.startT, d.endT));
    else this.draw();
  }

  private sampleAt(t: number): RideSample {
    const i = Math.max(0, Math.min(this.samples.length - 1, Math.round(t - this.firstT)));
    return this.samples[i];
  }

  /** Le texte sous le graphique : valeurs sous le curseur, ou moyennes de la portion visible. */
  private describe(): string {
    if (this.hover !== null) {
      const s = this.sampleAt(this.hover);
      const i = s.t - this.firstT;
      const hr = s.heartRateBpm ? ` · ${Math.round(s.heartRateBpm)} bpm` : '';
      return `${clock(s.t)} · ${Math.round(this.smooth[i])} W · ${Math.round(s.cadenceRpm)} rpm${hr} · ${fr(s.speedKmh)} km/h · ${Math.round(s.altitudeM)} m · km ${fr(s.distanceM / 1000)}`;
    }
    const range = rangeStats(this.samples, this.from, this.to);
    if (!range) return '';
    const label = this.zoomed ? `Portion ${clock(this.from)} → ${clock(this.to)}` : 'Toute la sortie';
    const hr = range.avgHeartRateBpm !== null ? ` · ${Math.round(range.avgHeartRateBpm)} bpm` : '';
    return `${label} · ${Math.round(range.avgPowerW)} W moy.${hr} · ${fr(range.avgSpeedKmh)} km/h · ${fr(range.distanceKm)} km · +${Math.round(range.elevationGainM)} m`;
  }

  private draw(): void {
    const { canvas, readout, reset } = this.parts;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const g = canvas.getContext('2d')!;
    g.scale(dpr, dpr);
    const x = (t: number) => ((t - this.from) / (this.to - this.from)) * w;
    const visible = this.samples.filter((s) => s.t >= this.from - 1 && s.t <= this.to + 1);
    const scaled = (value: (s: RideSample) => number, lo: number, hi: number) => (s: RideSample) => h - 6 - ((value(s) - lo) / (hi - lo || 1)) * (h - 12);

    const alt = this.samples.map((s) => s.altitudeM);
    const yAlt = scaled((s) => s.altitudeM, Math.min(...alt), Math.max(...alt));
    if (visible.length > 0) {
      g.beginPath();
      g.moveTo(x(visible[0].t), h);
      for (const s of visible) g.lineTo(x(s.t), yAlt(s));
      g.lineTo(x(visible[visible.length - 1].t), h);
      g.closePath();
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fill();
    }

    const yPower = scaled((s) => this.smooth[s.t - this.firstT], 0, this.maxPower);
    g.beginPath();
    visible.forEach((s, i) => (i === 0 ? g.moveTo(x(s.t), yPower(s)) : g.lineTo(x(s.t), yPower(s))));
    g.strokeStyle = '#ff8a2b';
    g.lineWidth = 2;
    g.stroke();

    const beats = visible.filter((s) => s.heartRateBpm);
    if (beats.length > 1) {
      const all = this.samples.map((s) => s.heartRateBpm).filter((v): v is number => !!v);
      const yHr = scaled((s) => s.heartRateBpm!, Math.min(...all) - 5, Math.max(...all) + 5);
      g.beginPath();
      beats.forEach((s, i) => (i === 0 ? g.moveTo(x(s.t), yHr(s)) : g.lineTo(x(s.t), yHr(s))));
      g.strokeStyle = '#ff6b5e';
      g.lineWidth = 1.5;
      g.stroke();
    }

    if (this.drag && this.drag.startT !== this.drag.endT) {
      const a = x(Math.min(this.drag.startT, this.drag.endT));
      const b = x(Math.max(this.drag.startT, this.drag.endT));
      g.fillStyle = 'rgba(255,138,43,0.18)';
      g.fillRect(a, 0, b - a, h);
    }
    if (this.hover !== null) {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x(this.hover), 0);
      g.lineTo(x(this.hover), h);
      g.stroke();
    }
    readout.textContent = this.describe();
    reset.hidden = !this.zoomed;
  }
}
