// Repères des vélos modélisés d'un seul maillage (voir meshBike), lus sur une vue de profil de chaque fichier.

import * as THREE from 'three';
import type { MeshBikeSpec } from './meshBike';

type Rgb = [number, number, number];
const rgb = (hex: number): Rgb => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Peinture du Van Rysel RCR-F d'après la photo : cadre noir, vert menthe à la jonction de la selle, bleu nuit sur le tube horizontal,
 * bleu vif à la direction et en haut de la fourche. Roues, cintre, selle et transmission restent noirs ou gris.
 */
const RCRF_BLACK = rgb(0x16181c);
const RCRF_MINT = rgb(0x3ee0a0);
const RCRF_NAVY = rgb(0x2a3074);
const RCRF_BLUE = rgb(0x1fa6ea);
const RCRF_STEEL = rgb(0x8d939c);
const RCRF_SPOKE = rgb(0x30333a);
const RCRF_WHITE = rgb(0xf4f4f2);
const RCRF_HUB_Y = -0.1022;
const RCRF_FRONT_Z = -0.2905;
const RCRF_REAR_Z = 0.2905;
const RCRF_R = 0.1993;

function frameColor(y: number, z: number): Rgb {
  // Cadre noir. Le tube horizontal est bleu nuit ; la direction et le haut de la fourche sont bleu vif ; la jonction de selle est vert menthe.
  let c = RCRF_BLACK;
  c = mix(c, RCRF_NAVY, smooth(0.06, 0.1, y) * smooth(0.1, 0.02, z) * smooth(-0.26, -0.12, z));
  c = mix(c, RCRF_BLUE, smooth(-0.14, -0.2, z) * smooth(-0.12, -0.02, y));
  // Le vert part de la jonction de selle, s'étire vers le bas le long du tube de selle et des haubans, et se perd dans le noir.
  const down = y < 0.12 ? (0.12 - y) * 1.9 : (y - 0.12) * 1.2;
  const d = Math.hypot((z - 0.135) * 1.15, down);
  c = mix(c, RCRF_MINT, 1 - smooth(0.05, 0.12, d));
  return c;
}

/** Lettres blanches « VAN RYSEL » sur le tube diagonal, en tirets : de la direction vers le pédalier, sur les deux flancs. */
function downTubeLetters(x: number, y: number, z: number): boolean {
  if (Math.abs(x) < 0.012) return false;
  // Le tube diagonal va de (z -0.2, y 0) à (z 0.04, y -0.11).
  const dz = 0.24;
  const dy = -0.11;
  const len = Math.hypot(dz, dy);
  const t = ((z + 0.2) * dz + y * dy) / (len * len);
  if (t < 0.1 || t > 0.9) return false;
  const off = Math.abs(-(z + 0.2) * dy + y * dz) / len;
  if (off > 0.015) return false;
  return (t * len) % 0.016 < 0.011;
}

function rcrfPaint(x: number, y: number, z: number): Rgb {
  const ax = Math.abs(x);
  for (const hubZ of [RCRF_FRONT_Z, RCRF_REAR_Z]) {
    const dz = z - hubZ;
    const dy = y - RCRF_HUB_Y;
    const r = Math.hypot(dy, dz);
    if (r > RCRF_R * 1.03) continue;
    // Fourche et haubans qui traversent la roue : leur couleur de cadre.
    const front = hubZ < 0;
    const stay = front ? Math.abs(z - (-0.255 + (y - 0.12) * ((hubZ + 0.255) / (RCRF_HUB_Y - 0.12)))) < 0.03 && y > RCRF_HUB_Y : Math.abs(z - (0.125 + (y - 0.1) * ((hubZ - 0.125) / (RCRF_HUB_Y - 0.1)))) < 0.03 && y > RCRF_HUB_Y;
    if (stay && ax > 0.02 && ax < 0.075) return frameColor(y, z);
    if (r < 0.03) return RCRF_STEEL;
    if (r < 0.085 && ax > 0.032) return mix(RCRF_STEEL, RCRF_BLACK, 0.3);
    if (r < RCRF_R * 0.86 && ax < 0.03) return RCRF_SPOKE;
    return RCRF_BLACK;
  }
  // Plateau, bielles et cassette.
  if (Math.hypot(y - -0.141, z - 0.05) < 0.075 && ax > 0.025) return RCRF_STEEL;
  if (Math.hypot(y - RCRF_HUB_Y, z - RCRF_REAR_Z) < 0.05 && ax > 0.015) return RCRF_STEEL;
  // Cintre, potence, selle et tige de selle : noirs.
  if (z < -0.15 && y > 0.165) return RCRF_BLACK;
  if (y > 0.25 || (z > 0.09 && y > 0.22)) return RCRF_BLACK;
  if (downTubeLetters(x, y, z)) return RCRF_WHITE;
  return frameColor(y, z);
}

export const MESH_BIKES: Record<'ef' | 'sl9' | 'pinarello' | 'trinity' | 'rcrf' | 'addict' | 'aeroad', MeshBikeSpec> = {
  aeroad: {
    id: 'aeroad',
    url: `${import.meta.env.BASE_URL}models/aeroad/canyon-aeroad.glb`,
    tyreR: 0.1992,
    hubY: -0.0953,
    frontHubZ: -0.2905,
    rearHubZ: 0.2905,
    groundY: -0.2945,
    bbZ: 0.052,
    bbY: -0.135,
    saddle: { z: 0.184, top: 0.295 },
    hood: { z: -0.362, y: 0.224, side: 0.113 },
    pedalReach: 0.2,
    ringRadius: 0.066,
  },
  addict: {
    id: 'addict',
    url: `${import.meta.env.BASE_URL}models/addict/scott-addict.glb`,
    tyreR: 0.198,
    hubY: -0.0853,
    frontHubZ: -0.2913,
    rearHubZ: 0.2913,
    groundY: -0.2833,
    bbZ: 0.058,
    bbY: -0.117,
    saddle: { z: 0.155, top: 0.283 },
    hood: { z: -0.334, y: 0.238, side: 0.115 },
    pedalReach: 0.21,
    // Un petit bâton avec une bille (une extension de valve ?) sort de la jante avant, côté gauche : il passerait pour une pédale vu de dos.
    remove: [
      { x0: -0.2, x1: -0.05, y0: -0.265, y1: -0.14, z0: -0.265, z1: -0.185 },
      // Le bas des deux courbes du cintre se rejoignait au milieu, devant la potence : ces bouts de ruban sont retirés.
      // On garde la colonne de direction au centre (moins de 1,7 cm de l'axe).
      { x0: -0.07, x1: -0.0175, y0: 0.145, y1: 0.182, z0: -0.32, z1: -0.2 },
      { x0: 0.0175, x1: 0.07, y0: 0.145, y1: 0.182, z0: -0.32, z1: -0.2 },
      // Une barre noire en plus, au-dessus du ruban blanc, relie les deux manettes : on ne garde que les manettes et le ruban.
      { x0: -0.09, x1: 0.09, y0: 0.236, y1: 0.28, z0: -0.36, z1: -0.21 },
      { x0: -0.09, x1: 0.09, y0: 0.195, y1: 0.28, z0: -0.37, z1: -0.325 },
    ],
  },
  rcrf: {
    id: 'rcrf',
    url: `${import.meta.env.BASE_URL}models/rcrf/van-rysel-rcrf.glb`,
    tyreR: RCRF_R,
    hubY: RCRF_HUB_Y,
    frontHubZ: RCRF_FRONT_Z,
    rearHubZ: RCRF_REAR_Z,
    groundY: -0.3015,
    bbZ: 0.05,
    bbY: -0.141,
    saddle: { z: 0.195, top: 0.301 },
    hood: { z: -0.356, y: 0.222, side: 0.145 },
    paint: rcrfPaint,
    // Une pièce cylindrique qui dépasse de 11 cm à droite du moyeu arrière (le dérailleur reste, en dessous).
    remove: [{ x0: 0.052, x1: 0.2, y0: -0.158, y1: -0.12, z0: 0.255, z1: 0.325 }],
    photo: { url: `${import.meta.env.BASE_URL}models/rcrf/paint.png`, centerX: 355.5,
      centerY: 446,
      scale: 615.5,
      lettering: [
        { cx: 399.7, cy: 390.2, dx: 0.674, dy: -0.739, halfLen: 68, halfWid: 11 },
        { cx: 513, cy: 388, dx: 0.45, dy: 0.893, halfLen: 26, halfWid: 9 },
        { cx: 274, cy: 311.5, dx: 1, dy: 0, halfLen: 10, halfWid: 7 },
        { cx: 176, cy: 341.5, dx: 1, dy: 0, halfLen: 25, halfWid: 7 },
        { cx: 531, cy: 341, dx: 1, dy: 0, halfLen: 25, halfWid: 7 },
        { cx: 229, cy: 459.5, dx: 0.99, dy: 0.12, halfLen: 37, halfWid: 8 },
      ],
    },
  },
  ef: {
    id: 'ef',
    url: `${import.meta.env.BASE_URL}models/ef/cannondale-supersix.glb`,
    tyreR: 0.199,
    hubY: -0.0959,
    frontHubZ: -0.2905,
    rearHubZ: 0.2905,
    groundY: -0.2949,
    bbZ: 0.045,
    bbY: -0.139,
    saddle: { z: 0.2, top: 0.293 },
    hood: { z: -0.29, y: 0.245, side: 0.06 },
  },
  sl9: {
    id: 'sl9',
    url: `${import.meta.env.BASE_URL}models/sl9/specialized-sl9.glb`,
    tyreR: 0.2,
    hubY: -0.0955,
    frontHubZ: -0.2897,
    rearHubZ: 0.2897,
    groundY: -0.2955,
    bbZ: 0.05,
    bbY: -0.1365,
    saddle: { z: 0.18, top: 0.2978 },
    hood: { z: -0.29, y: 0.243, side: 0.05 },
    dropShadows: true,
  },
  pinarello: {
    id: 'pinarello',
    url: `${import.meta.env.BASE_URL}models/pinarello/pinarello-dogma.glb`,
    tyreR: 0.2015,
    hubY: -0.089,
    frontHubZ: -0.2875,
    rearHubZ: 0.2875,
    groundY: -0.2907,
    bbZ: 0.043,
    bbY: -0.1342,
    saddle: { z: 0.162, top: 0.2913 },
    hood: { z: -0.305, y: 0.238, side: 0.095 },
  },
  trinity: {
    id: 'trinity',
    url: `${import.meta.env.BASE_URL}models/trinity/giant-trinity.glb`,
    tyreR: 0.19,
    hubY: -0.1,
    frontHubZ: -0.299,
    rearHubZ: 0.299,
    groundY: -0.2905,
    bbZ: 0.05,
    bbY: -0.154,
    saddle: { z: 0.177, top: 0.2823 },
    // Les mains sont au bout des prolongateurs, à peu près à la hauteur des épaules.
    hood: { z: -0.37, y: 0.288, side: 0.055 },
    dropShadows: true,
    rearStatic: true,
    tt: { hip: [0.03, -0.035], shoulder: [0.5, 0.07], neck: [0.58, 0.1], head: [0.67, 0.04], roll: 0, slope: 0, headPitch: -0.75 },
  },
};
