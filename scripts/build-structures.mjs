// Tunnels et ponts le long de chaque parcours, d'après OpenStreetMap (service Overpass, lecture seule).
// Écrit public/data/<parcours>/structures.json : { tunnels: [{ fromM, toM }], bridges: [{ fromM, toM }] }.
// Usage : node scripts/build-structures.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'public', 'data');
const CACHE = path.join(ROOT, '.cache');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const METERS_PER_DEGREE = (6371008.8 * Math.PI) / 180;
/** Un nœud compte comme étant sur la route s'il en est à moins de cela (m). */
const NEAR_M = 14;
/** Les structures plus courtes que cela ne sont pas gardées (m) : un caniveau n'est pas un pont. */
const MIN_LENGTH_M = { tunnels: 25, bridges: 12 };

fs.mkdirSync(CACHE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(id, query) {
  const file = path.join(CACHE, `structures-${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(ENDPOINT, { method: 'POST', body: `data=${encodeURIComponent(query)}`, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: '*/*', 'user-agent': 'cols-de-france-build-script/1.0' } });
    if (res.ok) {
      const json = await res.json();
      fs.writeFileSync(file, JSON.stringify(json));
      return json;
    }
    if (attempt >= 4) throw new Error(`${id} : HTTP ${res.status}`);
    await sleep(8000 * attempt);
  }
}

const routes = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
for (const { id } of routes) {
  const route = JSON.parse(fs.readFileSync(path.join(DATA, id, 'route.json'), 'utf8'));
  const { lat, lon } = route.origin;
  const cos = Math.cos((lat * Math.PI) / 180);
  const points = route.x.map((x, i) => ({ x, z: route.z[i], distM: i * route.stepM }));
  const pad = 0.003;
  const lats = points.map((p) => lat - p.z / METERS_PER_DEGREE);
  const lons = points.map((p) => lon + p.x / (METERS_PER_DEGREE * cos));
  const bbox = [Math.min(...lats) - pad, Math.min(...lons) - pad, Math.max(...lats) + pad, Math.max(...lons) + pad].map((v) => v.toFixed(5)).join(',');
  const query = `[out:json][timeout:90];(way["highway"]["tunnel"~"^(yes|building_passage|avalanche_protector)$"](${bbox});way["highway"]["bridge"~"^(yes|viaduct|movable|cantilever)$"](${bbox}););out geom;`;
  const osm = await overpass(id, query);

  const found = { tunnels: [], bridges: [] };
  for (const way of osm.elements ?? []) {
    if (!way.geometry) continue;
    const kind = way.tags?.tunnel ? 'tunnels' : 'bridges';
    // Chaque nœud du chemin est projeté sur le tracé : seuls ceux qui le longent comptent.
    const dists = [];
    for (const n of way.geometry) {
      const x = (n.lon - lon) * METERS_PER_DEGREE * cos;
      const z = (lat - n.lat) * METERS_PER_DEGREE;
      let best = Infinity;
      let at = 0;
      for (const p of points) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < best) {
          best = d;
          at = p.distM;
        }
      }
      if (best <= NEAR_M) dists.push(at);
    }
    if (dists.length < 2 || dists.length < way.geometry.length * 0.6) continue;
    const fromM = Math.min(...dists);
    const toM = Math.max(...dists);
    if (toM - fromM < MIN_LENGTH_M[kind]) continue;
    found[kind].push({ fromM: Math.round(fromM), toM: Math.round(toM), ...(way.tags?.name ? { name: way.tags.name } : {}) });
  }
  for (const kind of ['tunnels', 'bridges']) {
    found[kind].sort((a, b) => a.fromM - b.fromM);
    // Plusieurs chemins qui se chevauchent (les deux sens, par exemple) n'en font qu'un.
    found[kind] = found[kind].reduce((list, s) => {
      const last = list[list.length - 1];
      if (last && s.fromM <= last.toM + 5) last.toM = Math.max(last.toM, s.toM);
      else list.push(s);
      return list;
    }, []);
  }
  fs.writeFileSync(path.join(DATA, id, 'structures.json'), JSON.stringify(found));
  console.log(`${id} : ${found.tunnels.length} tunnel(s), ${found.bridges.length} pont(s)`, JSON.stringify(found.tunnels));
  await sleep(2500);
}
