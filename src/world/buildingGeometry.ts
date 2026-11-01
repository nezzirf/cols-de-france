// Géométrie d'un bâtiment à partir de son emprise réelle. Fonctions pures, sans rendu.

import { ShapeUtils, Vector2 } from 'three';
import type { BuildingData } from '../sim/route';

export type Point = [number, number];

export interface Ridge {
  a: Point;
  b: Point;
}

const FLOOR_M = 3;
/** En dessous de ce remplissage du rectangle englobant, l'emprise n'est pas un simple rectangle. */
const BOX_FILL = 0.86;
/** Pente maximale d'un pan : la mesure IGN inclut parfois cheminées et antennes. */
const MAX_ROOF_SLOPE = 1.1;
const MANSARD_INSET_M = [2.4, 1.6, 1, 0.6];

export function ringOf(b: BuildingData): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i < b.p.length; i += 2) ring.push([b.p[i], b.p[i + 1]]);
  return ring;
}

/**
 * Ligne de faîtage : axe médian du rectangle orienté le plus serré autour de l'emprise,
 * parallèle à son grand côté, ce qui correspond à l'orientation réelle d'un toit à deux pans.
 */
export function ridgeOf(ring: Point[]): Ridge {
  return orientedBox(ring).ridge;
}

/** Surface signée : positive ou négative selon le sens de parcours de l'emprise. */
export function signedArea(ring: Point[]): number {
  let sum = 0;
  ring.forEach(([x, z], i) => {
    const [nx, nz] = ring[(i + 1) % ring.length];
    sum += x * nz - nx * z;
  });
  return sum / 2;
}

/** Vrai si l'emprise remplit assez son rectangle pour porter un toit à deux pans. */
export function isBoxLike(ring: Point[]): boolean {
  return Math.abs(signedArea(ring)) / orientedBox(ring).area >= BOX_FILL;
}

/**
 * Décale l'emprise vers l'intérieur. Renvoie null si le décalage retourne un mur ou crée une
 * pointe, ce qui arrive quand une aile du bâtiment est plus étroite que le retrait.
 */
export function insetRing(ring: Point[], distance: number): Point[] | null {
  const orientation = signedArea(ring) > 0 ? 1 : -1;
  const n = ring.length;
  const normals = ring.map(([x, z], i) => {
    const [nx, nz] = ring[(i + 1) % n];
    const len = Math.hypot(nx - x, nz - z) || 1;
    return [(-(nz - z) / len) * orientation, ((nx - x) / len) * orientation] as Point;
  });
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = normals[(i + n - 1) % n];
    const b = normals[i];
    const cos = a[0] * b[0] + a[1] * b[1];
    if (cos < -0.6) return null;
    const k = distance / (1 + cos);
    out.push([ring[i][0] + (a[0] + b[0]) * k, ring[i][1] + (a[1] + b[1]) * k]);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = ring[j][0] - ring[i][0];
    const dz = ring[j][1] - ring[i][1];
    if ((out[j][0] - out[i][0]) * dx + (out[j][1] - out[i][1]) * dz <= 0) return null;
  }
  // Un mur opposé trop proche : l'emprise décalée changerait de sens ou perdrait sa surface.
  if (signedArea(out) * orientation < Math.abs(signedArea(ring)) * 0.2) return null;
  return out;
}

function orientedBox(ring: Point[]): { area: number; ridge: Ridge; width: number } {
  let best: { area: number; ridge: Ridge; width: number } | null = null;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const ux = (bx - ax) / len;
    const uz = (bz - az) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, z] of ring) {
      const u = x * ux + z * uz;
      const v = -x * uz + z * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const lenU = maxU - minU;
    const lenV = maxV - minV;
    const area = lenU * lenV;
    if (best && area >= best.area) continue;
    const point = (u: number, v: number): Point => [u * ux - v * uz, u * uz + v * ux];
    const midU = (minU + maxU) / 2;
    const midV = (minV + maxV) / 2;
    best = {
      area,
      width: Math.min(lenU, lenV),
      ridge:
        lenU >= lenV
          ? { a: point(minU, midV), b: point(maxU, midV) }
          : { a: point(midU, minV), b: point(midU, maxV) },
    };
  }
  return best ?? { area: 0, width: 0, ridge: { a: ring[0], b: ring[0] } };
}

export function projectOnRidge(p: Point, r: Ridge): Point {
  const dx = r.b[0] - r.a[0];
  const dz = r.b[1] - r.a[1];
  const len2 = dx * dx + dz * dz;
  if (len2 === 0) return r.a;
  const t = Math.max(0, Math.min(1, ((p[0] - r.a[0]) * dx + (p[1] - r.a[1]) * dz) / len2));
  return [r.a[0] + dx * t, r.a[1] + dz * t];
}

export interface BuildingShell {
  /** Triangles x,y,z des murs et leurs coordonnées de texture (en étages). */
  walls: number[];
  wallUv: number[];
  /** Triangles du toit. */
  roof: number[];
  /** Pignons : triangles verticaux du toit, de la couleur des murs. */
  gables: number[];
}

/**
 * @param groundY sol au centre, référence de la hauteur mesurée
 * @param baseY   pied des murs, sous le point le plus bas du terrain
 * @param windows false pour les bâtiments sans fenêtres (hangars, tours, serres)
 */
export function buildShell(b: BuildingData, groundY: number, baseY: number, windows: boolean): BuildingShell {
  const ring = ringOf(b);
  const eaves = groundY + b.h;
  const shell: BuildingShell = { walls: [], wallUv: [], roof: [], gables: [] };
  const topV = Math.max(1, Math.round(b.h / FLOOR_M));
  const baseV = ((baseY - groundY) / b.h) * topV;

  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const len = Math.hypot(bx - ax, bz - az);
    shell.walls.push(ax, baseY, az, bx, baseY, bz, bx, eaves, bz, ax, baseY, az, bx, eaves, bz, ax, eaves, az);
    if (windows && len >= 2.4) {
      const u = Math.max(1, Math.round(len / FLOOR_M));
      shell.wallUv.push(0, baseV, u, baseV, u, topV, 0, baseV, u, topV, 0, topV);
    } else {
      // Coin de la texture sans fenêtre.
      for (let k = 0; k < 6; k++) shell.wallUv.push(0.03, 0.03);
    }
  }

  const flat = (outline: Point[], y: number) => {
    const contour = outline.map(([x, z]) => new Vector2(x, z));
    for (const [i, j, k] of ShapeUtils.triangulateShape(contour, [])) {
      for (const v of [i, j, k]) shell.roof.push(outline[v][0], y, outline[v][1]);
    }
  };

  if (b.r <= 0) {
    flat(ring, eaves);
    return shell;
  }

  // Un seul faîtage ne convient qu'à un rectangle. Pour une emprise en L, en U ou découpée,
  // le toit suit les murs et se termine par une terrasse (toit « à la Mansart »).
  if (!isBoxLike(ring)) {
    for (const d of MANSARD_INSET_M) {
      const inner = insetRing(ring, d);
      if (!inner) continue;
      const rise = eaves + Math.min(b.r, d * MAX_ROOF_SLOPE);
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        shell.roof.push(
          ring[i][0], eaves, ring[i][1], ring[j][0], eaves, ring[j][1], inner[j][0], rise, inner[j][1],
          ring[i][0], eaves, ring[i][1], inner[j][0], rise, inner[j][1], inner[i][0], rise, inner[i][1],
        );
      }
      flat(inner, rise);
      return shell;
    }
    flat(ring, eaves);
    return shell;
  }

  const box = orientedBox(ring);
  const ridge = box.ridge;
  const top = eaves + Math.min(b.r, (box.width / 2) * MAX_ROOF_SLOPE);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const c = ring[(i + 1) % ring.length];
    const pa = projectOnRidge(a, ridge);
    const pc = projectOnRidge(c, ridge);
    const same = Math.hypot(pa[0] - pc[0], pa[1] - pc[1]) < 0.01;
    if (same) {
      shell.gables.push(a[0], eaves, a[1], c[0], eaves, c[1], pa[0], top, pa[1]);
    } else {
      shell.roof.push(
        a[0], eaves, a[1], c[0], eaves, c[1], pc[0], top, pc[1],
        a[0], eaves, a[1], pc[0], top, pc[1], pa[0], top, pa[1],
      );
    }
  }
  return shell;
}
