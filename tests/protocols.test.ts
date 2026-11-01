import { describe, expect, it } from 'vitest';
import {
  CrankCadence,
  encodeSimulation,
  encodeWahooGrade,
  encodeWahooSimMode,
  parseControlResponse,
  parseCyclingPower,
  parseHeartRate,
  parseIndoorBikeData,
} from '../src/hardware/ftmsProtocol';
import {
  AntDecoder,
  antFrame,
  fecTrackResistance,
  fecUserConfig,
  fecWindResistance,
  parseFecPage,
} from '../src/hardware/antProtocol';

const view = (...bytes: number[]) => new DataView(new Uint8Array(bytes).buffer);

describe('FTMS', () => {
  it('lit vitesse, cadence et puissance', () => {
    // flags 0x0044 : vitesse (bit 0 = 0), cadence, puissance
    const d = parseIndoorBikeData(view(0x44, 0x00, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00));
    expect(d.trainerSpeedMps).toBeCloseTo(25 / 3.6, 5);
    expect(d.cadenceRpm).toBe(90);
    expect(d.powerW).toBe(250);
  });
  it('saute la vitesse quand le bit More Data est levé', () => {
    const d = parseIndoorBikeData(view(0x41, 0x00, 0x2c, 0x01));
    expect(d.trainerSpeedMps).toBeUndefined();
    expect(d.powerW).toBe(300);
  });
  it('saute les champs intermédiaires pour trouver la puissance et le cardio', () => {
    // vitesse, distance (3 o), résistance (2 o), puissance, énergie (5 o), cardio
    const d = parseIndoorBikeData(
      view(0x70, 0x03, 0x10, 0x27, 1, 2, 3, 9, 0, 0xc8, 0x00, 1, 2, 3, 4, 5, 142),
    );
    expect(d.powerW).toBe(200);
    expect(d.heartRateBpm).toBe(142);
  });
  it('encode pente, vent, crr et cw aux unités du standard', () => {
    const b = encodeSimulation({ gradePct: 8.25, crr: 0.004, cwKgPerM: 0.34, windMps: -1.5 });
    expect(Array.from(b)).toEqual([0x11, 0x24, 0xfa, 0x39, 0x03, 40, 34]);
  });
  it('encode une pente négative en complément à deux', () => {
    const b = encodeSimulation({ gradePct: -5, crr: 0.004, cwKgPerM: 0.34, windMps: 0 });
    expect(new DataView(b.buffer).getInt16(3, true)).toBe(-500);
  });
  it('reconnaît la réponse du point de contrôle', () => {
    expect(parseControlResponse(view(0x80, 0x11, 0x01))).toEqual({ requestOp: 0x11, result: 1 });
    expect(parseControlResponse(view(0x12, 0x11, 0x01))).toBeNull();
  });
});

describe('Cycling Power et extension Wahoo', () => {
  it('calcule la cadence depuis les compteurs de pédalier', () => {
    const crank = new CrankCadence();
    parseCyclingPower(view(0x20, 0x00, 0xc8, 0x00, 10, 0, 0, 0), crank);
    const d = parseCyclingPower(view(0x20, 0x00, 0xc8, 0x00, 12, 0, 0x55, 0x05), crank);
    expect(d.powerW).toBe(200);
    expect(d.cadenceRpm).toBeCloseTo(90, 0);
  });
  it('gère le débordement du compteur de temps', () => {
    const crank = new CrankCadence();
    crank.update(100, 0xff00);
    expect(crank.update(101, 0x0100)).toBeCloseTo((1024 * 60) / 512, 3);
  });
  it('encode la pente Wahoo autour de 32768', () => {
    const b = encodeWahooGrade(0);
    expect(Array.from(b)).toEqual([0x46, 0x00, 0x80]);
    const up = new DataView(encodeWahooGrade(10).buffer).getUint16(1, true);
    expect(up).toBe(32768 + 3277);
  });
  it('encode le mode simulation avec le poids', () => {
    const v = new DataView(encodeWahooSimMode(80, 0.004, 0.4).buffer);
    expect(v.getUint8(0)).toBe(0x43);
    expect(v.getUint16(1, true)).toBe(8000);
    expect(v.getUint16(3, true)).toBe(40);
    expect(v.getUint16(5, true)).toBe(400);
  });
});

describe('Cardio', () => {
  it('lit le format 8 et 16 bits', () => {
    expect(parseHeartRate(view(0x00, 150))).toBe(150);
    expect(parseHeartRate(view(0x01, 0x2c, 0x01))).toBe(300);
  });
});

describe('ANT+ FE-C', () => {
  it('construit une trame avec somme de contrôle XOR', () => {
    const f = antFrame(0x4b, [0]);
    expect(Array.from(f)).toEqual([0xa4, 1, 0x4b, 0, 0xa4 ^ 1 ^ 0x4b]);
  });
  it('reconstitue des messages coupés ou collés', () => {
    const dec = new AntDecoder();
    const a = antFrame(0x4e, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const b = antFrame(0x40, [0, 1, 3]);
    const all = new Uint8Array([...a, ...b]);
    expect(dec.push(all.subarray(0, 6))).toEqual([]);
    const out = dec.push(all.subarray(6));
    expect(out.map((m) => m.id)).toEqual([0x4e, 0x40]);
    expect(Array.from(out[1].data)).toEqual([0, 1, 3]);
  });
  it('ignore une trame corrompue', () => {
    const f = antFrame(0x4e, [0, 1, 2]);
    f[4] ^= 0xff;
    expect(new AntDecoder().push(f)).toEqual([]);
  });
  it('lit la page 25 : cadence et puissance sur 12 bits', () => {
    const d = parseFecPage(new Uint8Array([0x19, 7, 88, 0, 0, 0x2c, 0x31, 0x30]));
    expect(d).toEqual({ cadenceRpm: 88, powerW: 300 });
  });
  it('lit la page 16 : vitesse', () => {
    const d = parseFecPage(new Uint8Array([0x10, 25, 0, 0, 0x88, 0x13, 0xff, 0]));
    expect(d).toEqual({ trainerSpeedMps: 5 });
  });
  it('ignore les valeurs marquées invalides', () => {
    const d = parseFecPage(new Uint8Array([0x19, 0, 0xff, 0, 0, 0xff, 0x0f, 0]));
    expect(d).toEqual({});
  });
  it('encode la page 51 avec le décalage de -200 %', () => {
    const p = fecTrackResistance(5, 0.004);
    expect(p[0]).toBe(0x33);
    expect(p[5] | (p[6] << 8)).toBe(20500);
    expect(p[7]).toBe(80);
    expect(fecTrackResistance(-5, 0.004)[5] | (fecTrackResistance(-5, 0.004)[6] << 8)).toBe(19500);
  });
  it('encode la page 50 avec le vent décalé', () => {
    const p = fecWindResistance({ gradePct: 0, crr: 0.004, cwKgPerM: 0.35, windMps: 0 });
    expect(p).toEqual([0x32, 0xff, 0xff, 0xff, 0xff, 35, 127, 100]);
  });
  it('encode la page 55 : poids du vélo sur 12 bits', () => {
    const p = fecUserConfig(75, 8.5, 0.67);
    expect(p[1] | (p[2] << 8)).toBe(7500);
    expect((p[4] >> 4) | (p[5] << 4)).toBe(170);
    expect(p[6]).toBe(67);
  });
});
