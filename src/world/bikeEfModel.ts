// Cannondale SuperSix Evo d'EF : le modèle 3D du vélo, avec sa peinture rose. Ses roues sont découpées dans le fichier
// pour tourner ; manivelles et pédales sont dessinées en code, et le cycliste du jeu s'assied dessus.

import * as THREE from 'three';
import { cloneEfAsset } from './bikeAsset';
import type { AssetBike, RiderFit } from './bikeFromAsset';
import { EF_BB_Y, EF_BB_Z, EF_FRONT_HUB_Z, EF_FRONT_NAME, EF_GROUND_Y, EF_HUB_Y, EF_REAR_HUB_Z, EF_REAR_NAME, EF_TYRE_R } from './efSplit';
import { pbr } from './materials';
import { at, type Point } from './modelParts';

/** Position du pédalier dans le repère du jeu : celle des autres vélos. */
const BB_FORWARD = 0.03;
const CRANK = 0.172;
/** Selle (centre) et cocottes dans le repère du modèle (z, le modèle regarde vers -Z ; y vers le haut). */
const SADDLE = { z: 0.2, top: 0.293 };
const HOOD = { z: -0.29, y: 0.245, side: 0.1 };

export function buildEfBike(wheelRadiusM: number, material: THREE.Material | null): AssetBike {
  const group = new THREE.Group();
  const root = cloneEfAsset();
  const scale = wheelRadiusM / EF_TYRE_R;
  // Le modèle regarde déjà vers -Z : on le pose sur le sol, pédalier à sa place.
  root.scale.setScalar(scale);
  root.position.set(0, -EF_GROUND_Y * scale, -BB_FORWARD - EF_BB_Z * scale);
  group.add(root);
  group.updateMatrixWorld(true);
  const onBike = (z: number, y: number): Point => [BB_FORWARD - (z - EF_BB_Z) * scale, (y - EF_GROUND_Y) * scale];

  const meshes = new Map<string, THREE.Mesh>();
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      meshes.set(o.name, o);
      o.frustumCulled = false;
      if (material) o.material = material;
    }
  });
  const wheel = (name: string, z: number): THREE.Group | null => {
    const mesh = meshes.get(name);
    if (!mesh) return null;
    const pivot = new THREE.Group();
    pivot.position.set(0, EF_HUB_Y, z);
    root.add(pivot);
    root.updateMatrixWorld(true);
    pivot.attach(mesh);
    return pivot;
  };
  const wheels = [wheel(EF_FRONT_NAME, EF_FRONT_HUB_Z), wheel(EF_REAR_NAME, EF_REAR_HUB_Z)];

  const carbon = material ?? pbr({ color: 0x15171a, roughness: 0.4, metalness: 0.15 });
  const dark = material ?? pbr({ color: 0x2a2c31, roughness: 0.5, metalness: 0.5 });
  const bb = onBike(EF_BB_Z, EF_BB_Y);

  // Manivelles et pédales, tenues à plat : tout tourne avec la jambe (la gauche part vers l'avant à l'angle 0).
  const crankset = new THREE.Group();
  crankset.position.copy(at(bb[0], bb[1]));
  const pedals: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.026, CRANK + 0.02).translate(0, 0, -(CRANK + 0.02) / 2 + 0.01), carbon);
    arm.position.x = side * 0.056;
    arm.rotation.x = side < 0 ? 0 : Math.PI;
    crankset.add(arm);
    const pedal = new THREE.Group();
    pedal.position.set(side * 0.072, 0, side < 0 ? -CRANK : CRANK);
    pedal.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.1), dark));
    crankset.add(pedal);
    pedals.push(pedal);
  }
  group.add(crankset);

  const saddle = onBike(SADDLE.z, SADDLE.top);
  // Le bassin est calé comme sur le Van Rysel (23,5 cm derrière le pédalier, 78 cm au-dessus) : la jambe, plus courte que
  // la distance à la pédale basse si la selle est plus reculée ou plus haute, ne décollerait plus le pied.
  const hip: Point = [Math.max(saddle[0] - 0.035, bb[0] - 0.235), Math.min(saddle[1] + 0.075, bb[1] + 0.78)];
  const fit: RiderFit = {
    bb,
    crank: CRANK,
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

  return {
    group,
    fit,
    drive(crankAngle, wheelAngle) {
      crankset.rotation.x = crankAngle;
      for (const pedal of pedals) pedal.rotation.x = -crankAngle;
      for (const w of wheels) if (w) w.rotation.x = wheelAngle;
    },
  };
}
