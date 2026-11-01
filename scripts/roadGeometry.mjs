// Géométrie du tracé. OSM décrit un lacet par deux jambes presque collées qui se rejoignent en
// pointe, avec un rayon de 3 à 5 m. Une vraie épingle s'évase en goutte d'eau : ce sont les
// jambes qu'il faut écarter, car lisser le tracé ferait seulement reculer le virage.

const HAIRPIN_TURN_DEG = 100;
const TURN_SPAN = 4; // échantillons de part et d'autre pour mesurer l'angle du virage
const WINDOW = 9; // échantillons touchés de chaque côté du sommet
const PASSES = 3;

function circumRadius(ax, az, bx, bz, cx, cz) {
  const a = Math.hypot(bx - cx, bz - cz);
  const b = Math.hypot(ax - cx, az - cz);
  const c = Math.hypot(ax - bx, az - bz);
  const cross = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  return cross < 1e-9 ? Infinity : (a * b * c) / (2 * cross);
}

function radiusAt(x, z, i) {
  return circumRadius(x[i - 1], z[i - 1], x[i], z[i], x[i + 1], z[i + 1]);
}

/** Plus petit rayon de courbure du tracé, sur trois points consécutifs. */
export function minRadius(x, z) {
  let min = Infinity;
  for (let i = 1; i + 1 < x.length; i++) min = Math.min(min, radiusAt(x, z, i));
  return min;
}

function turnAngle(x, z, i) {
  const a = i - TURN_SPAN;
  const b = i + TURN_SPAN;
  if (a < 1 || b >= x.length - 1) return 0;
  const h1 = Math.atan2(x[i - 1] - x[a], z[i - 1] - z[a]);
  const h2 = Math.atan2(x[b] - x[i + 1], z[b] - z[i + 1]);
  let d = ((h2 - h1) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
}

/** Sommets des épingles : le point le plus serré de chaque virage assez fermé. */
export function findHairpinApexes(x, z, radius) {
  const out = [];
  for (let i = TURN_SPAN + 1; i < x.length - TURN_SPAN - 1; i++) {
    if (turnAngle(x, z, i) < HAIRPIN_TURN_DEG) continue;
    let j = i;
    let apex = i;
    while (j < x.length - TURN_SPAN - 1 && turnAngle(x, z, j) >= HAIRPIN_TURN_DEG) {
      if (radiusAt(x, z, j) < radiusAt(x, z, apex)) apex = j;
      j++;
    }
    if (radiusAt(x, z, apex) < radius * 1.5) out.push(apex);
    i = j;
  }
  return out;
}

function spreadAround(x, z, apex, radius) {
  const inX = (x[apex - 3] + x[apex + 3]) / 2 - x[apex];
  const inZ = (z[apex - 3] + z[apex + 3]) / 2 - z[apex];
  const len = Math.hypot(inX, inZ) || 1;
  const cx = x[apex] + (inX / len) * radius;
  const cz = z[apex] + (inZ / len) * radius;
  const from = Math.max(1, apex - WINDOW);
  const to = Math.min(x.length - 2, apex + WINDOW);
  for (let i = from; i <= to; i++) {
    const d = Math.hypot(x[i] - cx, z[i] - cz);
    if (d >= radius || d < 0.01) continue;
    x[i] = cx + ((x[i] - cx) / d) * radius;
    z[i] = cz + ((z[i] - cz) / d) * radius;
  }
  // Fond le raccord entre le cercle et les jambes, sans toucher aux bords de la zone.
  const px = x.slice(from - 1, to + 2);
  const pz = z.slice(from - 1, to + 2);
  for (let i = from; i <= to; i++) {
    const k = i - from + 1;
    const taper = Math.min(1, Math.min(i - from + 1, to - i + 1) / 3);
    x[i] += 0.3 * taper * (px[k - 1] + px[k + 1] - 2 * px[k]);
    z[i] += 0.3 * taper * (pz[k - 1] + pz[k + 1] - 2 * pz[k]);
  }
}

/** Évase les épingles au rayon voulu. Renvoie le tracé et le plus grand déplacement. */
export function roundTightBends(xIn, zIn, radius) {
  const x = xIn.slice();
  const z = zIn.slice();
  const apexes = findHairpinApexes(x, z, radius);
  for (let pass = 0; pass < PASSES; pass++) {
    for (const apex of apexes) spreadAround(x, z, apex, radius);
  }
  let shift = 0;
  for (let i = 0; i < x.length; i++) shift = Math.max(shift, Math.hypot(x[i] - xIn[i], z[i] - zIn[i]));
  return { x, z, shift, hairpins: apexes.length };
}
