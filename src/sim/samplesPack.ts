// Points d'une sortie sous forme compacte, pour tenir dans le stockage du navigateur.

import type { RideSample } from './rideStats';

export interface PackedSamples {
  /** Un tableau par grandeur, un élément par seconde de sortie (t = rang + 1). */
  d: number[];
  p: number[];
  c: number[];
  /** Cardio, 0 quand il manque. */
  h: number[];
  a: number[];
  s: number[];
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

export function packSamples(samples: RideSample[]): PackedSamples {
  return {
    d: samples.map((s) => round(s.distanceM, 1)),
    p: samples.map((s) => Math.round(s.powerW)),
    c: samples.map((s) => Math.round(s.cadenceRpm)),
    h: samples.map((s) => (s.heartRateBpm ? Math.round(s.heartRateBpm) : 0)),
    a: samples.map((s) => round(s.altitudeM, 1)),
    s: samples.map((s) => round(s.speedKmh, 1)),
  };
}

export function unpackSamples(packed: PackedSamples): RideSample[] {
  return packed.d.map((distanceM, i) => ({
    t: i + 1,
    distanceM,
    powerW: packed.p[i],
    cadenceRpm: packed.c[i],
    heartRateBpm: packed.h[i] > 0 ? packed.h[i] : null,
    altitudeM: packed.a[i],
    speedKmh: packed.s[i],
  }));
}
