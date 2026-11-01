// Bâtiments réels le long d'un parcours : emprise et hauteurs issues de la BD TOPO de l'IGN.

const WFS =
  'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&outputFormat=application/json&srsName=EPSG:4326';
const CELL_DEG = 0.02; // ≈ 2 km
const PAGE = 5000;
export const CORRIDOR_M = 500;
const CARRIAGEWAY_M = 3.6;
const MAX_NUDGE_M = 5;

export const Kind = { Habitation: 0, Agricole: 1, Religieux: 2, Commerce: 3, Tour: 4, Leger: 5 };

function kindOf(p) {
  if (p.nature === 'Eglise' || p.nature === 'Chapelle' || p.usage_1 === 'Religieux') return Kind.Religieux;
  if (p.nature === 'Tour, donjon' || p.nature === 'Château' || p.nature === 'Fort, blockhaus, casemate') return Kind.Tour;
  if (p.nature === 'Serre' || p.construction_legere) return Kind.Leger;
  if (p.nature?.startsWith('Industriel') || p.usage_1 === 'Agricole' || p.usage_1 === 'Industriel') return Kind.Agricole;
  if (p.usage_1 === 'Commercial et services') return Kind.Commerce;
  return Kind.Habitation;
}

const DEFAULT_WALL_M = {
  [Kind.Habitation]: 5.5,
  [Kind.Agricole]: 5,
  [Kind.Religieux]: 7,
  [Kind.Commerce]: 6,
  [Kind.Tour]: 12,
  [Kind.Leger]: 2.5,
};

/** Hauteur des murs : mesurée par l'IGN, à défaut déduite du nombre d'étages ou de la nature. */
export function wallHeight(p, kind) {
  if (p.hauteur > 0) return p.hauteur;
  if (p.nombre_d_etages > 0) return p.nombre_d_etages * 3;
  return DEFAULT_WALL_M[kind];
}

export function roofRise(p, kind, width) {
  if (p.altitude_maximale_toit != null && p.altitude_minimale_toit != null) {
    const measured = p.altitude_maximale_toit - p.altitude_minimale_toit;
    if (measured >= 0 && measured < 25) return measured < 0.3 ? 0 : measured;
  }
  // Pas de mesure : pente de toit habituelle pour une habitation, plat pour le reste.
  return kind === Kind.Habitation ? Math.min(4, width * 0.3) : 0;
}

async function fetchCell(s, w, n, e, fetchRetry) {
  const features = [];
  for (let start = 0; ; start += PAGE) {
    const url = `${WFS}&COUNT=${PAGE}&STARTINDEX=${start}&BBOX=${s},${w},${n},${e},urn:ogc:def:crs:EPSG::4326`;
    const res = await fetchRetry(url, {}, 'BD TOPO');
    const json = await res.json();
    features.push(...json.features);
    if (json.features.length < PAGE) return features;
  }
}

export async function downloadBuildings(pts, cachedJson, fetchRetry) {
  const margin = (CORRIDOR_M + 150) / 111000;
  const cells = new Set();
  for (const [lat, lon] of pts) {
    for (const dLat of [-margin, margin]) {
      for (const dLon of [-margin * 1.45, margin * 1.45]) {
        cells.add(`${Math.floor((lat + dLat) / CELL_DEG)}/${Math.floor((lon + dLon) / CELL_DEG)}`);
      }
    }
  }
  const jobs = [...cells];
  const byId = new Map();
  let done = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (jobs.length) {
        const cell = jobs.pop();
        const [a, b] = cell.split('/').map(Number);
        const list = await cachedJson(`bdtopo-${a}-${b}`, async () => {
          const f = await fetchCell(
            (a * CELL_DEG).toFixed(4),
            (b * CELL_DEG).toFixed(4),
            ((a + 1) * CELL_DEG).toFixed(4),
            ((b + 1) * CELL_DEG).toFixed(4),
            fetchRetry,
          );
          return f.map((x) => ({ properties: x.properties, geometry: x.geometry }));
        });
        for (const f of list) byId.set(f.properties.cleabs, f);
        process.stdout.write(`\r  bâtiments : ${++done}/${cells.size} zones`);
      }
    }),
  );
  process.stdout.write('\n');
  return [...byId.values()];
}

/** Point de la route le plus proche : distance aux segments, le tracé n'ayant qu'un point tous les 10 m. */
function nearestOnRoute(px, pz, grid) {
  const { x, z } = grid;
  const cx = Math.floor(px / grid.size);
  const cz = Math.floor(pz / grid.size);
  let best = null;
  const test = (i) => {
    if (i < 0 || i + 1 >= x.length) return;
    const dx = x[i + 1] - x[i];
    const dz = z[i + 1] - z[i];
    const t = Math.max(0, Math.min(1, ((px - x[i]) * dx + (pz - z[i]) * dz) / (dx * dx + dz * dz || 1)));
    const qx = x[i] + dx * t;
    const qz = z[i] + dz * t;
    const d = Math.hypot(px - qx, pz - qz);
    if (!best || d < best.d) best = { d, x: qx, z: qz };
  };
  for (let a = cx - 1; a <= cx + 1; a++) {
    for (let b = cz - 1; b <= cz + 1; b++) {
      for (const i of grid.map.get(`${a}/${b}`) ?? []) {
        test(i - 1);
        test(i);
      }
    }
  }
  return best;
}

/** Sommets de l'emprise, plus des points le long des longs murs. */
function outline(ring) {
  const out = [];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
    for (let k = 0; k < steps; k++) out.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps]);
  });
  return out;
}

function closestToRoad(ring, grid) {
  let closest = null;
  for (const [a, b] of outline(ring)) {
    const n = nearestOnRoute(a, b, grid);
    if (n && (!closest || n.d < closest.d)) closest = n;
  }
  return closest;
}

/** Filtre, convertit en mètres locaux et écarte les rares murs qui mordent sur la chaussée. */
export function processBuildings(features, ctx) {
  const { toX, toZ, x, z, excluded } = ctx;
  const grid = { size: CORRIDOR_M, map: new Map(), x, z };
  for (let i = 0; i < x.length; i++) {
    const key = `${Math.floor(x[i] / grid.size)}/${Math.floor(z[i] / grid.size)}`;
    if (!grid.map.has(key)) grid.map.set(key, []);
    grid.map.get(key).push(i);
  }
  const out = [];
  let nudged = 0;
  let maxNudge = 0;
  let dropped = 0;
  for (const f of features) {
    const p = f.properties;
    if (p.etat_de_l_objet !== 'En service') continue;
    for (const polygon of f.geometry.coordinates) {
      const ring = polygon[0].slice(0, -1).map(([lon, lat]) => [toX(lon), toZ(lat)]);
      if (ring.length < 3) continue;
      const first = closestToRoad(ring, grid);
      if (!first || first.d > CORRIDOR_M) continue;
      const cx = ring.reduce((s, q) => s + q[0], 0) / ring.length;
      const cz = ring.reduce((s, q) => s + q[1], 0) / ring.length;
      if (excluded.some(([ex, ez, r]) => Math.hypot(cx - ex, cz - ez) < r)) continue;

      // Le tracé OSM et l'emprise IGN ne sont pas relevés ensemble : on écarte le mur qui
      // mord sur la chaussée, par petits pas car s'éloigner d'un côté peut rapprocher d'un autre.
      let dx = 0;
      let dz = 0;
      let closest = first;
      for (let step = 0; step < 8 && closest.d < CARRIAGEWAY_M; step++) {
        const len = Math.hypot(cx + dx - closest.x, cz + dz - closest.z);
        if (len < 0.5) break;
        const push = CARRIAGEWAY_M - closest.d + 0.05;
        dx += ((cx + dx - closest.x) / len) * push;
        dz += ((cz + dz - closest.z) / len) * push;
        closest = closestToRoad(ring.map(([a, b]) => [a + dx, b + dz]), grid);
      }
      const shift = Math.hypot(dx, dz);
      // Bâtiment à cheval sur la route (passage couvert, emprise erronée) : le décaler
      // l'éloignerait de sa place réelle, on préfère ne pas le poser.
      if (closest.d < CARRIAGEWAY_M - 0.1 || shift > MAX_NUDGE_M) {
        dropped++;
        continue;
      }
      if (shift > 0) {
        nudged++;
        maxNudge = Math.max(maxNudge, shift);
      }
      const xs = ring.map((q) => q[0]);
      const zs = ring.map((q) => q[1]);
      const width = Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      const kind = kindOf(p);
      out.push({
        p: ring.flatMap(([a, b]) => [Math.round((a + dx) * 10) / 10, Math.round((b + dz) * 10) / 10]),
        h: Math.round(wallHeight(p, kind) * 10) / 10,
        r: Math.round(roofRise(p, kind, width) * 10) / 10,
        k: kind,
      });
    }
  }
  return { buildings: out, nudged, maxNudge, dropped };
}
