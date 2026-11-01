// Vue aérienne peinte du monde d'entraînement : la couleur du sol de chaque biome, mélangée selon
// les mêmes poids que le relief et la végétation. Elle joue le rôle de la photo IGN des vrais cols.

import { fbm, hash2, smoothstep } from '../sim/noise';
import type { TerrainMeta } from '../sim/route';
import { biomeWeights, snowAmount, type WorldBiome, type WorldMeta } from '../sim/worldBiomes';

type RGB = [number, number, number];

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

interface Spot {
  x: number;
  z: number;
  h: number;
  /** Abscisse du motif : repliée en miroir autour du départ, pour que le décor se raccorde d'un tour à l'autre. */
  fine: number;
  wide: number;
}

const GROUND: Record<WorldBiome, (s: Spot) => RGB> = {
  plage: ({ x, z, h, fine, wide }) => {
    const dry = mix([233, 214, 172], [219, 197, 152], fine);
    // Le sable mouillé foncé longe l'eau ; plus haut, des touffes de dune jaunissent le sable.
    const sand = mix([150, 130, 98], dry, smoothstep(0.1, 1.6, h));
    return mix(sand, [152, 158, 88], smoothstep(0.58, 0.72, wide) * smoothstep(2.2, 3.4, h) * 0.8 + 0 * (x + z));
  },
  prairie: ({ x, z, fine, wide }) => {
    const parcel = hash2(Math.floor(x / 120), Math.floor(z / 75), 9) > 0.5 ? 1 : 0;
    const green = mix([98, 146, 56], [150, 176, 76], parcel * 0.6 + fine * 0.4);
    return mix(green, [168, 162, 88], smoothstep(0.62, 0.8, wide) * 0.5);
  },
  foret: ({ fine, wide }) => mix(mix([42, 64, 36], [68, 90, 46], fine), [34, 52, 32], wide * 0.5),
  montagne: ({ h, fine, wide }) => {
    const meadow = mix([92, 110, 66], [124, 126, 100], fine);
    const snow = mix([238, 243, 250], [212, 223, 240], fine * 0.8);
    return mix(meadow, snow, snowAmount(h, wide));
  },
  canyon: ({ h, fine, wide }) => {
    const strata = 0.5 + 0.5 * Math.sin(h * 0.32 + wide * 5);
    const red = mix([168, 82, 50], [208, 128, 82], strata);
    const pale = smoothstep(0.85, 1, 0.5 + 0.5 * Math.sin(h * 0.11 + 1.3)) * 0.6;
    const c = mix(red, [224, 196, 158], pale);
    return mix(c, [c[0] * 0.88, c[1] * 0.88, c[2] * 0.88], fine);
  },
  desert: ({ x, z, fine }) => {
    const ripple = 0.5 + 0.5 * Math.sin((x * 0.6 + z * 0.8) * 0.35 + fine * 4);
    const c = mix([238, 214, 160], [222, 194, 138], fine);
    const k = 0.94 + 0.08 * ripple;
    return [c[0] * k, c[1] * k, c[2] * k];
  },
};

/** Peint toute la grille du relief : un pixel par maille, ce qui suffit, le détail venant du shader. */
export function paintWorldGround(terrain: TerrainMeta, heights: Float32Array, world: WorldMeta): HTMLCanvasElement {
  const { cols, rows, stepM, x0, z0 } = terrain;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const image = g.createImageData(cols, rows);
  const biomes = world.zones.map((z) => z.biome);
  const weights = new Array<number>(biomes.length).fill(0);
  const patch = new Array<number>(biomes.length).fill(0);
  const period = world.periodM;
  for (let c = 0; c < cols; c++) {
    const x = x0 + ((c + 0.5) / cols) * (cols - 1) * stepM;
    const wx = x - period * Math.floor(x / period);
    const nx = Math.min(wx, period - wx);
    biomeWeights(wx, world, weights);
    for (let r = 0; r < rows; r++) {
      const z = z0 + ((r + 0.5) / rows) * (rows - 1) * stepM;
      const spot: Spot = {
        x: wx,
        z,
        h: heights[r * cols + c],
        fine: fbm(nx / 70, z / 70, 3, 11),
        wide: fbm(nx / 400, z / 400, 3, 12),
      };
      // Sur une lisière, chaque biome gagne du terrain par plaques : neige et roche rouge se côtoient
      // au lieu de se fondre en rose. Loin des lisières, les poids sont purs et rien ne change.
      // Le bruit, très contrasté, désigne le gagnant de chaque plaque ; l'exponentielle garde ses bords doux.
      let best = -Infinity;
      for (let k = 0; k < biomes.length; k++) {
        const w = weights[k];
        if (w < 0.003) {
          patch[k] = -Infinity;
          continue;
        }
        const noise = Math.max(-0.5, Math.min(0.5, (fbm(nx / 260, z / 260, 2, 21 + k) - 0.5) * 3));
        patch[k] = w + 0.9 * noise;
        best = Math.max(best, patch[k]);
      }
      let sum = 0;
      for (let k = 0; k < biomes.length; k++) {
        patch[k] = patch[k] === -Infinity ? 0 : Math.exp(14 * (patch[k] - best));
        sum += patch[k];
      }
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let k = 0; k < biomes.length; k++) {
        if (patch[k] === 0) continue;
        const w = patch[k] / sum;
        const colour = GROUND[biomes[k]](spot);
        red += colour[0] * w;
        green += colour[1] * w;
        blue += colour[2] * w;
      }
      const i = (r * cols + c) * 4;
      image.data[i] = red;
      image.data[i + 1] = green;
      image.data[i + 2] = blue;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}
