// Colnago Y1Rs : le modèle 3D en pièces séparées. Le jeu regroupe les pièces des roues, du plateau, des manivelles
// et des pédales pour les faire tourner, et pose le cycliste sur la selle et les cocottes.

import * as THREE from 'three';
import { cloneY1rsAsset } from './bikeAsset';
import type { AssetBike, RiderFit } from './bikeFromAsset';
import type { Point } from './modelParts';
import { BB_Y, BB_Z, FRONT_HUB_Z, HUB_Y, MODEL_TYRE_R, REAR_HUB_Z, PEDAL_X, RING_NAME } from './y1rsSplit';

const part = (i: number): string => `tripo_part_${i}`;

/** Pneu, jante, moyeu et rayons de chaque roue (le plateau et le dérailleur n'en font pas partie). */
const FRONT_WHEEL = [3, 4, 8, 13, 15, 26, 31, 32, 34, 36, 37, 40, 41, 42, 45, 48, 50, 52, 53, 54, 55, 57, 58, 59, 60, 63, 64, 65, 66, 68];
const REAR_WHEEL = [5, 20, 21, 16, 24, 28, 29, 30, 33, 35, 38, 39, 43, 44, 46, 47, 49, 51, 56, 61, 62, 67];
/** Manivelle gauche, avec sa pédale (droite : la pédale 11 ; la manivelle droite est dans RING_NAME). */
const LEFT_CRANK = [14];
const LEFT_PEDAL = 12;
/** Porte-bidon décalé sur le côté dans le fichier, et qui traverse la jambe : on le retire. */
const BOTTLE_CAGE = 9;
const RIGHT_PEDAL = 11;
/** Les pédales, au repos : centre (z, y) dans le repère du modèle. */
const LEFT_PEDAL_AT: Point = [0.14, -0.102];
const RIGHT_PEDAL_AT: Point = [-0.051, -0.158];
const CRANK_M = 0.105;
/** Dont les pieds du cycliste sont plus bas que le centre du pédalier modélisé, en unités du modèle. */
const FOOT_DROP = 0.022;
const SADDLE = { z: 0.175, top: 0.3 };
const HOOD = { z: -0.33, y: 0.248, side: 0.12 };
/** La route jusqu'au sol : le dessous du pneu. */
const GROUND_Y = HUB_Y - MODEL_TYRE_R;
/** Position du pédalier dans le repère du jeu (devant le pied du modèle) : celle des autres vélos. */
const BB_FORWARD = 0.03;

export function buildY1rsModelBike(wheelRadiusM: number, material: THREE.Material | null): AssetBike {
  const group = new THREE.Group();
  const root = cloneY1rsAsset();
  const scale = wheelRadiusM / MODEL_TYRE_R;
  // Le sol du modèle est sous le pneu ; son pédalier est à BB_FORWARD devant l'origine du jeu.
  root.scale.setScalar(scale);
  root.position.set(0, -GROUND_Y * scale, -BB_FORWARD - BB_Z * scale);
  group.add(root);
  group.updateMatrixWorld(true);
  const onBike = (z: number, y: number): Point => [BB_FORWARD - (z - BB_Z) * scale, (y - GROUND_Y) * scale];

  const byName = new Map<string, THREE.Mesh>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      byName.set(o.name, o);
      o.frustumCulled = false;
      if (material) o.material = material;
    }
  });
  const need = (name: string): THREE.Mesh => {
    const mesh = byName.get(name);
    if (!mesh) throw new Error(`Le Colnago Y1Rs n'a pas la pièce ${name}.`);
    return mesh;
  };

  need(part(BOTTLE_CAGE)).visible = false;
  // Les pédales du fichier sont à 16 cm de l'axe ; le cycliste a les pieds à 7 cm : on les rapproche.
  need(part(RIGHT_PEDAL)).position.x -= 0.062 - PEDAL_X;
  need(part(LEFT_PEDAL)).position.x += 0.061 - PEDAL_X;

  // Un pivot par ensemble qui tourne ; les pièces y gardent leur place dans l'espace (attach).
  const pivot = (z: number, y: number, names: string[], parent: THREE.Object3D = root): THREE.Group => {
    const turning = new THREE.Group();
    turning.position.set(0, y, z);
    parent.add(turning);
    root.updateMatrixWorld(true);
    for (const name of names) turning.attach(need(name));
    return turning;
  };
  const front = pivot(FRONT_HUB_Z, HUB_Y, FRONT_WHEEL.map(part));
  const rear = pivot(REAR_HUB_Z, HUB_Y, REAR_WHEEL.map(part));
  const crankset = pivot(BB_Z, BB_Y, [RING_NAME, ...LEFT_CRANK.map(part)]);
  const pedals = [
    { pivot: pivot(LEFT_PEDAL_AT[0], LEFT_PEDAL_AT[1], [part(LEFT_PEDAL)]), at: LEFT_PEDAL_AT },
    { pivot: pivot(RIGHT_PEDAL_AT[0], RIGHT_PEDAL_AT[1], [part(RIGHT_PEDAL)]), at: RIGHT_PEDAL_AT },
  ];
  // Les pédales tournent avec les manivelles : elles sont rattachées au pédalier, puis tenues à plat.
  for (const p of pedals) crankset.attach(p.pivot);

  // Au repos du jeu (angle 0), la pédale gauche est horizontale vers l'avant ; dans le modèle, elle est derrière, un peu en haut.
  const restAngle = Math.atan2(LEFT_PEDAL_AT[1] - BB_Y, -(LEFT_PEDAL_AT[0] - BB_Z));

  // Les pédales du modèle sont plus basses que celles qu'attend le cycliste : on baisse un peu ses pieds et son bassin.
  const bb: Point = onBike(BB_Z, BB_Y - FOOT_DROP);
  const saddle = onBike(SADDLE.z, SADDLE.top);
  const hip: Point = [saddle[0] - 0.035, saddle[1] + 0.075 - FOOT_DROP * scale];
  const fit: RiderFit = {
    bb,
    crank: CRANK_M * scale,
    hip,
    shoulder: [hip[0] + 0.5, hip[1] + 0.3],
    neck: [hip[0] + 0.58, hip[1] + 0.36],
    head: [hip[0] + 0.67, hip[1] + 0.44],
    hand: onBike(HOOD.z, HOOD.y),
    handSide: HOOD.side * scale,
    handRoll: 0.8,
    handSlope: 0.4,
    thigh: 0.45,
    shin: 0.44,
  };

  const drive = (crankAngle: number, wheelAngle: number): void => {
    const turn = crankAngle - restAngle;
    crankset.rotation.x = turn;
    for (const p of pedals) p.pivot.rotation.x = -turn;
    front.rotation.x = wheelAngle;
    rear.rotation.x = wheelAngle;
  };
  drive(0, 0);
  return { group, fit, drive };
}
