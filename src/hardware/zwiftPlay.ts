// Manettes Zwift Play en Bluetooth : seuls les boutons de vitesse sont lus. Zwift ne publie pas ce
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
const RECONNECT_MS = 5000;

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

export class ZwiftPlay {
  onShift: (direction: ShiftDirection) => void = () => {};
  onConnection: (connected: boolean) => void = () => {};
  private device: BluetoothDevice | null = null;
  private detector = new ShiftDetector();
  private retryTimer = 0;
  private closing = false;

  /** Doit être appelé depuis un geste utilisateur : le navigateur l'exige. */
  async connect(): Promise<void> {
    if (!navigator.bluetooth) throw new Error('Bluetooth indisponible dans ce navigateur : utilise Chrome ou Edge.');
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Zwift' }, { manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }],
      optionalServices: [ZWIFT_RIDE_SERVICE, ZWIFT_PLAY_SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', this.onDisconnected);
    await this.open();
  }

  private async open(): Promise<void> {
    const server = await this.device!.gatt!.connect();
    const service = await server.getPrimaryService(ZWIFT_RIDE_SERVICE).catch(() => server.getPrimaryService(ZWIFT_PLAY_SERVICE));
    for (const id of [ASYNC_CHARACTERISTIC, SYNC_TX_CHARACTERISTIC]) {
      const characteristic = await service.getCharacteristic(id);
      characteristic.addEventListener('characteristicvaluechanged', this.onFrame);
      await characteristic.startNotifications();
    }
    const rx = await service.getCharacteristic(SYNC_RX_CHARACTERISTIC);
    await rx.writeValueWithoutResponse(RIDE_ON);
    this.onConnection(true);
  }

  private onFrame = (e: Event): void => {
    const view = (e.target as BluetoothRemoteGATTCharacteristic).value;
    if (!view) return;
    const direction = this.detector.update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    if (direction) this.onShift(direction);
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
