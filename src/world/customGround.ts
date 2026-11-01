// Vue aérienne inventée du parcours personnalisé : elle remplace la photo IGN des vrais cols
// et donne, comme elle, la teinte du sol et l'emplacement des bois.

import type { TerrainMeta } from '../sim/route';

const MAX_SIDE_PX = 4096;

const smooth = (t: number): number => t * t * (3 - 2 * t);

function lattice(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const top = lattice(ix, iy) * (1 - fx) + lattice(ix + 1, iy) * fx;
  const bottom = lattice(ix, iy + 1) * (1 - fx) + lattice(ix + 1, iy + 1) * fx;
  return top * (1 - fy) + bottom * fy;
}

export function paintCustomGround(terrain: TerrainMeta): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(MAX_SIDE_PX, terrain.cols);
  canvas.height = Math.min(MAX_SIDE_PX, terrain.rows);
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const image = g.createImageData(canvas.width, canvas.height);
  const metresPerPixel = ((terrain.cols - 1) * terrain.stepM) / canvas.width;
  for (let r = 0, k = 0; r < canvas.height; r++) {
    for (let c = 0; c < canvas.width; c++, k += 4) {
      const x = (c * metresPerPixel) / 900;
      const y = (r * metresPerPixel) / 900;
      const patch = noise(x, y) * 0.65 + noise(x * 3.1, y * 3.1) * 0.35;
      const grain = noise(x * 19, y * 19) * 14;
      const forest = patch > 0.52;
      image.data[k] = forest ? 34 + grain * 0.5 : 118 + grain;
      image.data[k + 1] = forest ? 52 + grain * 0.5 : 132 + grain;
      image.data[k + 2] = forest ? 34 + grain * 0.4 : 74 + grain * 0.6;
      image.data[k + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  return canvas;
}
