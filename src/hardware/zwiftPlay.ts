// Manettes Zwift Play en Bluetooth : les boutons de vitesse, plus le Y de la manette de droite et les flèches haut et bas
// de celle de gauche (verrouillage et réglage des watts). Zwift ne publie pas ce
// protocole. Les valeurs viennent du projet libre BikeControl et d'analyses indépendantes.

export const ZWIFT_COMPANY_ID = 0x094a;
export const ZWIFT_RIDE_SERVICE = '0000fc82-0000-1000-8000-00805f9b34fb';
export const ZWIFT_PLAY_SERVICE = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const ASYNC_CHARACTERISTIC = '00000002-19ca-4651-86e5-fa29dcdd09d1';
const SYNC_RX_CHARACTERISTIC = '00000003-19ca-4651-86e5-fa29dcdd09d1';
const SYNC_TX_CHARACTERISTIC = '00000004-19ca-4651-86e5-fa29dcdd09d1';

export const RIDE_ON = new Uint8Array([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]);

const PLAY_KEYPAD_FRAME = 0x07;
const RIDE_KEYPAD_FRAME = 0x23;
const PRESSED = 0; // Boutons actifs à l'état bas.
const RIGHT_PAD = 0;
const FIELD_RIGHT_PAD = 1;
const FIELD_SHIFT = 7;
const FIELD_BUTTON_MAP = 1;
const SHIFT_DOWN_MASK = 0x100 | 0x200;
const SHIFT_UP_MASK = 0x1000 | 0x2000;
// Firmware 1 : sur la manette de gauche, les quatre boutons du pavé (haut, gauche, droite, bas) occupent les champs Y, Z, A, B.
const FIELD_TOP_BUTTON = 2;
const FIELD_BOTTOM_BUTTON = 5;
// Firmware 2 : masques de la carte de boutons commune.
const ARROW_UP_MASK = 0x2;
const ARROW_DOWN_MASK = 0x8;
const Y_MASK = 0x40;
const RECONNECT_MS = 5000;
const MIN_SHIFT_INTERVAL_MS = 180;

export type ShiftDirection = 'up' | 'down';

export interface ShiftButtons {
  up: boolean;
  down: boolean;
}

/** Lit les champs entiers d'un message protobuf ; `null` s'il contient autre chose qu'attendu. */
export function readVarintFields(bytes: Uint8Array): Map<number, number> | null {
  const fields = new Map<number, number>();
  let i = 0;
  const varint = (): number | null => {
    let value = 0;
    let scale = 1;
    while (i < bytes.length) {
      const b = bytes[i++];
      value += (b & 0x7f) * scale;
      if (!(b & 0x80)) return value;
      scale *= 128;
    }
    return null;
  };
  while (i < bytes.length) {
    const tag = varint();
    if (tag === null) return null;
    const wire = tag % 8;
    if (wire === 2) {
      // Palettes et autres sous-messages : inutiles ici, on les saute.
      const length = varint();
      if (length === null) return null;
      i += length;
    } else if (wire === 0) {
      const value = varint();
      if (value === null) return null;
      fields.set(Math.floor(tag / 8), value);
    } else {
      return null;
    }
  }
  return fields;
}

/** État des boutons de vitesse dans une trame, ou `null` si elle n'en parle pas. */
export function parseShiftFrame(frame: Uint8Array): ShiftButtons | null {
  const fields = readVarintFields(frame.subarray(1));
  if (!fields) return null;
  if (frame[0] === PLAY_KEYPAD_FRAME) {
    // Firmware 1 : chaque manette est un appareil distinct, avec un seul bouton de vitesse.
    const right = (fields.get(FIELD_RIGHT_PAD) ?? RIGHT_PAD) === RIGHT_PAD;
    const pressed = (fields.get(FIELD_SHIFT) ?? PRESSED) === PRESSED;
    return { up: right && pressed, down: !right && pressed };
  }
  if (frame[0] === RIDE_KEYPAD_FRAME) {
    // Firmware 2 : les deux manettes partagent une seule carte de boutons.
    const map = fields.get(FIELD_BUTTON_MAP);
    if (map === undefined) return null;
    const buttons = map % 0x10000;
    return { up: (buttons & SHIFT_UP_MASK) !== SHIFT_UP_MASK, down: (buttons & SHIFT_DOWN_MASK) !== SHIFT_DOWN_MASK };
  }
  return null;
}

export interface PadButtons {
  /** Bouton Y, manette de droite. */
  y: boolean;
  /** Flèche du haut, manette de gauche. */
  up: boolean;
  /** Flèche du bas, manette de gauche. */
  down: boolean;
}

/** État de Y et des flèches haut et bas dans une trame, ou `null` si elle n'en parle pas. */
export function parsePadButtons(frame: Uint8Array): PadButtons | null {
  const fields = readVarintFields(frame.subarray(1));
  if (!fields) return null;
  if (frame[0] === PLAY_KEYPAD_FRAME) {
    const right = (fields.get(FIELD_RIGHT_PAD) ?? RIGHT_PAD) === RIGHT_PAD;
    const pressed = (field: number): boolean => (fields.get(field) ?? PRESSED) === PRESSED;
    return right ? { y: pressed(FIELD_TOP_BUTTON), up: false, down: false } : { y: false, up: pressed(FIELD_TOP_BUTTON), down: pressed(FIELD_BOTTOM_BUTTON) };
  }
  if (frame[0] === RIDE_KEYPAD_FRAME) {
    const map = fields.get(FIELD_BUTTON_MAP);
    if (map === undefined) return null;
    const buttons = map % 0x10000;
    const pressed = (mask: number): boolean => (buttons & mask) !== mask;
    return { y: pressed(Y_MASK), up: pressed(ARROW_UP_MASK), down: pressed(ARROW_DOWN_MASK) };
  }
  return null;
}

/** Verrouiller les watts (Y), les monter ou les descendre d'un watt (flèches). */
export type ZwiftAction = 'lock' | 'powerUp' | 'powerDown';

/** Un appui, pas un maintien : l'action part quand le bouton passe de relâché à enfoncé. */
export class ActionDetector {
  private held: PadButtons = { y: false, up: false, down: false };

  update(frame: Uint8Array): ZwiftAction[] {
    const now = parsePadButtons(frame);
    if (!now) return [];
    const before = this.held;
    this.held = now;
    const out: ZwiftAction[] = [];
    if (now.y && !before.y) out.push('lock');
    if (now.up && !before.up) out.push('powerUp');
    if (now.down && !before.down) out.push('powerDown');
    return out;
  }
}

/** Une seule action par appui, même si plusieurs connexions rapportent le même bouton. */
export class ActionGate {
  private last = new Map<ZwiftAction, number>();

  pass(action: ZwiftAction, nowMs: number): boolean {
    const before = this.last.get(action);
    if (before !== undefined && nowMs - before < MIN_SHIFT_INTERVAL_MS) return false;
    this.last.set(action, nowMs);
    return true;
  }
}

/** La manette répète son état toutes les 90 ms : seul l'appui compte, pas le maintien. */
export class ShiftDetector {
  private held: ShiftButtons = { up: false, down: false };

  update(frame: Uint8Array): ShiftDirection | null {
    const now = parseShiftFrame(frame);
    if (!now) return null;
    const before = this.held;
    this.held = now;
    if (now.up && !before.up) return 'up';
    if (now.down && !before.down) return 'down';
    return null;
  }
}

/** Un seul changement par appui, même si plusieurs connexions rapportent le même bouton. */
export class ShiftGate {
  private last: { direction: ShiftDirection; atMs: number } | null = null;

  pass(direction: ShiftDirection, nowMs: number): boolean {
    if (this.last?.direction === direction && nowMs - this.last.atMs < MIN_SHIFT_INTERVAL_MS) return false;
    this.last = { direction, atMs: nowMs };
    return true;
  }
}

export class ZwiftPlay {
  onShift: (direction: ShiftDirection) => void = () => {};
  onAction: (action: ZwiftAction) => void = () => {};
  onConnection: (connected: boolean) => void = () => {};
  private device: BluetoothDevice | null = null;
  private detector = new ShiftDetector();
  private actions = new ActionDetector();
  private retryTimer = 0;
  private closing = false;
  private listening: BluetoothRemoteGATTCharacteristic[] = [];

  get deviceId(): string | null {
    return this.device?.id ?? null;
  }

  /**
   * Doit être appelé depuis un geste utilisateur : le navigateur l'exige.
   * Rend false, sans se connecter, si le joueur a rechoisi une manette déjà connectée.
   */
  async connect(connectedIds: (string | null)[]): Promise<boolean> {
    if (!navigator.bluetooth) throw new Error('Bluetooth indisponible dans ce navigateur : utilise Chrome ou Edge.');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Zwift' }, { manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }],
      optionalServices: [ZWIFT_RIDE_SERVICE, ZWIFT_PLAY_SERVICE],
    });
    if (connectedIds.includes(this.device.id)) return false;
    this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
    await this.open();
    return true;
  }

  private async open(): Promise<void> {
    const server = await this.device!.gatt!.connect();
    const service = await server.getPrimaryService(ZWIFT_RIDE_SERVICE).catch(() => server.getPrimaryService(ZWIFT_PLAY_SERVICE));
    // Après une reconnexion, l'ancienne écoute ne doit pas s'ajouter à la nouvelle.
    for (const old of this.listening) old.removeEventListener('characteristicvaluechanged', this.onFrame);
    this.listening = [];
    for (const id of [ASYNC_CHARACTERISTIC, SYNC_TX_CHARACTERISTIC]) {
      const characteristic = await service.getCharacteristic(id);
      characteristic.addEventListener('characteristicvaluechanged', this.onFrame);
      this.listening.push(characteristic);
      await characteristic.startNotifications();
    }
    const rx = await service.getCharacteristic(SYNC_RX_CHARACTERISTIC);
    await rx.writeValueWithoutResponse(RIDE_ON);
    this.onConnection(true);
  }

  private onFrame = (e: Event): void => {
    const view = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (!view) return;
    const frame = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const direction = this.detector.update(frame);
    if (direction) this.onShift(direction);
    for (const action of this.actions.update(frame)) this.onAction(action);
  };

  /** Une manette s'endort vite : on la reprend dès qu'elle se réveille. */
  private onDisconnected = (): void => {
    this.onConnection(false);
    if (this.closing) return;
    this.retryTimer = window.setTimeout(() => {
      this.open().catch(this.onDisconnected);
    }, RECONNECT_MS);
  };

  async disconnect(): Promise<void> {
    this.closing = true;
    clearTimeout(this.retryTimer);
    this.device?.gatt?.disconnect();
  }
}
