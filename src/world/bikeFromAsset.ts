// Habille le vélo modélisé : le pose dans le repère du jeu (vers -Z, sol en y = 0, pédalier au bon
// endroit) et fait tourner roues, plateau et pédales avec les os de son squelette.

import * as THREE from 'three';
import { cloneBikeAsset } from './bikeAsset';
import type { Point } from './modelParts';

/** Repères du modèle, dans son propre repère (mètres, x vers l'avant) : plateau, rayon de roue, selle, cocotte. */
const ASSET_BB = { fx: -0.096, y: 0.287 };
const ASSET_WHEEL_R = 0.364;
const ASSET_SADDLE = { fx: -0.319, top: 1.056 };
const ASSET_HOOD = { fx: 0.578, y: 1.022 };
const ASSET_CRANK = 0.184;

/** Où poser le cycliste sur ce vélo : bassin sur la selle, mains sur les cocottes, jambes à la bonne longueur. */
export interface RiderFit {
  bb: Point;
  /** Longueur des manivelles. */
  crank: number;
  hip: Point;
  shoulder: Point;
  neck: Point;
  head: Point;
  hand: Point;
  handSide: number;
  /** Mains roulées vers l'intérieur (radians) et pente de la main, pour épouser la cocotte ; absentes : paumes à plat. */
  handRoll?: number;
  handSlope?: number;
  thigh: number;
  shin: number;
}

export interface AssetBike {
  group: THREE.Group;
  fit: RiderFit;
  /** Positionne plateau, pédales et roues. */
  drive(crankAngle: number, wheelAngle: number): void;
}

interface Spinner {
  bone: THREE.Object3D;
  rest: THREE.Quaternion;
  /** Axe latéral du jeu, exprimé dans le repère de l'os. */
  axis: THREE.Vector3;
}

function spinner(bone: THREE.Object3D): Spinner {
  const world = bone.getWorldQuaternion(new THREE.Quaternion());
  return { bone, rest: bone.quaternion.clone(), axis: new THREE.Vector3(1, 0, 0).applyQuaternion(world.invert()) };
}

const turn = new THREE.Quaternion();
function spin(s: Spinner, angle: number): void {
  s.bone.quaternion.copy(s.rest).multiply(turn.setFromAxisAngle(s.axis, angle));
}

/**
 * Seconde couleur du cadre : elle gagne l'arrière (haubans, tube de selle), l'avant (tube de direction, fourche),
 * le bas (tube diagonal, base) ou le haut (tube horizontal, tige de selle). La fourche peut avoir sa propre couleur.
 */
export interface AssetCoat {
  second: number;
  fade: 'rear' | 'front' | 'low' | 'high';
  fork?: number;
}

const smooth = (edge0: number, edge1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Part de la seconde couleur au point (x vers l'avant, y vers le haut) du cadre, en unités du modèle (le cadre va de -49 à 45 et de 23 à 89). */
function coatShare(coat: AssetCoat, x: number, y: number): number {
  if (coat.fade === 'rear') return smooth(-2, -34, x);
  if (coat.fade === 'front') return smooth(8, 30, x);
  if (coat.fade === 'high') return smooth(50, 68, y);
  return smooth(58, 34, y);
}

/** La fourche descend en oblique de la direction (en haut, x ≈ 34) à l'axe de roue (en bas, x ≈ 45). */
function onFork(x: number, y: number): boolean {
  return y < 76 && Math.abs(x - (45 - 0.27 * (y - 33))) < 5.5;
}

/**
 * Le modèle est coloré par ses sommets : un rose pour le cadre, du blanc pour la fourche, le cintre et
 * les jantes, du gris pour les pneus et la transmission. On les remplace pour peindre le cadre à la
 * couleur de l'équipe et noircir les pièces en carbone.
 */
function paint(source: THREE.BufferGeometry, frame: THREE.Color, coat: AssetCoat | null): THREE.BufferGeometry {
  const geometry = source.clone();
  const where = geometry.getAttribute('position');
  const second = coat ? new THREE.Color(coat.second) : frame;
  const fork = new THREE.Color(coat?.fork ?? 0);
  const mixed = new THREE.Color();
  const colors = geometry.getAttribute('color');
  const out = new Float32Array(colors.count * 4);
  const carbon = new THREE.Color(0x15171a);
  const rubber = new THREE.Color(0x0c0d0f);
  const steel = new THREE.Color(0xb7bcc2);
  const dark = new THREE.Color(0x2a2d32);
  for (let i = 0; i < colors.count; i++) {
    const r = colors.getX(i);
    const g = colors.getY(i);
    const b = colors.getZ(i);
    let c = steel;
    if (r > 0.95 && g > 0.95 && b > 0.95) c = carbon;
    else if (r > 0.7 && g < 0.45 && b < 0.45) {
      const x = where.getX(i);
      const y = where.getY(i);
      c = !coat ? frame : coat.fork !== undefined && onFork(x, y) ? fork : mixed.copy(frame).lerp(second, coatShare(coat, x, y));
    }
    else if (r < 0.2) c = dark;
    else if (r < 0.55) c = rubber;
    out[i * 4] = c.r;
    out[i * 4 + 1] = c.g;
    out[i * 4 + 2] = c.b;
    out[i * 4 + 3] = 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 4));
  return geometry;
}

export function buildAssetBike(wheelRadiusM: number, material: THREE.Material | null, frame: THREE.Color, coat: AssetCoat | null = null): AssetBike {
  const group = new THREE.Group();
  const root = cloneBikeAsset();
  // Échelle du modèle : sa roue prend le rayon de roue du jeu.
  const scale = wheelRadiusM / ASSET_WHEEL_R;
  const bb: Point = [0.03, ASSET_BB.y * scale];
  const onBike = (fx: number, y: number): Point => [bb[0] + (fx - ASSET_BB.fx) * scale, y * scale];
  // Le modèle regarde vers +X, le jeu vers -Z : un quart de tour autour de la verticale.
  root.rotation.y = Math.PI / 2;
  root.scale.setScalar(scale);
  root.position.set(0, 0, -bb[0] + ASSET_BB.fx * scale);
  group.add(root);
  group.updateMatrixWorld(true);

  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry = paint(o.geometry, frame, coat);
      o.material =
        material ??
        new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.2, clearcoat: 0.5, clearcoatRoughness: 0.2, side: THREE.DoubleSide });
      o.frustumCulled = false;
    }
  });

  const need = (name: string): THREE.Object3D => {
    const bone = root.getObjectByName(name);
    if (!bone) throw new Error(`Os absent du vélo modélisé : ${name}`);
    return bone;
  };
  const ring = spinner(need('ChainRing_02'));
  const wheels = [spinner(need('Back_Wheel_01')), spinner(need('Front_Wheel_06'))];

  // Les pédales restent à plat quand la manivelle tourne : leur orientation au repos, dans le repère du vélo,
  // est rétablie à chaque image par une rotation inverse de celle de leur parent.
  const flat = ['LeftPeddle_04', 'RightPeddle_03'].map((name) => {
    const bone = need(name);
    const groupWorld = group.getWorldQuaternion(new THREE.Quaternion());
    return { bone, rest: groupWorld.invert().multiply(bone.getWorldQuaternion(new THREE.Quaternion())) };
  });
  const keepFlat = (): void => {
    group.updateWorldMatrix(true, true);
    const groupWorld = group.getWorldQuaternion(new THREE.Quaternion());
    for (const { bone, rest } of flat) {
      const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(parent.invert().multiply(groupWorld).multiply(rest));
    }
  };

  // La pédale gauche du modèle repose à un certain angle autour du plateau : le jeu la veut à `crankAngle`.
  const ringAt = ring.bone.getWorldPosition(new THREE.Vector3());
  const left = need('LeftPeddle_04').getWorldPosition(new THREE.Vector3());
  const restAngle = Math.atan2(left.y - ringAt.y, -(left.z - ringAt.z));

  // Le bassin sur la selle, juste derrière son centre ; le buste penché vers les cocottes.
  const saddle = onBike(ASSET_SADDLE.fx, ASSET_SADDLE.top);
  const hip: Point = [saddle[0] - 0.035, saddle[1] + 0.075];
  const hand = onBike(ASSET_HOOD.fx, ASSET_HOOD.y);
  const fit: RiderFit = {
    bb,
    crank: ASSET_CRANK * scale,
    hip,
    shoulder: [hip[0] + 0.5, hip[1] + 0.3],
    neck: [hip[0] + 0.58, hip[1] + 0.36],
    head: [hip[0] + 0.67, hip[1] + 0.44],
    hand,
    handSide: 0.2,
    thigh: 0.45,
    shin: 0.44,
  };

  return {
    group,
    fit,
    drive(crankAngle, wheelAngle) {
      spin(ring, crankAngle - restAngle);
      keepFlat();
      for (const wheel of wheels) spin(wheel, wheelAngle);
    },
  };
}
