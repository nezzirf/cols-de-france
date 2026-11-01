// Caméra libre du mode exploration : vol au clavier, regard à la souris.
// Sans dépendance au rendu, pour que ses déplacements soient testables.

export type MoveKey = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down' | 'boost';

/** Touches physiques : la même position donne ZQSD sur AZERTY et WASD sur QWERTY. */
export const MOVE_KEYS: Record<string, MoveKey> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  KeyE: 'up',
  KeyQ: 'down',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
};

const BOOST = 6;
const MIN_SPEED = 3;
const MAX_SPEED = 300;
const GROUND_CLEARANCE_M = 0.6;
const LOOK_SENSITIVITY = 0.0035;
const MAX_PITCH = 1.5;

export class FreeCamera {
  x: number;
  y: number;
  z: number;
  /** Même convention que la direction de la route : 0 = vers -Z. */
  yaw: number;
  pitch: number;
  speedMps = 25;
  private held = new Set<MoveKey>();

  constructor(position: { x: number; y: number; z: number }, yaw: number, pitch: number) {
    this.x = position.x;
    this.y = position.y;
    this.z = position.z;
    this.yaw = yaw;
    this.pitch = pitch;
  }

  setKey(key: MoveKey, down: boolean): void {
    if (down) this.held.add(key);
    else this.held.delete(key);
  }

  releaseAll(): void {
    this.held.clear();
  }

  look(dx: number, dy: number): void {
    this.yaw += dx * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - dy * LOOK_SENSITIVITY));
  }

  /** Molette : `steps` positif accélère. */
  changeSpeed(steps: number): void {
    this.speedMps = Math.max(MIN_SPEED, Math.min(MAX_SPEED, this.speedMps * 1.25 ** steps));
  }

  update(dt: number, groundAt: (x: number, z: number) => number): void {
    const has = (k: MoveKey) => (this.held.has(k) ? 1 : 0);
    const ahead = has('forward') - has('back');
    const side = has('right') - has('left');
    const lift = has('up') - has('down');

    const cp = Math.cos(this.pitch);
    const fx = Math.sin(this.yaw) * cp;
    const fy = Math.sin(this.pitch);
    const fz = -Math.cos(this.yaw) * cp;
    const rx = Math.cos(this.yaw);
    const rz = Math.sin(this.yaw);

    let mx = fx * ahead + rx * side;
    let my = fy * ahead + lift;
    let mz = fz * ahead + rz * side;
    const len = Math.hypot(mx, my, mz);
    if (len > 0) {
      const step = (this.speedMps * (this.held.has('boost') ? BOOST : 1) * dt) / len;
      mx *= step;
      my *= step;
      mz *= step;
    }
    this.x += mx;
    this.y += my;
    this.z += mz;
    this.y = Math.max(this.y, groundAt(this.x, this.z) + GROUND_CLEARANCE_M);
  }
}
