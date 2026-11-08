// Peinture d'un vélo sans texture d'après la photo du vélo : chaque point du maillage prend la couleur de la photo à sa place vue de profil.
// L'image (voir MeshBikeSpec.photo) empile en haut la couleur, avec les écritures sombres, et en bas le masque des écritures blanches.
// La photo montre le côté de la transmission ; de l'autre côté, la peinture est la même et les écritures sont retournées le long de leur axe,
// pour se lire à l'endroit en regardant le vélo depuis ce côté.

import * as THREE from 'three';
import type { MeshBikeSpec } from './meshBike';

type Photo = NonNullable<MeshBikeSpec['photo']>;

const srgbToLinear = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = new THREE.Color().setRGB(i / 255, i / 255, i / 255, THREE.SRGBColorSpace).r;
  return lut;
})();

/** Charge l'image de peinture et renvoie la fonction qui donne la couleur d'un point du modèle (x, y, z). */
export async function loadPhotoPaint(photo: Photo, hubY: number): Promise<(x: number, y: number, z: number) => [number, number, number]> {
  const image = new Image();
  image.src = photo.url;
  await image.decode();
  const width = image.naturalWidth;
  const height = image.naturalHeight / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height * 2;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, width, height * 2).data;
  const white = srgbToLinear[243];
  const lettering = photo.lettering ?? [];
  const channel = (x: number, y: number, c: number): number => data[(y * width + x) * 4 + c];
  return (x, y, z) => {
    // Le point sur la photo (vue de profil, le vélo regarde vers la droite).
    let px = photo.centerX - z * photo.scale;
    let py = photo.centerY - (y - hubY) * photo.scale;
    if (x < 0) {
      for (const zone of lettering) {
        const u = (px - zone.cx) * zone.dx + (py - zone.cy) * zone.dy;
        const v = -(px - zone.cx) * zone.dy + (py - zone.cy) * zone.dx;
        if (Math.abs(u) <= zone.halfLen && Math.abs(v) <= zone.halfWid) {
          px -= 2 * u * zone.dx;
          py -= 2 * u * zone.dy;
          break;
        }
      }
    }
    const fx = Math.min(width - 1.001, Math.max(0, px));
    const fy = Math.min(height - 1.001, Math.max(0, py));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const read = (offsetY: number, c: number): number =>
      lerp(lerp(channel(x0, y0 + offsetY, c), channel(x0 + 1, y0 + offsetY, c), tx), lerp(channel(x0, y0 + 1 + offsetY, c), channel(x0 + 1, y0 + 1 + offsetY, c), tx), ty);
    const text = read(height, 0) / 255;
    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const base = srgbToLinear[Math.round(read(0, c))];
      out[c] = base + (white - base) * text;
    }
    return out;
  };
}
