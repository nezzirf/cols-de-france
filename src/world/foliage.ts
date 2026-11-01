// Feuillages peints à la volée : des milliers de petits traits sur fond transparent, posés sur
// des plans croisés. C'est ce découpage irrégulier qui fait lire un arbre plutôt qu'un volume.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const random = (min: number, max: number): number => min + Math.random() * (max - min);

function texture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return [c, c.getContext('2d')!];
}

export function coniferTexture(): THREE.CanvasTexture {
  const [c, g] = canvasOf(256, 512);
  const cx = c.width / 2;
  g.fillStyle = '#3e2c1f';
  g.fillRect(cx - 7, 60, 14, 452);
  g.lineCap = 'round';
  // Branches du bas vers le haut : les plus hautes, plus claires, recouvrent les ombres.
  for (let i = 0; i < 5200; i++) {
    const t = Math.pow(Math.random(), 0.75);
    const y = 12 + t * 450;
    const reach = (0.05 + t * 0.95) * random(0.45, 1) * (c.width * 0.47);
    const side = Math.random() < 0.5 ? -1 : 1;
    const shade = random(0.55, 1.1) * (1 - 0.3 * t);
    g.strokeStyle = `rgb(${Math.round(58 * shade)},${Math.round(92 * shade)},${Math.round(60 * shade)})`;
    g.lineWidth = random(1.4, 3.2);
    const startX = cx + side * reach * random(0, 0.75);
    g.beginPath();
    g.moveTo(startX, y);
    g.lineTo(cx + side * reach, y + reach * random(0.22, 0.42));
    g.stroke();
  }
  return texture(c);
}

export function broadleafTexture(): THREE.CanvasTexture {
  const [c, g] = canvasOf(512, 512);
  const cx = c.width / 2;
  g.strokeStyle = '#46362a';
  g.lineCap = 'round';
  g.lineWidth = 15;
  g.beginPath();
  g.moveTo(cx, 512);
  g.lineTo(cx + 6, 300);
  g.stroke();
  for (const [x, y] of [[-90, 230], [80, 215], [-40, 170], [50, 150]]) {
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx + 3, 330);
    g.quadraticCurveTo(cx + x * 0.3, 280, cx + x, y);
    g.stroke();
  }
  // Masses de feuilles : sombres d'abord, puis éclairées vers le haut.
  const clumps = Array.from({ length: 22 }, () => ({
    x: cx + random(-190, 190),
    y: random(55, 340),
    r: random(45, 95),
  }));
  for (let i = 0; i < 26000; i++) {
    const clump = clumps[Math.floor(Math.random() * clumps.length)];
    const a = Math.random() * Math.PI * 2;
    const d = Math.sqrt(Math.random()) * clump.r;
    const x = clump.x + Math.cos(a) * d;
    const y = clump.y + Math.sin(a) * d * 0.85;
    const light = (1 - Math.sin(a) * (d / clump.r)) * 0.3 + (1 - y / 400) * 0.45 + random(0, 0.3);
    g.fillStyle = `rgb(${Math.round(44 + 54 * light)},${Math.round(68 + 62 * light)},${Math.round(36 + 24 * light)})`;
    g.fillRect(x, y, random(2, 5), random(2, 4));
  }
  return texture(c);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, g] = canvasOf(256, 128);
  g.lineCap = 'round';
  for (let i = 0; i < 90; i++) {
    const x = random(14, 242);
    const lean = random(-34, 34);
    const top = random(6, 62);
    const tone = random(0.62, 1);
    g.strokeStyle = `rgb(${Math.round(190 * tone)},${Math.round(215 * tone)},${Math.round(150 * tone)})`;
    g.lineWidth = random(1.6, 3.4);
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.2, top + 40, x + lean, top);
    g.stroke();
  }
  return texture(c);
}

/** Plans croisés : une normale commune, tournée vers le ciel, évite des faces au ton différent. */
export function crossedPlanes(width: number, height: number, planes: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < planes; i++) {
    parts.push(new THREE.PlaneGeometry(width, height).translate(0, height / 2, 0).rotateY((i / planes) * Math.PI));
  }
  const g = mergeGeometries(parts)!;
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  const n = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    n.set(position.getX(i) / width, 1, position.getZ(i) / width).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
  }
  return g;
}

/** Ombre portée à la forme du feuillage, et non du rectangle. */
export function foliageDepth(map: THREE.Texture): THREE.MeshDepthMaterial {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.42 });
}
