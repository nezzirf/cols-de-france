// Textures du cycliste, peintes à la volée.

import * as THREE from 'three';

/** Relief du tissu technique : maille fine et plis légers, utilisé comme carte de relief. */
export function fabricTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 3) {
    for (let x = (y / 3) % 2 ? 0 : 2; x < 256; x += 4) {
      g.fillStyle = 'rgba(255,255,255,0.13)';
      g.fillRect(x, y, 2, 1);
    }
  }
  for (let i = 0; i < 9; i++) {
    const y = Math.random() * 256;
    const shade = Math.random() < 0.5 ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.14)';
    g.strokeStyle = shade;
    g.lineWidth = 3 + Math.random() * 7;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(85, y + Math.random() * 30 - 15, 170, y + Math.random() * 30 - 15, 256, y);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

/** Dossard de course, épinglé dans le bas du dos. */
export function bibTexture(number: string): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f2ec';
  g.fillRect(0, 0, 256, 160);
  g.fillStyle = '#c41f24';
  g.fillRect(0, 0, 256, 18);
  g.fillStyle = '#17181c';
  g.font = '700 118px Bahnschrift, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(number, 128, 94);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
