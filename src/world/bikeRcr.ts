// Van Rysel RCR : modèle en pièces séparées (sans squelette), dans son repère (mètres, x vers l'avant).
// Le jeu en regroupe les pièces pour faire tourner roues, plateau, manivelles et pédales, et ramène les roues,
// dessinées trop grandes, à la taille d'une roue de route.

import * as THREE from 'three';
import { cloneRcrAsset } from './bikeAsset';
import type { AssetBike, RiderFit } from './bikeFromAsset';
import type { Point } from './modelParts';

const BB = { fx: 0, y: 0.267 };
/** Rayon du pneu de la roue de route du jeu (la physique l'utilise) et rayon montré à l'écran : le modèle, lui, a 0,4665. */
const GAME_TYRE_R = 0.335;
const TYRE_R = 0.41;
const MODEL_TYRE_R = 0.4665;
const HUB_Y = 0.337;
const REAR_HUB = -0.404;
const FRONT_HUB = 0.586;
const SADDLE = { fx: -0.2, top: 0.97 };
const HOOD = { fx: 0.605, y: 0.925 };
/** Pédale gauche au repos, en haut, un peu en avant ; la droite est en bas, à l'opposé. */
const LEFT_PEDAL: Point = [0.014, 0.439];
const RIGHT_PEDAL: Point = [-0.014, 0.095];
const CRANK = Math.hypot(LEFT_PEDAL[0] - BB.fx, LEFT_PEDAL[1] - BB.y);

/** Rang des pièces du modèle, dans l'ordre où le parcours du fichier les rencontre. */
const REAR_WHEEL = [37, 38, 39, 40, 41, 42, 43, 44, 45, 46];
const FRONT_WHEEL = [47, 48, 49, 50, 51, 52, 53, 54, 55, 56];
const CASSETTE = 66;
const CRANKSET = [59, 60, 61, 62, 63, 64, 65, 72, 75, 78];
const LEFT_PEDAL_PARTS = [73, 74];
const RIGHT_PEDAL_PARTS = [76, 77];
const MESH_COUNT = 79;

export function buildRcrBike(wheelRadiusM: number, material: THREE.Material | null): AssetBike {
  const group = new THREE.Group();
  const root = cloneRcrAsset();
  const scale = wheelRadiusM / GAME_TYRE_R;
  const bb: Point = [0.03, (BB.y - (HUB_Y - TYRE_R)) * scale];
  const onBike = (fx: number, y: number): Point => [bb[0] + (fx - BB.fx) * scale, (y - (HUB_Y - TYRE_R)) * scale];
  // Le modèle regarde vers +X, le jeu vers -Z ; le sol du modèle est sous le moyeu, à un rayon de pneu.
  root.rotation.y = Math.PI / 2;
  root.scale.setScalar(scale);
  root.position.set(0, -(HUB_Y - TYRE_R) * scale, -bb[0] + BB.fx * scale);
  group.add(root);
  group.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes.push(o);
      o.frustumCulled = false;
      if (material) o.material = material;
    }
  });
  if (meshes.length !== MESH_COUNT) throw new Error(`Le Van Rysel RCR a ${meshes.length} pièces au lieu de ${MESH_COUNT}.`);

  // Un pivot par ensemble qui tourne ; les pièces y gardent leur place dans l'espace (attach).
  const pivot = (x: number, y: number, parts: number[], shrink = 1): THREE.Group => {
    const turning = new THREE.Group();
    turning.position.set(x, y, 0);
    const inner = new THREE.Group();
    turning.add(inner);
    root.add(turning);
    root.updateMatrixWorld(true);
    for (const i of parts) inner.attach(meshes[i]);
    inner.scale.set(shrink, shrink, 1);
    return turning;
  };
  const shrink = TYRE_R / MODEL_TYRE_R;
  const rear = pivot(REAR_HUB, HUB_Y, REAR_WHEEL, shrink);
  const front = pivot(FRONT_HUB, HUB_Y, FRONT_WHEEL, shrink);
  rear.attach(meshes[CASSETTE]);
  const crankset = pivot(BB.fx, BB.y, CRANKSET);
  const pedals = [
    { pivot: pivot(LEFT_PEDAL[0], LEFT_PEDAL[1], LEFT_PEDAL_PARTS), at: LEFT_PEDAL },
    { pivot: pivot(RIGHT_PEDAL[0], RIGHT_PEDAL[1], RIGHT_PEDAL_PARTS), at: RIGHT_PEDAL },
  ];
  // Les pédales tournent avec les manivelles : elles sont rattachées au pédalier, puis tenues à plat.
  for (const p of pedals) crankset.attach(p.pivot);

  const restAngle = Math.atan2(LEFT_PEDAL[1] - BB.y, LEFT_PEDAL[0] - BB.fx);

  const saddle = onBike(SADDLE.fx, SADDLE.top);
  const hip: Point = [saddle[0] - 0.035, saddle[1] + 0.075];
  const fit: RiderFit = {
    bb,
    crank: CRANK * scale,
    hip,
    shoulder: [hip[0] + 0.5, hip[1] + 0.3],
    neck: [hip[0] + 0.58, hip[1] + 0.36],
    head: [hip[0] + 0.67, hip[1] + 0.44],
    hand: onBike(HOOD.fx, HOOD.y),
    handSide: 0.2,
    handRoll: 0.8,
    handSlope: 0.4,
    thigh: 0.45,
    shin: 0.44,
  };

  return {
    group,
    fit,
    drive(crankAngle, wheelAngle) {
      const turn = crankAngle - restAngle;
      crankset.rotation.z = turn;
      for (const p of pedals) p.pivot.rotation.z = -turn;
      rear.rotation.z = wheelAngle;
      front.rotation.z = wheelAngle;
    },
  };
}
