// Pastille flottante pour un téléphone ou une tablette : les chiffres sont dessinés sur un canvas, diffusé comme
// une vidéo dans la petite fenêtre « image dans l'image » du navigateur. Elle reste par-dessus les autres
// applications, Netflix en plein écran compris, ce qu'une page web ne peut pas faire autrement.

import type { RideSnapshot } from '../app/game';
import type { ConnectionState } from '../hardware/types';
import { totalDuration, zoneColor, type WorkoutStep } from '../sim/workout';
import { formatTime } from './hud';

// Très allongée : le rapport 2,39 est le plus large qu'Android accepte pour une fenêtre flottante.
const WIDTH = 860;
const HEIGHT = 360;
/** Résolution de l'image : le double de la taille de dessin, pour rester nette quand on agrandit la fenêtre. */
const SCALE = 2;
const UPDATE_MS = 200;
const TOAST_MS = 5000;
/** Écart toléré entre la puissance et la cible avant de colorer le chiffre. */
const ON_TARGET = 0.05;
const FONT = "Bahnschrift, 'Segoe UI', Roboto, system-ui, sans-serif";

const INK = '#f6f8fa';
const DIM = 'rgba(246, 248, 250, 0.6)';
const ACCENT = '#ff6a1a';
const STATE_COLOR: Record<string, string> = { ok: '#4ee08a', low: '#6fb2ff', high: '#ff9a4d', none: INK };
const LINK_COLOR: Record<ConnectionState, string> = { connected: '#4ee08a', connecting: ACCENT, reconnecting: ACCENT, disconnected: '#ff6b5e' };
const LINK_NAME: Record<ConnectionState, string> = { connected: 'connecté', connecting: 'connexion…', reconnecting: 'reconnexion…', disconnected: 'déconnecté' };

/** Couleur de la puissance : verte quand on tient la consigne, bleue en dessous, orange au-dessus. */
export function powerState(powerW: number, targetW: number | null): 'ok' | 'low' | 'high' | 'none' {
  if (!targetW) return 'none';
  const gap = (powerW - targetW) / targetW;
  return Math.abs(gap) <= ON_TARGET ? 'ok' : gap < 0 ? 'low' : 'high';
}

export function pillSupported(): boolean {
  return typeof document !== 'undefined' && !!document.pictureInPictureEnabled && 'captureStream' in HTMLCanvasElement.prototype;
}

export class PillHud {
  readonly canvas = document.createElement('canvas');
  private video = document.createElement('video');
  private ctx: CanvasRenderingContext2D;
  private snap: RideSnapshot | null = null;
  private link: { label: string; state: ConnectionState } | null = null;
  private toastText = '';
  private toastUntil = 0;
  private last = 0;
  /** Appelé quand le joueur ferme la pastille avec sa croix. */
  onClosed: () => void = () => {};

  constructor(private steps: WorkoutStep[] | null = null) {
    this.canvas.width = WIDTH * SCALE;
    this.canvas.height = HEIGHT * SCALE;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(SCALE, SCALE);
    this.draw(performance.now());
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.canvas.captureStream(15);
    // Le navigateur refuse la mise en image dans l'image d'une vidéo qui n'est pas dans la page.
    this.video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(this.video);
    this.video.addEventListener('leavepictureinpicture', () => this.onClosed());
  }

  /** À appeler dans le geste du joueur (le clic qui lance la sortie) : le navigateur l'exige. */
  async open(): Promise<void> {
    await this.video.play();
    await this.video.requestPictureInPicture();
  }

  get isOpen(): boolean {
    return document.pictureInPictureElement === this.video;
  }

  update(s: RideSnapshot, now: number): void {
    if (now - this.last < UPDATE_MS) return;
    this.last = now;
    this.snap = s;
    this.draw(now);
  }

  setConnection(label: string, state: ConnectionState): void {
    this.link = { label, state };
  }

  toast(text: string): void {
    this.toastText = text;
    this.toastUntil = performance.now() + TOAST_MS;
  }

  dispose(): void {
    if (this.isOpen) void document.exitPictureInPicture().catch(() => {});
    this.video.pause();
    this.video.srcObject = null;
    this.video.remove();
  }

  private draw(now: number): void {
    const { ctx } = this;
    const s = this.snap;
    const plan = s?.workout ?? null;
    const power = Math.round(s?.powerW ?? 0);
    const text = (value: string, x: number, y: number, size: number, color: string, opts: { italic?: boolean; align?: CanvasTextAlign } = {}) => {
      ctx.font = `${opts.italic ? 'italic ' : ''}700 ${size}px ${FONT}`;
      ctx.fillStyle = color;
      ctx.textAlign = opts.align ?? 'left';
      ctx.fillText(value, x, y);
    };

    const bg = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
    bg.addColorStop(0, '#171d26');
    bg.addColorStop(1, '#0b0d10');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // Première ligne : tous les chiffres côte à côte.
    text('PUISSANCE', 28, 40, 22, DIM);
    text(s ? String(power) : '--', 24, 168, 132, STATE_COLOR[powerState(power, plan?.targetW ?? null)], { italic: true });
    text('W', 250, 168, 32, DIM);
    const side: [string, string, string][] = [
      plan ? ['CIBLE', plan.free ? 'LIBRE' : String(plan.targetW), ACCENT] : ['VITESSE', s ? s.speedKmh.toFixed(1).replace('.', ',') : '--', INK],
      ['CADENCE', s ? String(Math.round(s.cadenceRpm)) : '--', INK],
      ['CARDIO', s?.heartRateBpm == null ? '--' : String(Math.round(s.heartRateBpm)), INK],
    ];
    side.forEach(([label, value, color], i) => {
      const x = 400 + i * 150;
      text(label, x, 40, 20, DIM);
      text(value, x - 4, 118, 66, color, { italic: true });
    });
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(28, 192, WIDTH - 56, 2);

    // Seconde ligne : les blocs de la séance, avec la place où l'on en est.
    if (plan && this.steps && this.steps.length > 0) {
      this.drawBlocks(28, 206, WIDTH - 56, 94, plan.elapsedS);
    }
    const time = plan ? `${formatTime(plan.elapsedS)} / ${formatTime(plan.totalS)}` : s ? `${formatTime(s.elapsedS)} · ${(s.totalM / 1000).toFixed(1).replace('.', ',')} km` : '00:00';
    text(time, 28, 342, 30, INK);
    if (plan) text(`Bloc ${formatTime(Math.ceil(plan.stepLeftS))}`, 330, 342, 26, DIM);
    if (this.link) {
      ctx.fillStyle = LINK_COLOR[this.link.state];
      ctx.beginPath();
      ctx.arc(WIDTH - 36, 332, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.toastText && now < this.toastUntil) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
      ctx.fillRect(0, 150, WIDTH, 60);
      text(this.toastText, WIDTH / 2, 190, 28, INK, { align: 'center' });
    } else if (this.link && this.link.state !== 'connected') {
      text(`${this.link.label} · ${LINK_NAME[this.link.state]}`, WIDTH - 56, 340, 20, DIM, { align: 'right' });
    }
  }

  /** Les blocs de la séance en barres (hauteur = consigne, couleur = zone) ; la partie déjà faite est assombrie. */
  private drawBlocks(x: number, y: number, w: number, h: number, elapsedS: number): void {
    const { ctx } = this;
    const steps = this.steps!;
    const total = totalDuration(steps);
    if (total <= 0) return;
    const peak = Math.max(135, ...steps.flatMap((st) => [st.fromPct, st.toPct])) * 1.06;
    const top = (pct: number) => y + h - (pct / peak) * h;
    const perS = w / total;
    for (const st of steps) {
      const x0 = x + st.startS * perS;
      const width = st.durationS * perS;
      const slices = st.fromPct === st.toPct ? 1 : Math.max(1, Math.ceil(width / 5));
      for (let i = 0; i < slices; i++) {
        const pct = st.fromPct + ((st.toPct - st.fromPct) * (i + 0.5)) / slices;
        ctx.fillStyle = zoneColor(pct);
        ctx.fillRect(x0 + (width * i) / slices, top(pct), width / slices + 0.6, y + h - top(pct));
      }
    }
    const cursor = x + Math.min(w, Math.max(0, elapsedS) * perS);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(x, y, cursor - x, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(cursor - 1.5, y - 4, 3, h + 8);
  }
}
