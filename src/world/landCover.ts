// Occupation du sol lue sur la photo aérienne : c'est elle qui dit où poussent les arbres.

import type { TerrainMeta } from '../sim/route';

/** Vrai pour un pixel de couvert forestier : sombre et vert, ou ombre sous les arbres. */
export function isForestPixel(r: number, g: number, b: number): boolean {
  const luma = 0.3 * r + 0.59 * g + 0.11 * b;
  if (luma < 58) return g >= b * 0.92;
  return luma < 105 && g >= r * 1.02 && g >= b * 1.05;
}

export class LandCover {
  private pixels: Uint8ClampedArray | null = null;
  private width = 0;
  private height = 0;

  constructor(
    image: HTMLImageElement | HTMLCanvasElement,
    private terrain: TerrainMeta,
  ) {
    const canvas = document.createElement('canvas');
    this.width = canvas.width = 'naturalWidth' in image ? image.naturalWidth : image.width;
    this.height = canvas.height = 'naturalHeight' in image ? image.naturalHeight : image.height;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.drawImage(image, 0, 0);
    this.pixels = g.getImageData(0, 0, this.width, this.height).data;
  }

  isForest(x: number, z: number): boolean {
    if (!this.pixels) return false;
    const t = this.terrain;
    const c = Math.floor(((x - t.x0) / ((t.cols - 1) * t.stepM)) * this.width);
    const r = Math.floor(((z - t.z0) / ((t.rows - 1) * t.stepM)) * this.height);
    if (c < 0 || r < 0 || c >= this.width || r >= this.height) return false;
    const k = (r * this.width + c) * 4;
    return isForestPixel(this.pixels[k], this.pixels[k + 1], this.pixels[k + 2]);
  }
}
