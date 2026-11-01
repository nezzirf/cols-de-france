import { describe, expect, it } from 'vitest';
import { GEAR_COUNT, gearRatio, shiftedGrade, type ShiftInput } from '../src/sim/gears';
import { parseShiftFrame, readVarintFields, ShiftDetector } from '../src/hardware/zwiftPlay';

const base: ShiftInput = {
  gradePct: 6,
  gear: 12,
  cadenceRpm: 85,
  trainerSpeedMps: null,
  totalKg: 82,
  crr: 0.004,
  cwKgPerM: 0.35,
  wheelRadiusM: 0.335,
};

const wheelSpeed = (s: ShiftInput) => (s.cadenceRpm / 60) * 2 * Math.PI * s.wheelRadiusM;

describe('vitesses virtuelles', () => {
  it('propose des rapports de plus en plus longs', () => {
    for (let g = 2; g <= GEAR_COUNT; g++) expect(gearRatio(g)).toBeGreaterThan(gearRatio(g - 1));
  });
  it('borne le numéro de vitesse', () => {
    expect(gearRatio(0)).toBe(gearRatio(1));
    expect(gearRatio(99)).toBe(gearRatio(GEAR_COUNT));
  });
  it('ne change rien quand le rapport virtuel égale le rapport réel', () => {
    const trainerSpeedMps = wheelSpeed(base) * gearRatio(base.gear);
    expect(shiftedGrade({ ...base, trainerSpeedMps })).toBeCloseTo(base.gradePct, 6);
  });
  it('durcit en montant les vitesses et allège en les descendant', () => {
    expect(shiftedGrade({ ...base, gear: 16 })).toBeGreaterThan(shiftedGrade({ ...base, gear: 15 }));
    expect(shiftedGrade({ ...base, gear: 5 })).toBeLessThan(shiftedGrade({ ...base, gear: 6 }));
  });
  it('fait produire au frein la puissance du rapport choisi', () => {
    const s = { ...base, gear: 16, trainerSpeedMps: wheelSpeed(base) * 3 };
    const weight = s.totalKg * 9.81;
    const force = (speed: number, grade: number) => weight * (grade / 100 + s.crr) + 0.5 * s.cwKgPerM * speed * speed;
    const virtual = wheelSpeed(s) * gearRatio(s.gear);
    expect(force(s.trainerSpeedMps, shiftedGrade(s)) * s.trainerSpeedMps).toBeCloseTo(force(virtual, s.gradePct) * virtual, 4);
  });
  it('utilise la vitesse réelle du frein si elle est connue', () => {
    expect(shiftedGrade({ ...base, trainerSpeedMps: 7 })).not.toBeCloseTo(shiftedGrade({ ...base, trainerSpeedMps: 9 }), 2);
  });
  it('laisse la pente intacte quand on ne pédale pas', () => {
    expect(shiftedGrade({ ...base, cadenceRpm: 0, gear: 24 })).toBe(base.gradePct);
  });
  it('reste dans ce que le frein accepte', () => {
    expect(shiftedGrade({ ...base, gradePct: 18, gear: 24 })).toBe(20);
    expect(shiftedGrade({ ...base, gradePct: -18, gear: 24 })).toBe(-20);
  });
});

const released = [0x10, 1, 0x18, 1, 0x20, 1, 0x28, 1, 0x30, 1];

describe('Zwift Play', () => {
  it('lit un varint de cinq octets', () => {
    expect(readVarintFields(new Uint8Array([0x08, 0xff, 0xff, 0xff, 0xff, 0x0f]))?.get(1)).toBe(0xffffffff);
  });
  it('rejette une trame tronquée', () => {
    expect(readVarintFields(new Uint8Array([0x08, 0xff]))).toBeNull();
  });
  it('firmware 1 : le bouton droit monte une vitesse', () => {
    expect(parseShiftFrame(new Uint8Array([0x07, 0x08, 0, ...released, 0x38, 0]))).toEqual({ up: true, down: false });
  });
  it('firmware 1 : le bouton gauche descend une vitesse', () => {
    expect(parseShiftFrame(new Uint8Array([0x07, 0x08, 1, ...released, 0x38, 0]))).toEqual({ up: false, down: true });
  });
  it('firmware 1 : ne voit rien au repos', () => {
    expect(parseShiftFrame(new Uint8Array([0x07, 0x08, 0, ...released, 0x38, 1]))).toEqual({ up: false, down: false });
  });
  it('firmware 2 : ne voit rien au repos', () => {
    expect(parseShiftFrame(new Uint8Array([0x23, 0x08, 0xff, 0xff, 0xff, 0xff, 0x0f]))).toEqual({ up: false, down: false });
  });
  it('firmware 2 : lit le bouton droit', () => {
    // Bit 0x1000 à zéro : 0xFFFFEFFF.
    expect(parseShiftFrame(new Uint8Array([0x23, 0x08, 0xff, 0xdf, 0xff, 0xff, 0x0f]))).toEqual({ up: true, down: false });
  });
  it('firmware 2 : lit le bouton gauche', () => {
    // Bit 0x100 à zéro : 0xFFFFFEFF.
    expect(parseShiftFrame(new Uint8Array([0x23, 0x08, 0xff, 0xfd, 0xff, 0xff, 0x0f]))).toEqual({ up: false, down: true });
  });
  it('firmware 2 : ignore les autres boutons', () => {
    expect(parseShiftFrame(new Uint8Array([0x23, 0x08, 0xfe, 0xff, 0xff, 0xff, 0x0f]))).toEqual({ up: false, down: false });
  });
  it('ignore la batterie et les trames inconnues', () => {
    expect(parseShiftFrame(new Uint8Array([0x19, 0x08, 0x64]))).toBeNull();
    expect(parseShiftFrame(new Uint8Array([0x15]))).toBeNull();
  });
  it('ne compte qu’un changement par appui, malgré les répétitions', () => {
    const d = new ShiftDetector();
    const down = new Uint8Array([0x23, 0x08, 0xff, 0xdf, 0xff, 0xff, 0x0f]);
    const up = new Uint8Array([0x23, 0x08, 0xff, 0xff, 0xff, 0xff, 0x0f]);
    expect([d.update(down), d.update(down), d.update(up), d.update(down)]).toEqual(['up', null, null, 'up']);
  });
});
