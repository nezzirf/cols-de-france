import { describe, expect, it } from 'vitest';
import { ALL_BIKES, BIKE_JERSEY, findBike, JERSEYS, TEAMS, wearing } from '../src/sim/bikes';
import { KIT_STYLES, plainLivery } from '../src/sim/kits';

describe('tenues des équipes', () => {
  it('donne un motif, un cuissard et un casque à chacune des 18 équipes', () => {
    for (const t of TEAMS) {
      expect(KIT_STYLES).toContain(t.livery.style);
      expect(t.livery.shorts).toBeGreaterThanOrEqual(0);
      expect(t.livery.helmet).toBeGreaterThanOrEqual(0);
      expect(t.livery.trim).toBeGreaterThanOrEqual(0);
    }
  });
  it('ne met pas la seconde couleur sur un maillot qui est déjà de cette couleur', () => {
    for (const t of TEAMS.filter((t) => t.livery.style !== 'plain')) expect(t.livery.second).not.toBe(t.jersey);
  });
  it('peint le cadre de chaque équipe de deux couleurs, la seconde en dégradé', () => {
    for (const t of TEAMS) {
      expect(t.coat).not.toBeNull();
      expect(['rear', 'front', 'low', 'high']).toContain(t.coat!.fade);
      expect(t.coat!.second).not.toBe(t.frame);
    }
    for (const b of ALL_BIKES.filter((b) => b.team)) expect(b.coat).toBe(b.team!.coat);
  });
  it('laisse les vélos sans équipe d’une seule couleur', () => {
    for (const b of ALL_BIKES.filter((b) => !b.team)) expect(b.coat).toBeNull();
  });
  it('habille le vélo d’une équipe de sa tenue', () => {
    for (const b of ALL_BIKES.filter((b) => b.team)) expect(b.livery).toBe(b.team!.livery);
  });
  it('distingue les tenues des équipes', () => {
    const looks = TEAMS.map((t) => JSON.stringify([t.jersey, t.livery]));
    expect(new Set(looks).size).toBe(TEAMS.length);
  });
});

describe('maillot choisi', () => {
  it('apporte avec lui le cuissard, les manches et le casque de l’équipe', () => {
    const bike = findBike('generique:polyvalent');
    const dressed = wearing(bike, 'groupama');
    expect(dressed.jersey).toBe(TEAMS.find((t) => t.id === 'groupama')!.jersey);
    expect(dressed.livery.sleeveL).not.toBeNull();
    expect(dressed.livery.sleeveR).toBeNull();
    expect(dressed.frame).toBe(bike.frame);
  });
  it('laisse la tenue du vélo quand on garde le maillot du vélo', () => {
    const team = ALL_BIKES.find((b) => b.team?.id === 'uae')!;
    expect(wearing(team, BIKE_JERSEY).livery).toBe(team.livery);
  });
  it('donne une tenue unie à un maillot de couleur, casque et liserés comme avant', () => {
    const bike = findBike('generique:polyvalent');
    const plain = JERSEYS.find((j) => !j.team)!;
    const dressed = wearing(bike, plain.id);
    expect(dressed.livery).toEqual(plainLivery(dressed.accent));
    expect(dressed.livery.style).toBe('plain');
  });
});

describe('modèles 3D propres à un vélo', () => {
  it('donne un modèle propre au seul RCR-R de Decathlon et au seul Y1Rs d’UAE', () => {
    const withAsset = ALL_BIKES.filter((b) => b.asset).map((b) => b.id);
    expect(withAsset).toEqual(['decathlon:RCR-R', 'uae:Y1Rs']);
    expect(findBike('decathlon:RCR-R').asset).toBe('rcr');
    expect(findBike('decathlon:RCR-F').asset).toBeUndefined();
  });
});
