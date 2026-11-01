// Photo aérienne de la zone d'un parcours (BD ORTHO IGN), recalée sur la grille du relief.

import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const ZOOM = 14;
const METERS_PER_PIXEL = 8;
const MAX_SIDE = 4096;
const QUALITY = 78;
const RAD = Math.PI / 180;
const EARTH_R = 6371008.8;

const lonToTile = (lon) => ((lon + 180) / 360) * 2 ** ZOOM;
const latToTile = (lat) => {
  const r = lat * RAD;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM;
};

async function loadTile(x, y, cacheDir, fetchRetry) {
  const file = path.join(cacheDir, `ortho${ZOOM}-${x}-${y}.jpg`);
  if (!fs.existsSync(file)) {
    const url = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&FORMAT=image/jpeg&TILEMATRIXSET=PM&TILEMATRIX=${ZOOM}&TILEROW=${y}&TILECOL=${x}`;
    const res = await fetchRetry(url, {}, 'photo aérienne');
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return jpeg.decode(fs.readFileSync(file), { useTArray: true, formatAsRGBA: true }).data;
}

export async function buildOrtho(lat0, lon0, terrain, outFile, cacheDir, fetchRetry) {
  const widthM = (terrain.cols - 1) * terrain.stepM;
  const depthM = (terrain.rows - 1) * terrain.stepM;
  const scale = Math.max(METERS_PER_PIXEL, Math.max(widthM, depthM) / MAX_SIDE);
  const width = Math.round(widthM / scale);
  const height = Math.round(depthM / scale);
  const cosLat = Math.cos(lat0 * RAD);
  const toLon = (x) => lon0 + x / (EARTH_R * cosLat * RAD);
  const toLat = (z) => lat0 - z / (EARTH_R * RAD);

  const x0 = Math.floor(lonToTile(toLon(terrain.x0)));
  const x1 = Math.floor(lonToTile(toLon(terrain.x0 + widthM)));
  const y0 = Math.floor(latToTile(toLat(terrain.z0)));
  const y1 = Math.floor(latToTile(toLat(terrain.z0 + depthM)));
  const jobs = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
  const total = jobs.length;
  const tiles = new Map();
  let done = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (jobs.length) {
        const [x, y] = jobs.pop();
        tiles.set(`${x}/${y}`, await loadTile(x, y, cacheDir, fetchRetry));
        process.stdout.write(`\r  photos ${++done}/${total}`);
      }
    }),
  );
  process.stdout.write('\n');

  const data = new Uint8Array(width * height * 4);
  for (let r = 0; r < height; r++) {
    const fy = latToTile(toLat(terrain.z0 + (r + 0.5) * scale));
    const ty = Math.floor(fy);
    for (let c = 0; c < width; c++) {
      const fx = lonToTile(toLon(terrain.x0 + (c + 0.5) * scale));
      const tx = Math.floor(fx);
      const tile = tiles.get(`${tx}/${ty}`);
      const k = (r * width + c) * 4;
      data[k + 3] = 255;
      if (!tile) continue;
      const p = (Math.floor((fy - ty) * 256) * 256 + Math.floor((fx - tx) * 256)) * 4;
      data[k] = tile[p];
      data[k + 1] = tile[p + 1];
      data[k + 2] = tile[p + 2];
    }
  }
  fs.writeFileSync(outFile, jpeg.encode({ data, width, height }, QUALITY).data);
  return { file: 'ortho.jpg', width, height };
}
