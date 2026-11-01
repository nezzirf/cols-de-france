// Protocoles Bluetooth : décodage et encodage purs, sans dépendance au navigateur.
// Références : Fitness Machine Service 1.0, Cycling Power Service 1.1,
// Heart Rate Service 1.0, extension Wahoo « WCPMCP » pour les anciens firmwares.

import type { TrainerCommand } from '../sim/physicsEngine';
import type { TrainerData } from './types';

export const FTMS_SERVICE = 0x1826;
export const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
export const FTMS_CONTROL_POINT = 0x2ad9;
export const CYCLING_POWER_SERVICE = 0x1818;
export const CYCLING_POWER_MEASUREMENT = 0x2a63;
export const WAHOO_CONTROL_POINT = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';
export const HEART_RATE_SERVICE = 0x180d;
export const HEART_RATE_MEASUREMENT = 0x2a37;

export const FtmsOp = {
  RequestControl: 0x00,
  Reset: 0x01,
  SetTargetPower: 0x05,
  Start: 0x07,
  SetSimulation: 0x11,
  Response: 0x80,
} as const;

export const FtmsResult = { Success: 0x01 } as const;

/** Indoor Bike Data (0x2AD2). Le bit 0 à ZÉRO signifie que la vitesse est présente. */
export function parseIndoorBikeData(view: DataView): TrainerData {
  const flags = view.getUint16(0, true);
  let o = 2;
  const out: TrainerData = {};
  if ((flags & 0x0001) === 0) {
    out.trainerSpeedMps = (view.getUint16(o, true) * 0.01) / 3.6;
    o += 2;
  }
  if (flags & 0x0002) o += 2; // vitesse moyenne
  if (flags & 0x0004) {
    out.cadenceRpm = view.getUint16(o, true) * 0.5;
    o += 2;
  }
  if (flags & 0x0008) o += 2; // cadence moyenne
  if (flags & 0x0010) o += 3; // distance totale
  if (flags & 0x0020) o += 2; // niveau de résistance
  if (flags & 0x0040) {
    out.powerW = view.getInt16(o, true);
    o += 2;
  }
  if (flags & 0x0080) o += 2; // puissance moyenne
  if (flags & 0x0100) o += 5; // énergie
  if (flags & 0x0200) {
    const bpm = view.getUint8(o);
    if (bpm > 0) out.heartRateBpm = bpm;
  }
  return out;
}

export function encodeSimulation(cmd: TrainerCommand): Uint8Array {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, FtmsOp.SetSimulation);
  buf.setInt16(1, Math.round(cmd.windMps * 1000), true);
  buf.setInt16(3, Math.round(cmd.gradePct * 100), true);
  buf.setUint8(5, Math.max(0, Math.min(255, Math.round(cmd.crr * 10000))));
  buf.setUint8(6, Math.max(0, Math.min(255, Math.round(cmd.cwKgPerM * 100))));
  return new Uint8Array(buf.buffer);
}

/** Mode ERG : le frein ajuste sa résistance pour maintenir cette puissance. */
export function encodeTargetPower(watts: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, FtmsOp.SetTargetPower);
  buf.setInt16(1, Math.max(0, Math.round(watts)), true);
  return new Uint8Array(buf.buffer);
}

export interface FtmsResponse {
  requestOp: number;
  result: number;
}

export function parseControlResponse(view: DataView): FtmsResponse | null {
  if (view.byteLength < 3 || view.getUint8(0) !== FtmsOp.Response) return null;
  return { requestOp: view.getUint8(1), result: view.getUint8(2) };
}

/** Calcule la cadence à partir de deux compteurs successifs de tours de pédalier. */
export class CrankCadence {
  private last: { revs: number; time: number } | null = null;
  private cadence = 0;

  update(revs: number, time1024: number): number {
    if (this.last) {
      const dRevs = (revs - this.last.revs) & 0xffff;
      const dTime = (time1024 - this.last.time) & 0xffff;
      if (dTime > 0) this.cadence = (dRevs * 1024 * 60) / dTime;
      else if (dRevs === 0) return this.cadence;
    }
    this.last = { revs, time: time1024 };
    return this.cadence;
  }
}

/** Cycling Power Measurement (0x2A63), utilisé quand le firmware n'expose pas FTMS. */
export function parseCyclingPower(view: DataView, crank: CrankCadence): TrainerData {
  const flags = view.getUint16(0, true);
  const out: TrainerData = { powerW: view.getInt16(2, true) };
  let o = 4;
  if (flags & 0x0001) o += 1; // équilibre des pédales
  if (flags & 0x0004) o += 2; // couple cumulé
  if (flags & 0x0010) o += 6; // tours de roue
  if (flags & 0x0020) out.cadenceRpm = crank.update(view.getUint16(o, true), view.getUint16(o + 2, true));
  return out;
}

export const WahooOp = {
  Unlock: 0x20,
  SetErg: 0x42,
  SetSimMode: 0x43,
  SetGrade: 0x46,
  SetWind: 0x47,
} as const;

export const WAHOO_UNLOCK = new Uint8Array([WahooOp.Unlock, 0xee, 0xfc]);

export function encodeWahooSimMode(totalKg: number, crr: number, cwKgPerM: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(7));
  buf.setUint8(0, WahooOp.SetSimMode);
  buf.setUint16(1, Math.round(totalKg * 100), true);
  buf.setUint16(3, Math.round(crr * 10000), true);
  buf.setUint16(5, Math.round(cwKgPerM * 1000), true);
  return new Uint8Array(buf.buffer);
}

export function encodeWahooGrade(gradePct: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, WahooOp.SetGrade);
  buf.setUint16(1, Math.round(32768 + gradePct * 327.68), true);
  return new Uint8Array(buf.buffer);
}

export function encodeWahooErg(watts: number): Uint8Array {
  const buf = new DataView(new ArrayBuffer(3));
  buf.setUint8(0, WahooOp.SetErg);
  buf.setUint16(1, Math.max(0, Math.round(watts)), true);
  return new Uint8Array(buf.buffer);
}

export function parseHeartRate(view: DataView): number {
  return view.getUint8(0) & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}
