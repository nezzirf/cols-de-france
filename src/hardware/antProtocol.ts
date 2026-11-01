// ANT+ : trames série de la clé USB et pages FE-C (Fitness Equipment - Control).
// Fonctions pures, testables sans matériel.

import type { TrainerCommand } from '../sim/physicsEngine';
import type { TrainerData } from './types';

export const ANT_SYNC = 0xa4;

export const AntMsg = {
  Reset: 0x4a,
  SetNetworkKey: 0x46,
  AssignChannel: 0x42,
  SetChannelId: 0x51,
  SetChannelPeriod: 0x43,
  SetSearchTimeout: 0x44,
  SetRfFrequency: 0x45,
  OpenChannel: 0x4b,
  BroadcastData: 0x4e,
  AcknowledgedData: 0x4f,
  ChannelEvent: 0x40,
  StartupMessage: 0x6f,
} as const;

// Clé du réseau ANT+ (publiée pour les adoptants de l'écosystème ANT+).
export const ANT_PLUS_NETWORK_KEY = [0xb9, 0xa5, 0x21, 0xfb, 0xbd, 0x72, 0xc3, 0x45];
export const ANT_RF_FREQUENCY = 57;
export const FEC_DEVICE_TYPE = 17;
export const FEC_PERIOD = 8192;
export const HRM_DEVICE_TYPE = 120;
export const HRM_PERIOD = 8070;

export function antFrame(id: number, payload: number[]): Uint8Array {
  const out = new Uint8Array(payload.length + 4);
  out[0] = ANT_SYNC;
  out[1] = payload.length;
  out[2] = id;
  out.set(payload, 3);
  let check = 0;
  for (let i = 0; i < out.length - 1; i++) check ^= out[i];
  out[out.length - 1] = check;
  return out;
}

export interface AntMessage {
  id: number;
  data: Uint8Array;
}

/** Reconstitue les messages d'un flux USB : une lecture peut en contenir plusieurs. */
export class AntDecoder {
  private buffer: number[] = [];

  push(chunk: Uint8Array): AntMessage[] {
    this.buffer.push(...chunk);
    const out: AntMessage[] = [];
    for (;;) {
      const start = this.buffer.indexOf(ANT_SYNC);
      if (start < 0) {
        this.buffer = [];
        return out;
      }
      if (start > 0) this.buffer.splice(0, start);
      if (this.buffer.length < 4) return out;
      const total = this.buffer[1] + 4;
      if (total > 40) {
        this.buffer.shift();
        continue;
      }
      if (this.buffer.length < total) return out;
      const frame = this.buffer.slice(0, total);
      let check = 0;
      for (const b of frame) check ^= b;
      if (check !== 0) {
        this.buffer.shift();
        continue;
      }
      this.buffer.splice(0, total);
      out.push({ id: frame[2], data: new Uint8Array(frame.slice(3, total - 1)) });
    }
  }
}

/** Décode une page FE-C. `null` si la page ne porte pas de donnée utile. */
export function parseFecPage(page: Uint8Array): TrainerData | null {
  switch (page[0]) {
    case 0x10: {
      const raw = page[4] | (page[5] << 8);
      const out: TrainerData = {};
      if (raw !== 0xffff) out.trainerSpeedMps = raw * 0.001;
      if (page[6] !== 0xff) out.heartRateBpm = page[6];
      return out;
    }
    case 0x19: {
      const power = page[5] | ((page[6] & 0x0f) << 8);
      const out: TrainerData = {};
      if (page[2] !== 0xff) out.cadenceRpm = page[2];
      if (power !== 0xfff) out.powerW = power;
      return out;
    }
    default:
      return null;
  }
}

/** Page 51 : pente en 0,01 % avec un décalage de -200 %, Crr en unités de 5×10⁻⁵. */
export function fecTrackResistance(gradePct: number, crr: number): number[] {
  const raw = Math.round((gradePct + 200) * 100);
  return [0x33, 0xff, 0xff, 0xff, 0xff, raw & 0xff, (raw >> 8) & 0xff, Math.min(254, Math.round(crr / 5e-5))];
}

/** Page 50 : CwR en 0,01 kg/m, vent en km/h décalé de 127, pas d'aspiration. */
export function fecWindResistance(cmd: TrainerCommand): number[] {
  const cw = Math.min(254, Math.round(cmd.cwKgPerM * 100));
  const wind = Math.max(0, Math.min(254, Math.round(cmd.windMps * 3.6) + 127));
  return [0x32, 0xff, 0xff, 0xff, 0xff, cw, wind, 100];
}

/** Page 55 : poids du cycliste et du vélo, utilisés par le frein pour l'inertie simulée. */
export function fecUserConfig(riderKg: number, bikeKg: number, wheelDiameterM: number): number[] {
  const user = Math.round(riderKg * 100);
  const bike = Math.round(bikeKg / 0.05);
  return [
    0x37,
    user & 0xff,
    (user >> 8) & 0xff,
    0xff,
    ((bike & 0x0f) << 4) | 0x0f,
    (bike >> 4) & 0xff,
    Math.round(wheelDiameterM * 100),
    0xff,
  ];
}
