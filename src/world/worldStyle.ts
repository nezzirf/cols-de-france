// Apparence de chaque biome du monde d'entraînement : brume, nom annoncé, roche.

import * as THREE from 'three';
import type { WorldBiome } from '../sim/worldBiomes';

export interface BiomeStyle {
  /** Annonce affichée en entrant dans le biome. */
  label: string;
  fog: number;
  density: number;
  rock: number;
  /** Couleur de la bande de ce biome sur les profils du menu. */
  swatch: string;
}

export const WORLD_STYLE: Record<WorldBiome, BiomeStyle> = {
  plage: { label: 'Plage de sable fin', fog: 0xd2e6ef, density: 0.00009, rock: 0xa89c86, swatch: '#ead7a8' },
  prairie: { label: 'Prairies fleuries', fog: 0xcfe2ea, density: 0.00009, rock: 0x8f8d84, swatch: '#8fbf55' },
  foret: { label: 'Forêt profonde', fog: 0xb8cdc6, density: 0.00015, rock: 0x6b6962, swatch: '#3f6b3a' },
  montagne: { label: 'Montagne enneigée', fog: 0xdce9f4, density: 0.00007, rock: 0x7b7e86, swatch: '#e9f0f8' },
  canyon: { label: 'Canyon rouge', fog: 0xe9d3bd, density: 0.0001, rock: 0x9a5a3c, swatch: '#c0643b' },
  desert: { label: 'Désert de dunes', fog: 0xf0ddb8, density: 0.00012, rock: 0xc8aa78, swatch: '#ecd29a' },
};

const scratch = new THREE.Color();

/** Brume et densité mélangées selon les poids : la transition suit donc celle du décor. */
export function worldAmbience(weights: number[], biomes: WorldBiome[], out: { color: THREE.Color; density: number }): void {
  out.color.setRGB(0, 0, 0);
  out.density = 0;
  for (let k = 0; k < biomes.length; k++) {
    const style = WORLD_STYLE[biomes[k]];
    const w = Math.max(0, weights[k]);
    scratch.set(style.fog);
    out.color.r += scratch.r * w;
    out.color.g += scratch.g * w;
    out.color.b += scratch.b * w;
    out.density += style.density * w;
  }
}
