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
  const [c, g] = canvasOf(512, 256);
  g.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = random(10, 502);
    const lean = random(-46, 46);
    const top = random(8, 128);
    const tone = random(0.55, 1);
    const shaded = g.createLinearGradient(0, 256, 0, top);
    shaded.addColorStop(0, `rgb(${Math.round(90 * tone)},${Math.round(112 * tone)},${Math.round(70 * tone)})`);
    shaded.addColorStop(1, `rgb(${Math.round(205 * tone)},${Math.round(225 * tone)},${Math.round(160 * tone)})`);
    g.strokeStyle = shaded;
    g.lineWidth = random(1.4, 3);
    g.beginPath();
    g.moveTo(x, 256);
    g.quadraticCurveTo(x + lean * 0.15, top + 70, x + lean, top);
    g.stroke();
  }
  return texture(c);
}

/** Rameau de sapin : tige, ramilles et aiguilles, tourné de la base (gauche) vers la pointe. */
export function frondTexture(): THREE.CanvasTexture {
  const [c, g] = canvasOf(512, 256);
  const mid = c.height / 2;
  g.lineCap = 'round';
  const needle = (x: number, y: number, a: number, length: number, shade: number) => {
    g.strokeStyle = `rgb(${Math.round(40 * shade)},${Math.round(72 * shade)},${Math.round(46 * shade)})`;
    g.lineWidth = random(1.1, 2);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * length, y + Math.sin(a) * length);
    g.stroke();
  };
  g.strokeStyle = '#3b2c20';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(500, mid);
  g.stroke();
  for (let x = 14; x < 490; x += 15) {
    const t = x / 512;
    const span = (1 - t * 0.82) * (c.height * 0.44);
    for (const side of [-1, 1]) {
      const reach = span * random(0.72, 1);
      const a = side * random(0.55, 0.9);
      const ex = x + Math.cos(a) * reach;
      const ey = mid + Math.sin(a) * reach;
      g.strokeStyle = '#3f3122';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, mid);
      g.lineTo(ex, ey);
      g.stroke();
      for (let k = 0; k < 34; k++) {
        const f = Math.random();
        const nx = x + (ex - x) * f;
        const ny = mid + (ey - mid) * f;
        needle(nx, ny, a + random(-1.15, 1.15), random(10, 22) * (1.1 - f * 0.4), random(0.72, 1.3));
      }
    }
  }
  return texture(c);
}

function leaf(g: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, light: number): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = `rgb(${Math.round(38 + 62 * light)},${Math.round(70 + 76 * light)},${Math.round(30 + 30 * light)})`;
  g.beginPath();
  g.moveTo(-size, 0);
  g.quadraticCurveTo(-size * 0.2, -size * 0.62, size, 0);
  g.quadraticCurveTo(-size * 0.2, size * 0.62, -size, 0);
  g.fill();
  g.strokeStyle = `rgba(${Math.round(70 + 60 * light)},${Math.round(100 + 70 * light)},50,0.55)`;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(-size, 0);
  g.lineTo(size, 0);
  g.stroke();
  g.restore();
}

/** Grappe de feuilles avec nervures : sombre au fond, claire au-dessus. */
export function leafClusterTexture(): THREE.CanvasTexture {
  const [c, g] = canvasOf(512, 512);
  g.strokeStyle = '#4a3a2a';
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(0, 256);
  g.bezierCurveTo(150, 240, 300, 270, 490, 250);
  g.stroke();
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < 300; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * 228;
      leaf(g, 256 + Math.cos(a) * d, 256 + Math.sin(a) * d * 0.9, random(15, 26), random(0, 6.28), pass * 0.3 + random(0, 0.42));
    }
  }
  return texture(c);
}

export function barkTexture(base: [number, number, number]): THREE.CanvasTexture {
  const [c, g] = canvasOf(256, 512);
  g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 1500; i++) {
    const shade = random(0.45, 1.3);
    g.strokeStyle = `rgba(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)},0.75)`;
    g.lineWidth = random(1, 4);
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + random(-7, 7), y + random(14, 60));
    g.stroke();
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 4);
  return t;
}

export function fernTexture(): THREE.CanvasTexture {
  const [c, g] = canvasOf(512, 256);
  g.lineCap = 'round';
  for (let frond = 0; frond < 9; frond++) {
    const base = 256;
    const a = -Math.PI / 2 + random(-1.15, 1.15);
    const length = random(130, 215);
    const steps = 22;
    let x = 256;
    let y = base;
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      const dir = a + (a > -Math.PI / 2 ? 1 : -1) * f * 0.75;
      const nx = x + Math.cos(dir) * (length / steps);
      const ny = y + Math.sin(dir) * (length / steps);
      g.strokeStyle = '#4b6b33';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(nx, ny);
      g.stroke();
      const leafLength = (1 - f) * 34 + 5;
      for (const side of [-1, 1]) {
        g.strokeStyle = `rgb(${Math.round(random(70, 100))},${Math.round(random(112, 148))},${Math.round(random(44, 62))})`;
        g.lineWidth = random(3, 5);
        g.beginPath();
        g.moveTo(nx, ny);
        g.lineTo(nx + Math.cos(dir + side * 1.2) * leafLength, ny + Math.sin(dir + side * 1.2) * leafLength);
        g.stroke();
      }
      x = nx;
      y = ny;
    }
  }
  return texture(c);
}

/** Herbes hautes avec de petites fleurs des prés. */
export function flowerTexture(): THREE.CanvasTexture {
  const [c, g] = canvasOf(512, 256);
  g.lineCap = 'round';
  const colors = ['#f3d43f', '#f6f3ea', '#b86fd0', '#e9607a', '#7d92e6'];
  for (let i = 0; i < 22; i++) {
    const x = random(24, 488);
    const top = random(36, 170);
    const lean = random(-26, 26);
    g.strokeStyle = '#6c9140';
    g.lineWidth = random(2, 3.4);
    g.beginPath();
    g.moveTo(x, 256);
    g.quadraticCurveTo(x, top + 60, x + lean, top);
    g.stroke();
    const petal = colors[Math.floor(Math.random() * colors.length)];
    const size = random(5, 8);
    g.fillStyle = petal;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + lean + Math.cos(a) * size, top + Math.sin(a) * size * 0.75, size * 0.72, size * 0.5, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#d9a12a';
    g.beginPath();
    g.arc(x + lean, top, size * 0.5, 0, Math.PI * 2);
    g.fill();
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
