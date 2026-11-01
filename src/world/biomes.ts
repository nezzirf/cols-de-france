// Ambiance selon l'altitude : chaque col a ses propres limites et sa propre roche
// (le Ventoux devient lunaire vers 1500 m, là où le Galibier est encore en alpage).

import type { Biomes } from '../sim/route';

export type BiomeName = 'vallée' | 'forêt' | 'alpage' | 'haute montagne';

export function biomeAt(ele: number, b: Biomes): BiomeName {
  if (ele < b.valley) return 'vallée';
  if (ele < b.forest) return 'forêt';
  if (ele < b.alpage) return 'alpage';
  return 'haute montagne';
}

export const ROCK_COLORS: Record<Biomes['rock'], number> = {
  gris: 0x8b8984,
  calcaire: 0xa8a297,
  schiste: 0x615c58,
  dolomie: 0xc9ae88,
};

export interface Ambience {
  fog: number;
  density: number;
}

const AMBIENCE: Record<BiomeName, Ambience> = {
  vallée: { fog: 0xcad9e2, density: 0.000085 },
  forêt: { fog: 0xbfd3df, density: 0.0001 },
  alpage: { fog: 0xc4dbea, density: 0.000065 },
  'haute montagne': { fog: 0xd2e4f0, density: 0.00005 },
};

export function ambienceOf(biome: BiomeName): Ambience {
  return AMBIENCE[biome];
}

export function biomeLabel(biome: BiomeName, b: Biomes): string {
  const trees: Record<Biomes['trees'], string> = {
    mixte: 'Forêt de feuillus et de sapins',
    cedre: 'Forêt de cèdres et de hêtres',
    hetre: 'Hêtraie-sapinière',
    sapin: 'Forêt de sapins et d’épicéas',
    meleze: 'Forêt de mélèzes',
  };
  if (biome === 'vallée') return 'Fond de vallée';
  if (biome === 'forêt') return trees[b.trees];
  if (biome === 'alpage') return 'Alpages';
  return b.rock === 'calcaire' ? 'Pierrier lunaire' : b.rock === 'dolomie' ? 'Éboulis de la Casse Déserte' : 'Haute montagne';
}
