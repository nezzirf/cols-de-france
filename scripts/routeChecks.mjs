// Contrôles automatiques d'un tracé.

const MIN_BACKTRACK_M = 300;
const NEAR_M = 80;
const SAME_LEVEL_M = 7;

/**
 * Cherche les allers-retours : la route repasse en sens inverse, à côté d'elle-même et à la
 * même altitude. Les jambes d'un lacet y échappent, car elles sont à des altitudes différentes.
 * Renvoie les tronçons trouvés sous la forme { fromM, toM }.
 */
export function findBacktracks({ x, z, ele, stepM }) {
  const stride = Math.max(1, Math.round(20 / stepM));
  const span = Math.round(100 / stepM);
  const heading = (i) => {
    const a = Math.max(0, i - stride);
    const b = Math.min(x.length - 1, i + stride);
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const len = Math.hypot(dx, dz) || 1;
    return [dx / len, dz / len];
  };
  const reversed = (i) => {
    const h = heading(i);
    for (let j = i + span; j < x.length; j += stride) {
      if (Math.hypot(x[i] - x[j], z[i] - z[j]) > NEAR_M) continue;
      if (Math.abs(ele[i] - ele[j]) > SAME_LEVEL_M) continue;
      const o = heading(j);
      if (h[0] * o[0] + h[1] * o[1] < -0.7) return j;
    }
    return -1;
  };

  const out = [];
  let start = -1;
  let last = -1;
  const close = (end) => {
    if (start >= 0 && (end - start) * stepM >= MIN_BACKTRACK_M) out.push({ fromM: start * stepM, toM: last * stepM });
    start = -1;
  };
  for (let i = 0; i < x.length; i += stride) {
    const j = reversed(i);
    if (j >= 0) {
      if (start < 0) start = i;
      last = j;
    } else {
      close(i);
    }
  }
  close(x.length - 1);
  return out;
}
