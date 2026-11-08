// Les six spectateurs modélisés, allégés : deux à quatre mille triangles chacun, couleurs portées par les sommets.
// Chaque modèle est debout sur y = 0 et regarde vers +Z. Leurs bras sont repérés (poids et épaule) pour être animés sur la carte graphique.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Dans l'ordre des poids de `LOOK_WEIGHTS`. */
const NAMES = ['femme-1', 'homme-1', 'femme-2', 'femme-3', 'homme-2', 'homme-3'];

/**
 * Le bras de chaque modèle, vu de face : de l'épaule à la main, en écart latéral (m) et en hauteur rapportée à la taille.
 * Les sommets proches de ce segment suivent le bras ; le reste du corps ne bouge pas. Pas de bras pour l'homme accroupi.
 */
type Arm = { shoulder: [number, number]; hand: [number, number]; /** Élévation visée quand elle acclame (rad depuis la verticale). Un bras collé au buste ne monte que peu : il étirerait la peau du flanc. */ cheer: number; /** Le bout du bras s'efface : une jupe tout près de la main ne doit pas suivre. */ fadeEnd?: boolean;
  /** Manches sombres : des cheveux clairs qui tombent sur l'épaule ne suivent pas le bras (seule la main, plus bas, a la peau claire). */
  darkSleeve?: boolean };
const ARMS: Record<string, Arm | null> = {
  'femme-1': { shoulder: [0.16, 0.8], hand: [0.2, 0.5], fadeEnd: true, cheer: 0.7 },
  'homme-1': null,
  'femme-2': { shoulder: [0.16, 0.81], hand: [0.21, 0.42], cheer: 0.7 },
  'femme-3': { shoulder: [0.18, 0.8], hand: [0.36, 0.43], cheer: 2.05, darkSleeve: true },
  'homme-2': { shoulder: [0.2, 0.82], hand: [0.7, 0.52], cheer: 1.55 },
  'homme-3': { shoulder: [0.19, 0.8], hand: [0.41, 0.43], cheer: 2.05 },
};

export interface SpectatorModel {
  geometry: THREE.BufferGeometry;
}

/** Hanche et genou rapportés à la taille ; les modèles à jupe longue ou à pose figée ne plient pas les jambes. */
const HIP_KNEE = [0.52, 0.28] as const;
const NO_LEGS = new Set(['femme-1', 'homme-1']);

/** Ajoute à chaque sommet son poids de bras (0 à 1), son côté (±1), l'amplitude de son élévation quand elle acclame et le point d'épaule autour duquel il tourne. */
function markArms(geometry: THREE.BufferGeometry, arm: Arm | null): void {
  const pos = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  const weights = new Float32Array(pos.count * 3);
  const pivots = new Float32Array(pos.count * 3);
  const elbows = new Float32Array(pos.count * 4);
  let height = 0;
  for (let i = 0; i < pos.count; i++) height = Math.max(height, pos.getY(i));
  let rest = 0;
  if (arm) {
    const sx = arm.shoulder[0];
    const sy = arm.shoulder[1] * height;
    const hx = arm.hand[0];
    const hy = arm.hand[1] * height;
    rest = Math.atan2(hx - sx, sy - hy);
    const dx = hx - sx;
    const dy = hy - sy;
    const len2 = dx * dx + dy * dy;
    const hanging = Math.abs(dy) >= Math.abs(dx);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const side = x >= 0 ? 1 : -1;
      const px = Math.abs(x) - sx;
      const py = pos.getY(i) - sy;
      const t = Math.max(0, Math.min(1.45, (px * dx + py * dy) / len2));
      const cx = px - dx * t;
      const cy = py - dy * t;
      const dist = Math.hypot(cx, cy);
      // Plein poids près du bras, qui s'efface en s'en éloignant, et près de l'épaule où le bras se fond dans le buste.
      let near = 1 - Math.min(1, Math.max(0, (dist - 0.075) / 0.07));
      if (hanging) {
        // Un bras qui pend touche le buste : tout ce qui est du côté du corps, au-delà de l'épaisseur du bras, reste en place.
        const outward = (cx * -dy + cy * dx) / Math.sqrt(len2);
        const inner = Math.min(1, Math.max(0, (outward + 0.045) / 0.03));
        const outer = 1 - Math.min(1, Math.max(0, (outward - 0.05) / 0.05));
        near = Math.min(near, inner * inner * (3 - 2 * inner)) * outer;
      }
      // Le poids monte doucement le long du bras : l'épaule plie sans étirer le tissu entre le buste et le bras.
      const ramp = Math.min(1, Math.max(0, t / 0.5));
      const away = ramp * ramp * (3 - 2 * ramp);
      const end = arm.fadeEnd ? 1 - Math.min(1, Math.max(0, (t - 0.55) / 0.35)) : 1;
      // Le bras est sur le côté du corps : le dos, le ventre et les cheveux, devant ou derrière, ne le suivent pas.
      const depth = Math.abs(pos.getZ(i)) - 0.035;
      const flank = 1 - Math.min(1, Math.max(0, depth / 0.06));
      let sleeve = 1;
      if (arm.darkSleeve && t < 0.8) {
        const luma = 0.2126 * color.getX(i) + 0.7152 * color.getY(i) + 0.0722 * color.getZ(i);
        sleeve = 1 - Math.min(1, Math.max(0, (luma - 0.16) / 0.1));
      }
      weights[3 * i] = near * away * end * sleeve * flank * flank * (3 - 2 * flank);
      weights[3 * i + 1] = side;
      weights[3 * i + 2] = Math.max(0.2, arm.cheer - rest);
      pivots.set([side * sx, sy, 0], 3 * i);
      // Le coude est au milieu du bras ; l'avant-bras (du coude à la main) plie autour de lui.
      const fore = Math.min(1, Math.max(0, (t - 0.42) / 0.2));
      elbows.set([side * dx * 0.5, dy * 0.5, 0, fore * fore * (3 - 2 * fore) * (arm.fadeEnd ? 0 : 1)], 4 * i);
    }
  } else {
    for (let i = 0; i < pos.count; i++) weights[3 * i + 1] = 1;
  }
  geometry.setAttribute('aArm', new THREE.BufferAttribute(weights, 3));
  geometry.setAttribute('aPivot', new THREE.BufferAttribute(pivots, 3));
  geometry.setAttribute('aElbow', new THREE.BufferAttribute(elbows, 4));
}

/** Pour chaque sommet : hauteur de la hanche, du genou, et 1 si les jambes de ce modèle peuvent plier. */
function markLegs(geometry: THREE.BufferGeometry, bends: boolean): void {
  const pos = geometry.getAttribute('position');
  let height = 0;
  for (let i = 0; i < pos.count; i++) height = Math.max(height, pos.getY(i));
  const legs = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) legs.set([HIP_KNEE[0] * height, HIP_KNEE[1] * height, bends ? 1 : 0], 3 * i);
  geometry.setAttribute('aLeg', new THREE.BufferAttribute(legs, 3));
}

let loading: Promise<SpectatorModel[] | null> | null = null;

async function loadOne(name: string): Promise<SpectatorModel> {
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/foule/${name}.glb`);
  gltf.scene.updateMatrixWorld(true);
  let found: THREE.BufferGeometry | null = null;
  gltf.scene.traverse((o) => {
    if (o instanceof THREE.Mesh && !found) found = o.geometry.clone().applyMatrix4(o.matrixWorld);
  });
  if (!found) throw new Error(`Aucun maillage dans ${name}`);
  const geometry: THREE.BufferGeometry = found;
  markArms(geometry, ARMS[name]);
  markLegs(geometry, !NO_LEGS.has(name));
  return { geometry };
}

/** Charge les six modèles une seule fois. Renvoie null s'ils ne peuvent pas l'être : la foule reste alors vide. */
export function loadSpectators(): Promise<SpectatorModel[] | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  loading ??= Promise.all(NAMES.map(loadOne)).catch(() => null);
  return loading;
}
