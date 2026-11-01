// Contrôles automatiques d'un tracé.

/** Aller-retour large (deux routes parallèles) ou court (demi-tour sur la même rue). */
const PASSES = [
  { minLengthM: 300, nearM: 80, spanM: 100 },
  { minLengthM: 90, nearM: 14, spanM: 40 },
];
const SAME_LEVEL_M = 7;

/**
 * Cherche les allers-retours : la route repasse en sens inverse, à côté d'elle-même et à la
 * même altitude. Les jambes d'un lacet y échappent, car elles sont à des altitudes différentes.
 * Renvoie les tronçons trouvés sous la forme { fromM, toM }.
 */
export function findBacktracks(route) {
  return PASSES.flatMap((pass) => scan(route, pass));
}

function scan({ x, z, ele, stepM }, { minLengthM, nearM, spanM }) {
  const stride = Math.max(1, Math.round(20 / stepM));
  const span = Math.round(spanM / stepM);
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
      if (Math.hypot(x[i] - x[j], z[i] - z[j]) > nearM) continue;
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
    if (start >= 0 && (end - start) * stepM >= minLengthM) out.push({ fromM: start * stepM, toM: last * stepM });
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

const DETOUR_NEAR_M = 25;
const DETOUR_LEVEL_M = 5;
const DETOUR_MIN_M = 120;
const DETOUR_MAX_M = 1500;

/** Un lacet fait faire un demi-tour d'un seul tenant : entre 150 et 210 degrés de virage cumulé. */
const HAIRPIN_TURN_MIN_DEG = 150;
const HAIRPIN_TURN_MAX_DEG = 210;

/** Virage cumulé (degrés) de la route entre les points i et j. */
function turnBetween(x, z, i, j) {
  let turn = 0;
  let previous = null;
  for (let k = i + 1; k <= j; k++) {
    const heading = Math.atan2(z[k] - z[k - 1], x[k] - x[k - 1]);
    if (previous !== null) {
      let delta = heading - previous;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      turn += delta;
    }
    previous = heading;
  }
  return (turn * 180) / Math.PI;
}

/**
 * Cherche les boucles : la route revient à côté d'elle-même, presque à la même altitude, après un
 * court détour. Un vrai lacet y échappe de deux façons : il prend de la hauteur entre ses deux jambes,
 * ou, sur une pente douce où les jambes restent au même niveau, il tourne d'un seul tenant d'environ
 * un demi-tour, alors qu'une boucle parasite tourne d'un tour entier ou revient sur ses pas.
 * Renvoie les tronçons trouvés sous la forme { fromM, toM }.
 */
export function findDetours({ x, z, ele, stepM }) {
  const out = [];
  const first = Math.round(DETOUR_MIN_M / stepM);
  const last = Math.round(DETOUR_MAX_M / stepM);
  let resume = -1;
  for (let i = 0; i < x.length; i++) {
    if (out.length && i * stepM <= out[out.length - 1].toM) continue;
    if (i <= resume) continue;
    for (let j = i + first; j <= Math.min(x.length - 1, i + last); j++) {
      if (Math.hypot(x[i] - x[j], z[i] - z[j]) > DETOUR_NEAR_M) continue;
      if (Math.abs(ele[i] - ele[j]) > DETOUR_LEVEL_M) continue;
      const turn = Math.abs(turnBetween(x, z, i, j));
      if (turn >= HAIRPIN_TURN_MIN_DEG && turn <= HAIRPIN_TURN_MAX_DEG) {
        resume = j;
        break;
      }
      out.push({ fromM: i * stepM, toM: j * stepM });
      break;
    }
  }
  return out;
}
