// Bruit de valeur déterministe : le même monde pour tous les joueurs, sans aucune graine à stocker.

export function hash2(x: number, y: number, seed = 0): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

const fade = (t: number): number => t * t * (3 - 2 * t);

export function valueNoise(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const top = hash2(ix, iy, seed) * (1 - fx) + hash2(ix + 1, iy, seed) * fx;
  const bottom = hash2(ix, iy + 1, seed) * (1 - fx) + hash2(ix + 1, iy + 1, seed) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Bruit fractal entre 0 et 1 : chaque octave double la fréquence et divise l'amplitude par deux. */
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * valueNoise(x, y, seed + i);
    norm += amplitude;
    x = x * 2.03 + 17;
    y = y * 2.03 + 17;
    amplitude *= 0.5;
  }
  return sum / norm;
}

/** Crêtes aiguës : le bruit est replié sur lui-même, d'où des arêtes de montagne plutôt que des bosses. */
export function ridged(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0;
  let amplitude = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const r = 1 - Math.abs(valueNoise(x, y, seed + i) * 2 - 1);
    sum += amplitude * r * r;
    norm += amplitude;
    x = x * 2.1 + 31;
    y = y * 2.1 + 31;
    amplitude *= 0.5;
  }
  return sum / norm;
}

export const smoothstep = (a: number, b: number, v: number): number => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
