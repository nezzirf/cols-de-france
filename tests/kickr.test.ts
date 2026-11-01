import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KickrBluetooth } from '../src/hardware/kickrBluetooth';
import { FTMS_CONTROL_POINT, FTMS_INDOOR_BIKE_DATA, FTMS_SERVICE } from '../src/hardware/ftmsProtocol';

type Listener = (e: { target: { value: DataView } }) => void;

/** Caractéristique GATT factice : répond aux écritures par une indication FTMS. */
class FakeCharacteristic {
  listeners: Listener[] = [];
  value: DataView = new DataView(new ArrayBuffer(0));
  written: number[][] = [];
  answer: (payload: Uint8Array) => number[] | null = () => null;

  addEventListener(_: string, l: Listener) {
    this.listeners.push(l);
  }
  async startNotifications() {}
  async writeValueWithResponse(data: Uint8Array) {
    this.written.push(Array.from(data));
    const reply = this.answer(data);
    if (reply) queueMicrotask(() => this.emit(reply));
  }
  emit(bytes: number[]) {
    const value = new DataView(new Uint8Array(bytes).buffer);
    this.listeners.forEach((l) => l({ target: { value } }));
  }
}

function fakeKickr(result = 1) {
  const point = new FakeCharacteristic();
  point.answer = (p) => [0x80, p[0], result];
  const data = new FakeCharacteristic();
  const service = {
    uuid: '00001826-0000-1000-8000-00805f9b34fb',
    getCharacteristic: async (id: number) => (id === FTMS_CONTROL_POINT ? point : id === FTMS_INDOOR_BIKE_DATA ? data : null),
  };
  const server = {
    getPrimaryServices: async () => [service],
    getPrimaryService: async (id: number) => {
      expect(id).toBe(FTMS_SERVICE);
      return service;
    },
  };
  const handlers: (() => void)[] = [];
  const device = {
    gatt: { connect: vi.fn(async () => server), disconnect: vi.fn() },
    addEventListener: (_: string, h: () => void) => handlers.push(h),
  };
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => device } });
  return { point, data, device, drop: () => handlers.forEach((h) => h()) };
}

const CMD = { gradePct: 8, crr: 0.004, cwKgPerM: 0.34, windMps: 0 };

describe('KickrBluetooth sur un KICKR simulé', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('prend le contrôle puis démarre, dans cet ordre', async () => {
    const { point } = fakeKickr();
    const k = new KickrBluetooth(() => 80);
    await k.connect();
    expect(point.written).toEqual([[0x00], [0x07]]);
    expect(k.protocol).toBe('FTMS');
    expect(k.state).toBe('connected');
  });
  it('remonte puissance, cadence et vitesse', async () => {
    const { data } = fakeKickr();
    const k = new KickrBluetooth(() => 80);
    const seen: unknown[] = [];
    k.onData = (d) => seen.push(d);
    await k.connect();
    data.emit([0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00]);
    expect(seen[0]).toMatchObject({ powerW: 250, cadenceRpm: 90 });
  });
  it('envoie la pente au frein', async () => {
    const { point } = fakeKickr();
    const k = new KickrBluetooth(() => 80);
    await k.connect();
    await k.setSimulation(CMD);
    expect(point.written[2].slice(0, 5)).toEqual([0x11, 0, 0, 0x20, 0x03]);
  });
  it('sérialise les écritures : FTMS refuse deux commandes simultanées', async () => {
    const { point } = fakeKickr();
    const k = new KickrBluetooth(() => 80);
    await k.connect();
    await Promise.all([k.setSimulation(CMD), k.setSimulation({ ...CMD, gradePct: 9 })]);
    expect(point.written).toHaveLength(4);
  });
  it('signale un refus du home trainer', async () => {
    fakeKickr(4);
    await expect(new KickrBluetooth(() => 80).connect()).rejects.toThrow(/refusée/);
  });
  it('se reconnecte seul et renvoie la dernière pente', async () => {
    const { point, device, drop } = fakeKickr();
    const k = new KickrBluetooth(() => 80);
    await k.connect();
    await k.setSimulation(CMD);
    const before = point.written.length;
    const data: unknown[] = [];
    k.onData = (d) => data.push(d);
    drop();
    await vi.waitFor(() => expect(k.state).toBe('connected'));
    expect(device.gatt.connect).toHaveBeenCalledTimes(2);
    expect(data[0]).toEqual({ powerW: 0, cadenceRpm: 0 }); // la coupure n'est pas un sprint figé
    expect(point.written.slice(before).at(-1)?.[0]).toBe(0x11);
  });
  it('ne se reconnecte pas après une déconnexion volontaire', async () => {
    const { device, drop } = fakeKickr();
    const k = new KickrBluetooth(() => 80);
    await k.connect();
    await k.disconnect();
    drop();
    await Promise.resolve();
    expect(device.gatt.connect).toHaveBeenCalledTimes(1);
  });
});
