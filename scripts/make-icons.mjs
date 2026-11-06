// Génère les icônes de l'appli (montagne orange sur fond sombre) : public/icon-192.png, icon-512.png, icon-maskable-512.png
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
function icon(size, safe) {
  const png = new PNG({ width: size, height: size });
  const k = safe; // part de l'image utilisée par le dessin (maskable : zone sûre réduite)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x / size - 0.5) / k + 0.5, v = (y / size - 0.5) / k + 0.5;
    let c = [24, 28, 36];
    if (v > 0.35 && v < 0.85 && u > 0.1 && u < 0.9) {
      const ridge = 0.35 + 0.3 * Math.abs(u - 0.42) * 1.6 + 0.04 * Math.sin(u * 14);
      if (v > ridge) c = v > 0.7 ? [255, 120, 30] : [255, 160, 60];
    }
    const i = (y * size + x) * 4;
    png.data[i] = c[0]; png.data[i + 1] = c[1]; png.data[i + 2] = c[2]; png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
writeFileSync('public/icon-192.png', icon(192, 1));
writeFileSync('public/icon-512.png', icon(512, 1));
writeFileSync('public/icon-maskable-512.png', icon(512, 0.8));
