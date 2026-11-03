// Pastille flottante pour un téléphone ou une tablette : les chiffres sont dessinés sur un canvas, diffusé comme
// une vidéo dans la petite fenêtre « image dans l'image » du navigateur. Elle reste par-dessus les autres
// applications, Netflix en plein écran compris, ce qu'une page web ne peut pas faire autrement.

import type { RideSnapshot } from '../app/game';
import type { ConnectionState } from '../hardware/types';
import { formatTime } from './hud';

const WIDTH = 640;
const HEIGHT = 360;
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

  constructor() {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.ctx = this.canvas.getContext('2d')!;
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

    text('PUISSANCE', 32, 54, 24, DIM);
    text(s ? String(power) : '--', 28, 206, 156, STATE_COLOR[powerState(power, plan?.targetW ?? null)], { italic: true });
    text('W', 32, 250, 34, DIM);

    // La colonne de droite : la cible quand il y a une séance, sinon la vitesse, puis cadence et cœur.
    const side: [string, string, string][] = [
      plan ? ['CIBLE', String(plan.targetW), ACCENT] : ['VITESSE', s ? s.speedKmh.toFixed(1).replace('.', ',') : '--', INK],
      ['CADENCE', s ? String(Math.round(s.cadenceRpm)) : '--', INK],
      ['CARDIO', s?.heartRateBpm == null ? '--' : String(Math.round(s.heartRateBpm)), INK],
    ];
    side.forEach(([label, value, color], i) => {
      const y = 54 + i * 84;
      text(label, 608, y, 20, DIM, { align: 'right' });
      text(value, 608, y + 46, 54, color, { italic: true, align: 'right' });
    });

    if (plan) {
      const done = plan.totalS > 0 ? Math.min(1, plan.elapsedS / plan.totalS) : 0;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(32, 282, WIDTH - 64, 8);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(32, 282, (WIDTH - 64) * done, 8);
    }
    const time = plan ? `${formatTime(plan.elapsedS)} / ${formatTime(plan.totalS)}` : s ? `${formatTime(s.elapsedS)} · ${(s.totalM / 1000).toFixed(1).replace('.', ',')} km` : '00:00';
    text(time, 32, 336, 30, INK);
    if (plan) text(`Bloc ${formatTime(Math.ceil(plan.stepLeftS))}`, 330, 336, 26, DIM);
    if (this.link) {
      ctx.fillStyle = LINK_COLOR[this.link.state];
      ctx.beginPath();
      ctx.arc(592, 326, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.toastText && now < this.toastUntil) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.78)';
      ctx.fillRect(0, 150, WIDTH, 60);
      text(this.toastText, WIDTH / 2, 190, 28, INK, { align: 'center' });
    } else if (this.link && this.link.state !== 'connected') {
      text(`${this.link.label} · ${LINK_NAME[this.link.state]}`, 608, 300, 20, DIM, { align: 'right' });
    }
  }
}
