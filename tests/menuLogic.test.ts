import { describe, expect, it } from 'vitest';
import { findBacktracks } from '../scripts/routeChecks.mjs';
import { buildCustomRoute, MAX_CLIMB_KM, WARMUP_KM } from '../src/sim/customRoute';
import {
  expandBlocks,
  newBlock,
  totalDuration,
  trainingLoad,
  WORKOUT_PRESETS,
  workoutStateAt,
  zoneColor,
} from '../src/sim/workout';
import { encodeTargetPower, encodeWahooErg } from '../src/hardware/ftmsProtocol';
import { fecTargetPower } from '../src/hardware/antProtocol';
import { ALL_BIKES, BIKE_JERSEY, JERSEYS, wearing } from '../src/sim/bikes';

describe('parcours personnalisé', () => {
  it.each([0, 4, 8, 20])('garde 5 km de plat quelle que soit la pente (%i %%)', (gradePct) => {
    const { route } = buildCustomRoute({ climbKm: 10, gradePct });
    expect(route.data.footM).toBe(WARMUP_KM * 1000);
    expect(Math.abs(route.eleAt(4900) - route.eleAt(0))).toBeLessThan(0.01);
  });
  it('tient la pente choisie sur la montée', () => {
    const { route } = buildCustomRoute({ climbKm: 8, gradePct: 7.5 });
    expect(route.gradeAt(5500)).toBeCloseTo(7.5, 1);
    expect(route.gradeAt(12000)).toBeCloseTo(7.5, 1);
    expect(route.averageGrade(5200, 12800)).toBeCloseTo(7.5, 1);
  });
  it('fait la distance demandée, échauffement en plus', () => {
    const { route } = buildCustomRoute({ climbKm: 12, gradePct: 5 });
    expect(route.lengthM).toBe(17000);
    expect(route.data.segments[0].startM).toBe(5000);
    expect(route.data.segments[0].endM).toBe(17000);
  });
  it('continue après l’arrivée, sans s’arrêter net', () => {
    const { route } = buildCustomRoute({ climbKm: 3, gradePct: 6 });
    expect(route.pathM).toBeGreaterThan(route.lengthM + 300);
  });
  it('accepte un parcours tout plat', () => {
    const { route } = buildCustomRoute({ climbKm: 20, gradePct: 0 });
    expect(route.data.climb.gainM).toBe(0);
  });
  it('borne les valeurs extrêmes', () => {
    const { route } = buildCustomRoute({ climbKm: 500, gradePct: 80 });
    expect(route.lengthM).toBe(WARMUP_KM * 1000 + MAX_CLIMB_KM * 1000);
    expect(route.data.climb.avgGradePct).toBe(20);
  });
  it('ne fait ni aller-retour ni boucle', () => {
    const { route } = buildCustomRoute({ climbKm: 15, gradePct: 6 });
    expect(findBacktracks(route.data)).toEqual([]);
  });
  it('produit un relief complet, sans trou', () => {
    const { route, heights } = buildCustomRoute({ climbKm: 5, gradePct: 8 });
    const t = route.data.terrain;
    expect(heights.length).toBe(t.cols * t.rows);
    expect(heights.every(Number.isFinite)).toBe(true);
  });
  it('sépare les records selon la distance et la pente', () => {
    const a = buildCustomRoute({ climbKm: 5, gradePct: 8 }).route.data.segments[0].id;
    const b = buildCustomRoute({ climbKm: 5, gradePct: 9 }).route.data.segments[0].id;
    expect(a).not.toBe(b);
  });
});

describe('séances par blocs', () => {
  it('déroule des intervalles en efforts et récupérations', () => {
    const steps = expandBlocks([{ ...newBlock('intervalles'), durationS: 60, restS: 30, repeat: 3 }]);
    expect(steps).toHaveLength(6);
    expect(totalDuration(steps)).toBe(270);
  });
  it('enchaîne les blocs sans trou', () => {
    const steps = expandBlocks([newBlock('echauffement'), newBlock('stable'), newBlock('recuperation')]);
    for (let i = 1; i < steps.length; i++) expect(steps[i].startS).toBe(steps[i - 1].startS + steps[i - 1].durationS);
  });
  it('donne une puissance constante sur un bloc stable', () => {
    const steps = expandBlocks([{ ...newBlock('stable'), durationS: 100, fromPct: 90, toPct: 40 }]);
    expect(workoutStateAt(steps, 10)?.targetPct).toBe(90);
    expect(workoutStateAt(steps, 90)?.targetPct).toBe(90);
  });
  it('monte progressivement sur une rampe', () => {
    const steps = expandBlocks([{ ...newBlock('rampe'), durationS: 100, fromPct: 50, toPct: 100 }]);
    expect(workoutStateAt(steps, 50)?.targetPct).toBeCloseTo(75, 6);
  });
  it('indique le temps restant dans l’étape', () => {
    const steps = expandBlocks([newBlock('stable')]);
    expect(workoutStateAt(steps, 100)?.stepLeftS).toBe(200);
  });
  it('s’arrête à la fin de la séance', () => {
    expect(workoutStateAt(expandBlocks([newBlock('stable')]), 301)).toBeNull();
  });
  it('compte 100 points de charge pour une heure à FTP', () => {
    const steps = expandBlocks([{ ...newBlock('stable'), durationS: 3600, fromPct: 100, toPct: 100 }]);
    expect(trainingLoad(steps)).toBeCloseTo(100, 3);
  });
  it('colore les zones de la plus facile à la plus dure', () => {
    expect(new Set([50, 70, 85, 100, 110, 130].map(zoneColor)).size).toBe(6);
  });
  it('propose des séances prêtes à l’emploi et valides', () => {
    for (const w of WORKOUT_PRESETS) expect(totalDuration(expandBlocks(w.blocks))).toBeGreaterThan(600);
  });
});

describe('maillots', () => {
  const bike = ALL_BIKES[3];
  it('garde la tenue du vélo par défaut', () => {
    expect(wearing(bike, BIKE_JERSEY).jersey).toBe(bike.jersey);
  });
  it('change le maillot sans toucher au cadre', () => {
    const dressed = wearing(bike, JERSEYS[0].id);
    expect(dressed.jersey).toBe(JERSEYS[0].color);
    expect(dressed.frame).toBe(bike.frame);
    expect(dressed.cda).toBe(bike.cda);
  });
  it('propose le maillot de chaque équipe', () => {
    expect(JERSEYS.filter((j) => j.team)).toHaveLength(18);
  });
});

describe('mode ERG', () => {
  it('encode la puissance cible FTMS', () => {
    expect(Array.from(encodeTargetPower(250))).toEqual([0x05, 0xfa, 0x00]);
  });
  it('encode la puissance cible Wahoo', () => {
    expect(Array.from(encodeWahooErg(300))).toEqual([0x42, 0x2c, 0x01]);
  });
  it('encode la page 49 ANT+ par quarts de watt', () => {
    const p = fecTargetPower(250);
    expect(p[0]).toBe(0x31);
    expect(p[6] | (p[7] << 8)).toBe(1000);
  });
  it('borne une puissance négative à zéro', () => {
    expect(Array.from(encodeTargetPower(-20))).toEqual([0x05, 0, 0]);
  });
});
