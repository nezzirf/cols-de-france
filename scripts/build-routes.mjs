// Construit les données de chaque col à partir de sources réelles :
//   tracé    : routeur OSRM (données OpenStreetMap)
//   altitude : IGN RGE ALTI (Géoplateforme)
//   relief   : Terrarium / Mapzen (tuiles z13) rééchantillonné sur une grille métrique
//   bâtiments : IGN BD TOPO (emprise, hauteur des murs et du toit)
//   paysage  : photos aériennes IGN BD ORTHO
// Sorties dans public/data/<id>/ : route.json, route.gpx, terrain.bin, buildings.json, ortho.jpg
// Usage : npm run routes            (tous les cols)
//         npm run routes -- ventoux (un seul)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { downloadBuildings, processBuildings } from './buildings.mjs';
import { buildOrtho } from './ortho.mjs';
import { ROUTES } from './route-defs.mjs';
import { roundTightBends } from './roadGeometry.mjs';
import { findBacktracks } from './routeChecks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache');
const OUT = path.join(ROOT, 'public', 'data');
const SAMPLE_M = 10;
/** Rayon de l'axe de la route au sommet d'une épingle. */
const MIN_BEND_RADIUS_M = 9;
const TERRAIN_STEP_M = 20;
const TERRAIN_MARGIN_M = 5000;
const TILE_ZOOM = 13;
const EARTH_R = 6371008.8;
const RAD = Math.PI / 180;

fs.mkdirSync(CACHE, { recursive: true });

async function cachedJson(key, load) {
  const file = path.join(CACHE, `${key}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const value = await load();
  fs.writeFileSync(file, JSON.stringify(value));
  return value;
}

async function fetchRetry(url, init, label) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      if (attempt >= 4) throw new Error(`${label} : HTTP ${res.status}`);
    } catch (err) {
      if (attempt >= 4) throw err;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

function haversine(a, b) {
  const dLat = (b[0] - a[0]) * RAD;
  const dLon = (b[1] - a[1]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

async function routeGeometry(def) {
  return cachedJson(`osrm2-${def.id}`, async () => {
    const coords = [...def.via, ...def.after].map(([lat, lon]) => `${lon},${lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=true`;
    const res = await fetchRetry(url, { headers: { 'User-Agent': 'cols-de-france/1.0' } }, 'OSRM');
    const json = await res.json();
    if (json.code !== 'Ok') throw new Error(`OSRM : ${json.code}`);
    return json.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
  });
}

function resample(line, stepM) {
  const out = [line[0]];
  let carried = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const b = line[i];
    const len = haversine(a, b);
    if (len === 0) continue;
    let along = stepM - carried;
    while (along <= len) {
      const t = along / len;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      along += stepM;
    }
    carried = len - (along - stepM);
  }
  return out;
}

async function ignElevations(id, pts) {
  return cachedJson(`ign-${id}-${pts.length}`, async () => {
    const out = [];
    const batch = 1000;
    for (let i = 0; i < pts.length; i += batch) {
      const slice = pts.slice(i, i + batch);
      const res = await fetchRetry(
        'https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lon: slice.map((p) => p[1].toFixed(6)).join('|'),
            lat: slice.map((p) => p[0].toFixed(6)).join('|'),
            resource: 'ign_rge_alti_wld',
            delimiter: '|',
            indent: 'false',
            measures: 'false',
            zonly: 'true',
          }),
        },
        'IGN',
      );
      const json = await res.json();
      out.push(...json.elevations);
      process.stdout.write(`\r  altitudes IGN ${out.length}/${pts.length}`);
    }
    process.stdout.write('\n');
    return out;
  });
}

function median(values, radius) {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - radius), i + radius + 1).sort((a, b) => a - b);
    return w[w.length >> 1];
  });
}

function gaussian(values, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  for (let k = -radius; k <= radius; k++) kernel.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return values.map((_, i) => {
    let sum = 0;
    let weight = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= values.length) continue;
      sum += values[j] * kernel[k + radius];
      weight += kernel[k + radius];
    }
    return sum / weight;
  });
}

// Le MNT survole tunnels et gorges, et sur un versant raide quelques mètres d'écart
// latéral du tracé OSM suffisent à fausser l'altitude de la route. On encadre donc le
// profil par ses enveloppes à pente bornée et on garde leur médiane : les pics
// disparaissent sans biaiser le dénivelé global.
function envelope(ele, stepM, maxGrade, pick) {
  const out = ele.slice();
  const rise = (maxGrade / 100) * stepM;
  const bound = pick === 'min' ? (v, n) => Math.min(v, n + rise) : (v, n) => Math.max(v, n - rise);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < out.length; i++) out[i] = bound(out[i], out[i - 1]);
    for (let i = out.length - 2; i >= 0; i--) out[i] = bound(out[i], out[i + 1]);
  }
  return out;
}

function limitSlope(ele, stepM, maxGrade) {
  const low = envelope(ele, stepM, maxGrade, 'min');
  const high = envelope(ele, stepM, maxGrade, 'max');
  return ele.map((_, i) => (low[i] + high[i]) / 2);
}

function nearestIndex(pts, target) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversine(pts[i], target);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, distanceM: bestD };
}

function nearestNamed(named, point) {
  let best = null;
  let bestD = 90;
  for (const [name, lat, lon] of named ?? []) {
    const d = haversine(point, [lat, lon]);
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

function detectHairpins(x, z, stepM, cfg, footIndex) {
  const win = Math.round(cfg.windowM / stepM / 2);
  const turn = new Float64Array(x.length);
  for (let i = win + 2; i < x.length - win - 2; i++) {
    const a1 = Math.atan2(x[i - win + 2] - x[i - win], z[i - win + 2] - z[i - win]);
    const a2 = Math.atan2(x[i + win] - x[i + win - 2], z[i + win] - z[i + win - 2]);
    let d = (a2 - a1) / RAD;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    turn[i] = d;
  }
  const out = [];
  for (let i = footIndex + Math.round((cfg.skipFirstM ?? 0) / stepM); i < x.length; i++) {
    if (Math.abs(turn[i]) < cfg.minTurnDeg) continue;
    let j = i;
    let peak = i;
    while (j < x.length && Math.abs(turn[j]) >= cfg.minTurnDeg && Math.sign(turn[j]) === Math.sign(turn[i])) {
      if (Math.abs(turn[j]) > Math.abs(turn[peak])) peak = j;
      j++;
    }
    const last = out[out.length - 1];
    if (last && (peak - last.index) * stepM < cfg.minGapM) {
      // Deux pics rapprochés : c'est le même lacet vu deux fois, on garde le second.
      last.index = peak;
      last.side = Math.sign(turn[peak]);
      i = j;
      continue;
    }
    out.push({ index: peak, side: Math.sign(turn[peak]) });
    i = j + 15;
  }
  return out;
}

// ---- Relief -------------------------------------------------------------

const lonToTile = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const latToTile = (lat, z) => {
  const r = lat * RAD;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

async function loadTile(x, y) {
  const file = path.join(CACHE, `t${TILE_ZOOM}-${x}-${y}.png`);
  if (!fs.existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${TILE_ZOOM}/${x}/${y}.png`;
    const res = await fetchRetry(url, {}, 'tuile relief');
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const png = PNG.sync.read(fs.readFileSync(file));
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < h.length; i++) {
    h[i] = png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768;
  }
  return h;
}

async function buildTerrain(lat0, lon0, xs, zs, outFile) {
  const x0 = Math.floor((Math.min(...xs) - TERRAIN_MARGIN_M) / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const x1 = Math.ceil((Math.max(...xs) + TERRAIN_MARGIN_M) / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const z0 = Math.floor((Math.min(...zs) - TERRAIN_MARGIN_M) / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const z1 = Math.ceil((Math.max(...zs) + TERRAIN_MARGIN_M) / TERRAIN_STEP_M) * TERRAIN_STEP_M;
  const cols = (x1 - x0) / TERRAIN_STEP_M + 1;
  const rows = (z1 - z0) / TERRAIN_STEP_M + 1;
  const cosLat = Math.cos(lat0 * RAD);
  const toLon = (x) => lon0 + x / (EARTH_R * cosLat * RAD);
  const toLat = (z) => lat0 - z / (EARTH_R * RAD);

  const tx0 = Math.floor(lonToTile(toLon(x0), TILE_ZOOM));
  const tx1 = Math.floor(lonToTile(toLon(x1), TILE_ZOOM));
  const ty0 = Math.floor(latToTile(toLat(z0), TILE_ZOOM));
  const ty1 = Math.floor(latToTile(toLat(z1), TILE_ZOOM));
  const tiles = new Map();
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  let done = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (jobs.length) {
        const [tx, ty] = jobs.pop();
        tiles.set(`${tx}/${ty}`, await loadTile(tx, ty));
        process.stdout.write(`\r  tuiles relief ${++done}`);
      }
    }),
  );
  process.stdout.write('\n');

  const sample = (fx, fy) => {
    const tx = Math.floor(fx);
    const ty = Math.floor(fy);
    const t = tiles.get(`${tx}/${ty}`);
    return t[Math.min(255, Math.floor((fy - ty) * 256)) * 256 + Math.min(255, Math.floor((fx - tx) * 256))];
  };
  const bilinear = (fx, fy) => {
    const e = 1 / 256;
    const px = fx / e - 0.5;
    const py = fy / e - 0.5;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const ax = px - ix;
    const ay = py - iy;
    const at = (a, b) => sample((a + 0.5) * e, (b + 0.5) * e);
    return (
      (at(ix, iy) * (1 - ax) + at(ix + 1, iy) * ax) * (1 - ay) +
      (at(ix, iy + 1) * (1 - ax) + at(ix + 1, iy + 1) * ax) * ay
    );
  };

  const data = new Uint16Array(cols * rows);
  const margin = 2 / 256;
  for (let r = 0; r < rows; r++) {
    const fy = Math.min(ty1 + 1 - margin, Math.max(ty0 + margin, latToTile(toLat(z0 + r * TERRAIN_STEP_M), TILE_ZOOM)));
    for (let c = 0; c < cols; c++) {
      const fx = Math.min(tx1 + 1 - margin, Math.max(tx0 + margin, lonToTile(toLon(x0 + c * TERRAIN_STEP_M), TILE_ZOOM)));
      data[r * cols + c] = Math.max(0, Math.min(65535, Math.round(bilinear(fx, fy) * 10)));
    }
  }
  fs.writeFileSync(outFile, Buffer.from(data.buffer));
  return { file: 'terrain.bin', cols, rows, stepM: TERRAIN_STEP_M, x0, z0, scale: 0.1 };
}

// ---- Parcours -----------------------------------------------------------

function gradeSeries(ele, stepM) {
  const span = 2; // pente centrée sur 40 m
  return ele.map((_, i) => {
    const a = Math.max(0, i - span);
    const b = Math.min(ele.length - 1, i + span);
    return ((ele[b] - ele[a]) / ((b - a) * stepM)) * 100;
  });
}

function writeGpx(file, def, pts, ele) {
  const body = pts
    .filter((_, i) => i % 3 === 0 || i === pts.length - 1)
    .map((p) => {
      const i = pts.indexOf(p);
      return `<trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"><ele>${ele[i].toFixed(1)}</ele></trkpt>`;
    })
    .join('\n');
  fs.writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="cols-de-france" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${def.name}</name><copyright author="OpenStreetMap contributors, IGN"><license>https://www.openstreetmap.org/copyright</license></copyright></metadata>
<trk><name>${def.name}</name><trkseg>
${body}
</trkseg></trk>
</gpx>
`,
  );
}

function resolveSegmentPoint(ref, ctx) {
  if (ref === 'foot') return ctx.footIndex;
  if (ref === 'end') return ctx.count - 1;
  if (ref.startsWith('poi:')) {
    const poi = ctx.pois.find((p) => p.name === ref.slice(4));
    if (!poi) throw new Error(`Segment : repère inconnu ${ref}`);
    return Math.round(poi.distM / SAMPLE_M);
  }
  if (ref.startsWith('hairpin:')) {
    const n = Number(ref.slice(8));
    const h = ctx.hairpins.find((v) => v.number === n);
    if (!h) throw new Error(`Segment : virage ${n} introuvable`);
    return Math.round(h.distM / SAMPLE_M);
  }
  throw new Error(`Segment : référence inconnue ${ref}`);
}

async function buildRoute(def) {
  console.log(`\n${def.name}`);
  const dir = path.join(OUT, def.id);
  fs.mkdirSync(dir, { recursive: true });

  const line = await routeGeometry(def);
  const pts = resample(line, SAMPLE_M);
  const raw = await ignElevations(def.id, pts);
  const clean = raw.map((v, i) => (v > -1000 ? v : (raw[i - 1] ?? raw[i + 1])));
  const ele = gaussian(limitSlope(median(clean, 4), SAMPLE_M, 14.5), 4).map((v) => Math.round(v * 100) / 100);

  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const lon0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const cosLat = Math.cos(lat0 * RAD);
  const toX = (lon) => (lon - lon0) * RAD * EARTH_R * cosLat;
  const toZ = (lat) => -(lat - lat0) * RAD * EARTH_R;
  // Le tracé OSM est une suite de segments droits : un léger lissage arrondit les virages
  // sans déplacer la route de plus de quelques mètres.
  const rounded = roundTightBends(
    gaussian(pts.map((p) => toX(p[1])), 1.3),
    gaussian(pts.map((p) => toZ(p[0])), 1.3),
    MIN_BEND_RADIUS_M,
  );
  const x = rounded.x.map((v) => Math.round(v * 100) / 100);
  const z = rounded.z.map((v) => Math.round(v * 100) / 100);
  console.log(`  ${rounded.hairpins} épingles évasées, déplacement maximal ${rounded.shift.toFixed(1)} m`);
  const grade = gradeSeries(ele, SAMPLE_M).map((g) => Math.round(g * 100) / 100);

  // Le tracé continue au-delà de l'arrivée : la route ne doit pas s'arrêter net devant le cycliste.
  const endIndex = nearestIndex(pts, def.via[def.via.length - 1]).index;
  const backtracks = findBacktracks({ x, z, ele, stepM: SAMPLE_M });
  for (const b of backtracks) {
    console.warn(`  ! aller-retour du tracé entre ${b.fromM / 1000} et ${b.toM / 1000} km`);
  }

  const footIndex = def.footFromEndKm
    ? endIndex - Math.round((def.footFromEndKm * 1000) / SAMPLE_M)
    : nearestIndex(pts, def.foot).index;
  const climbM = (endIndex - footIndex) * SAMPLE_M;
  const climbGain = ele[endIndex] - ele[footIndex];
  const avg = (climbGain / climbM) * 100;
  let gain = 0;
  for (let i = footIndex + 1; i <= endIndex; i++) gain += Math.max(0, ele[i] - ele[i - 1]);

  const poiResolved = def.pois.map((p) => {
    const { index, distanceM } = nearestIndex(pts, p.at);
    if (!p.offRoute && p.type !== 'village' && distanceM > 450) {
      console.warn(`  ! ${p.name} est à ${distanceM.toFixed(0)} m de la route`);
    }
    return {
      name: p.name,
      type: p.type,
      x: Math.round(toX(p.at[1]) * 10) / 10,
      z: Math.round(toZ(p.at[0]) * 10) / 10,
      distM: index * SAMPLE_M,
      offsetM: Math.round(distanceM),
    };
  });

  let hairpins = [];
  if (def.hairpins) {
    const found = detectHairpins(x, z, SAMPLE_M, def.hairpins, footIndex).filter(
      (h) => ele[h.index] <= (def.hairpins.maxEle ?? Infinity),
    );
    if (found.length !== def.hairpins.expected) {
      console.warn(`  ! ${found.length} virages détectés au lieu de ${def.hairpins.expected}`);
    }
    hairpins = found.map((h, i) => ({
      number: found.length - i,
      distM: h.index * SAMPLE_M,
      side: h.side,
      ele: Math.round(ele[h.index]),
      name: nearestNamed(def.hairpins.named, pts[h.index]),
    }));
    console.log('  virages : ' + hairpins.map((h) => `${h.number}:${h.ele}${h.name ? ' ' + h.name : ''}`).join(', '));
  }

  const ctx = { footIndex, count: endIndex + 1, pois: poiResolved, hairpins };
  const segments = def.segments.map((s) => {
    const a = resolveSegmentPoint(s.from, ctx);
    const b = resolveSegmentPoint(s.to, ctx);
    if (b <= a) throw new Error(`Segment inversé : ${s.name}`);
    return { id: `${def.id}:${s.name}`, name: s.name, startM: a * SAMPLE_M, endM: b * SAMPLE_M };
  });

  const terrain = await buildTerrain(lat0, lon0, x, z, path.join(dir, 'terrain.bin'));
  terrain.ortho = await buildOrtho(lat0, lon0, terrain, path.join(dir, 'ortho.jpg'), CACHE, fetchRetry);

  const features = await downloadBuildings(pts, cachedJson, fetchRetry);
  // La tour du Ventoux a son propre modèle, avec son mât : son volume IGN ferait doublon.
  const excluded = poiResolved.filter((p) => p.type === 'tour').map((p) => [p.x, p.z, 30]);
  const { buildings, nudged, maxNudge, dropped } = processBuildings(features, { toX, toZ, x, z, excluded });
  fs.writeFileSync(path.join(dir, 'buildings.json'), JSON.stringify(buildings));
  console.log(`  ${buildings.length} bâtiments réels, ${nudged} décalés de la chaussée (max ${maxNudge.toFixed(1)} m), ${dropped} à cheval sur la route non posés`);
  writeGpx(path.join(dir, 'route.gpx'), def, pts, ele);

  const route = {
    id: def.id,
    name: def.name,
    subtitle: def.subtitle,
    massif: def.massif,
    stepM: SAMPLE_M,
    origin: { lat: lat0, lon: lon0 },
    x,
    z,
    ele,
    grade,
    footM: footIndex * SAMPLE_M,
    endM: endIndex * SAMPLE_M,
    climb: {
      lengthKm: Math.round(climbM / 10) / 100,
      avgGradePct: Math.round(avg * 10) / 10,
      gainM: Math.round(gain),
      topM: Math.round(ele[endIndex]),
      official: { lengthKm: def.official.lengthKm, avgGradePct: def.official.avgGradePct },
    },
    biomes: def.biomes,
    buildingStyle: def.buildingStyle,
    pois: poiResolved,
    hairpins,
    segments,
    terrain,
    sources: ['© contributeurs OpenStreetMap (ODbL)', 'IGN RGE ALTI', 'Mapzen Terrain Tiles', 'IGN BD TOPO', 'IGN BD ORTHO'],
  };
  fs.writeFileSync(path.join(dir, 'route.json'), JSON.stringify(route));

  const maxG = Math.max(...grade.slice(footIndex));
  const o = def.official;
  const dLen = Math.abs(route.climb.lengthKm - o.lengthKm);
  const dAvg = Math.abs(avg - o.avgGradePct);
  const ok = dLen <= o.tolerance.lengthKm && dAvg <= o.tolerance.grade && backtracks.length === 0;
  console.log(
    `  total ${(endIndex * SAMPLE_M) / 1000} km, échauffement ${(footIndex * SAMPLE_M) / 1000} km | col ${route.climb.lengthKm} km à ${route.climb.avgGradePct} % ` +
      `(officiel ${o.lengthKm} km à ${o.avgGradePct} %) D+ ${route.climb.gainM} m, sommet ${route.climb.topM} m, max ${maxG.toFixed(1)} % ` +
      `${ok ? 'OK' : 'ÉCART'} | terrain ${terrain.cols}x${terrain.rows}`,
  );
  return ok;
}

const only = process.argv.slice(2);
const defs = only.length ? ROUTES.filter((r) => only.includes(r.id)) : ROUTES;
let allOk = true;
for (const def of defs) allOk = (await buildRoute(def)) && allOk;
fs.writeFileSync(
  path.join(OUT, 'index.json'),
  JSON.stringify(
    ROUTES.filter((r) => fs.existsSync(path.join(OUT, r.id, 'route.json'))).map((r) => {
      const j = JSON.parse(fs.readFileSync(path.join(OUT, r.id, 'route.json'), 'utf8'));
      return { id: r.id, name: r.name, subtitle: r.subtitle, massif: r.massif, climb: j.climb, totalKm: j.endM / 1000, warmupKm: j.footM / 1000 };
    }),
  ),
);
if (!allOk) process.exitCode = 1;
