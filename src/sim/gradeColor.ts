// Échelle de couleur de la pente : du BLANC (plat, descente) au NOIR (pentes extrêmes).

const STOPS: [number, [number, number, number]][] = [
  [0, [255, 255, 255]],
  [3, [255, 240, 170]],
  [5, [255, 205, 40]],
  [7, [250, 130, 20]],
  [9, [225, 35, 30]],
  [11, [130, 10, 35]],
  [13, [45, 5, 20]],
  [15, [0, 0, 0]],
];

export function gradeRgb(gradePct: number): [number, number, number] {
  const g = Math.max(STOPS[0][0], Math.min(STOPS[STOPS.length - 1][0], gradePct));
  for (let i = 1; i < STOPS.length; i++) {
    const [g1, c1] = STOPS[i];
    if (g <= g1) {
      const [g0, c0] = STOPS[i - 1];
      const t = (g - g0) / (g1 - g0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [number, number, number];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function gradeColor(gradePct: number): string {
  const [r, g, b] = gradeRgb(gradePct);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Couleur de texte lisible sur la couleur de pente. */
export function gradeTextColor(gradePct: number): string {
  const [r, g, b] = gradeRgb(gradePct);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 120 ? '#0b0d10' : '#ffffff';
}
