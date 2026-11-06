import { describe, expect, it } from 'vitest';
import { ActionDetector, ActionGate, parsePadButtons } from '../src/hardware/zwiftPlay';

/** Trame d'une manette Zwift Play (firmware 1) : 0x07 puis des champs protobuf (numéro, valeur). */
function playFrame(fields: [number, number][]): Uint8Array {
  return new Uint8Array([0x07, ...fields.flatMap(([n, v]) => [n << 3, v])]);
}

/** Trame du firmware 2 : 0x23 puis la carte de boutons (champ 1, varint), actifs à l'état bas. */
function rideFrame(pressedMask: number): Uint8Array {
  let map = 0xffff & ~pressedMask;
  const bytes: number[] = [];
  while (map > 0x7f) {
    bytes.push((map & 0x7f) | 0x80);
    map = Math.floor(map / 128);
  }
  bytes.push(map);
  return new Uint8Array([0x23, 1 << 3, ...bytes]);
}

describe('boutons Y et flèches des manettes Zwift Play', () => {
  it('lit Y sur la manette de droite et les flèches sur celle de gauche (firmware 1)', () => {
    // Manette de droite (champ 1 à 0), Y enfoncé (champ 2 à 0), les autres relâchés.
    expect(parsePadButtons(playFrame([[1, 0], [2, 0], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]]))).toEqual({ y: true, up: false, down: false });
    // Manette de gauche (champ 1 à 1), flèche du haut enfoncée.
    expect(parsePadButtons(playFrame([[1, 1], [2, 0], [3, 1], [4, 1], [5, 1], [6, 1], [7, 1]]))).toEqual({ y: false, up: true, down: false });
    // Manette de gauche, flèche du bas enfoncée.
    expect(parsePadButtons(playFrame([[1, 1], [2, 1], [3, 1], [4, 1], [5, 0], [6, 1], [7, 1]]))).toEqual({ y: false, up: false, down: true });
  });

  it('lit Y et les flèches sur la carte commune du firmware 2', () => {
    expect(parsePadButtons(rideFrame(0x40))).toEqual({ y: true, up: false, down: false });
    expect(parsePadButtons(rideFrame(0x2))).toEqual({ y: false, up: true, down: false });
    expect(parsePadButtons(rideFrame(0x8))).toEqual({ y: false, up: false, down: true });
    expect(parsePadButtons(rideFrame(0))).toEqual({ y: false, up: false, down: false });
  });

  it("ignore une trame d'un autre type", () => {
    expect(parsePadButtons(new Uint8Array([0x99, 8, 1]))).toBeNull();
  });

  it("ne déclenche qu'à l'appui, pas au maintien", () => {
    const detector = new ActionDetector();
    expect(detector.update(rideFrame(0))).toEqual([]);
    expect(detector.update(rideFrame(0x40))).toEqual(['lock']);
    expect(detector.update(rideFrame(0x40))).toEqual([]);
    expect(detector.update(rideFrame(0))).toEqual([]);
    expect(detector.update(rideFrame(0x2))).toEqual(['powerUp']);
    expect(detector.update(rideFrame(0x8))).toEqual(['powerDown']);
  });

  it("ne compte qu'une fois un appui rapporté par deux connexions", () => {
    const gate = new ActionGate();
    expect(gate.pass('lock', 1000)).toBe(true);
    expect(gate.pass('lock', 1050)).toBe(false);
    expect(gate.pass('powerUp', 1050)).toBe(true);
    expect(gate.pass('lock', 1300)).toBe(true);
  });
});
