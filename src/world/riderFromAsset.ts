// Cycliste modélisé, posé sur le vélo. À chaque image, jambes et bras sont recalculés (deux segments articulés)
// pour que les pieds suivent les pédales et les mains restent sur les cocottes ; le buste reste penché sur le vélo.

import * as THREE from 'three';
import type { RiderFit } from './bikeFromAsset';
import { pbr } from './materials';
import { at } from './modelParts';
import { cloneRiderAsset } from './riderAsset';
import { addHeadGear } from './riderGear';

const PEDAL_SIDE = 0.1;
const TORSO_BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'] as const;
/** Inclinaison de la tête par rapport à l'horizontale, pour regarder la route. */
const HEAD_PITCH = -0.12;

const tmp = new THREE.Vector3();

function worldPos(bone: THREE.Object3D): THREE.Vector3 {
  return bone.getWorldPosition(new THREE.Vector3());
}

/** Tourne `bone` pour que son enfant `child` pointe vers `target`. */
function aim(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  bone.updateWorldMatrix(true, true);
  const from = worldPos(bone);
  const now = worldPos(child).sub(from).normalize();
  const want = tmp.copy(target).sub(from).normalize();
  const swing = new THREE.Quaternion().setFromUnitVectors(now, want);
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const world = swing.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

/** Coude ou genou : deux segments de longueurs données entre `from` et `to`, pliés du côté de `pole`. */
function joint(from: THREE.Vector3, to: THREE.Vector3, first: number, second: number, pole: THREE.Vector3): THREE.Vector3 {
  const span = to.clone().sub(from);
  const dist = Math.min(first + second - 1e-4, Math.max(Math.abs(first - second) + 1e-4, span.length()));
  const dir = span.normalize();
  const along = (first * first - second * second + dist * dist) / (2 * dist);
  const across = Math.sqrt(Math.max(0, first * first - along * along));
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return from.clone().addScaledVector(dir, along).addScaledVector(bend, across);
}

/** Ce que le cycliste porte en plus de sa combinaison. */
export interface Outfit {
  /** Matière du casque. */
  accent: THREE.Material;
}

export interface AssetRider {
  group: THREE.Group;
  pose(crankAngle: number): void;
}

export function buildAssetRider(fit: RiderFit, outfit: Outfit): AssetRider {
  const group = new THREE.Group();
  const rig = cloneRiderAsset();
  group.add(rig);
  const bone = (name: string): THREE.Object3D => {
    const found = rig.getObjectByName(name);
    if (!found) throw new Error(`Os absent du personnage modélisé : ${name}`);
    return found;
  };

  // Le personnage regarde vers +Z, le jeu vers -Z ; sa taille s'ajuste à la longueur des jambes du vélo.
  rig.rotation.y = Math.PI;
  rig.updateMatrixWorld(true);
  const restLeg = worldPos(bone('thigh_l')).distanceTo(worldPos(bone('calf_l'))) + worldPos(bone('calf_l')).distanceTo(worldPos(bone('foot_l')));
  rig.scale.setScalar((fit.thigh + fit.shin) / restLeg);
  rig.updateMatrixWorld(true);

  // Casque aéro, lunettes et sangle, posés sur le crâne : ils suivent la tête.
  addHeadGear(bone('Head').getObjectByName('skull')!, {
    accent: outfit.accent,
    dark: pbr({ color: 0x16181c, roughness: 0.5 }),
    lens: pbr({ color: 0x0b1118, roughness: 0.08, metalness: 0.95 }),
    tt: true,
  });

  // Le bassin se pose sur la selle : le milieu des deux hanches au point voulu.
  const hips = worldPos(bone('thigh_l')).add(worldPos(bone('thigh_r'))).multiplyScalar(0.5);
  rig.position.add(at(fit.hip[0], fit.hip[1], 0).sub(hips));
  rig.updateMatrixWorld(true);

  // Longueurs des segments, mesurées sur le personnage à sa taille finale.
  const length = (a: string, b: string) => worldPos(bone(a)).distanceTo(worldPos(bone(b)));
  const thigh = length('thigh_l', 'calf_l');
  const shin = length('calf_l', 'foot_l');
  const upper = length('upperarm_l', 'lowerarm_l');
  const fore = length('lowerarm_l', 'hand_l');

  // Buste : une droite du bassin au cou, penchée comme le cycliste de la fiche du vélo.
  const pelvis = worldPos(bone('pelvis'));
  const lean = at(fit.neck[0], fit.neck[1], 0).sub(at(fit.hip[0], fit.hip[1], 0)).normalize();
  const rest = TORSO_BONES.map((name) => worldPos(bone(name)));
  const reach = rest.map((p) => p.distanceTo(pelvis));
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < TORSO_BONES.length - 1; i++) {
    // La tête se redresse un peu par rapport au buste, pour regarder devant.
    const dir = i === TORSO_BONES.length - 2 ? lean.clone().lerp(up, 0.45).normalize() : lean;
    const next = i === TORSO_BONES.length - 2 ? worldPos(bone(TORSO_BONES[i])).addScaledVector(dir, reach[i + 1] - reach[i]) : pelvis.clone().addScaledVector(dir, reach[i + 1]);
    aim(bone(TORSO_BONES[i]), bone(TORSO_BONES[i + 1]), next);
  }
  const head = bone('Head');
  const headLook = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), HEAD_PITCH);

  // Pose du torse figée : le reste de l'animation repart d'elle.
  const base = new Map<THREE.Object3D, THREE.Quaternion>();
  rig.traverse((o) => base.set(o, o.quaternion.clone()));

  const limbs = {
    legs: [-1, 1].map((side) => ({
      side,
      hip: bone(side < 0 ? 'thigh_l' : 'thigh_r'),
      knee: bone(side < 0 ? 'calf_l' : 'calf_r'),
      ankle: bone(side < 0 ? 'foot_l' : 'foot_r'),
      ball: bone(side < 0 ? 'ball_l' : 'ball_r'),
    })),
    arms: [-1, 1].map((side) => ({
      side,
      shoulder: bone(side < 0 ? 'upperarm_l' : 'upperarm_r'),
      elbow: bone(side < 0 ? 'lowerarm_l' : 'lowerarm_r'),
      wrist: bone(side < 0 ? 'hand_l' : 'hand_r'),
      knuckle: bone(side < 0 ? 'middle_01_l' : 'middle_01_r'),
    })),
  };

  // Les cibles sont données dans le repère du cycliste ; dans le jeu, il est posé et orienté sur la route,
  // donc on les convertit dans le repère du monde, où se calculent les os.
  const world = (p: THREE.Vector3) => group.localToWorld(p.clone());
  const around = new THREE.Quaternion();
  const pole = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(around);

  const pose = (crankAngle: number) => {
    // Repart de la pose du torse : les jambes et les bras sont recalculés depuis elle.
    for (const [o, q] of base) o.quaternion.copy(q);
    group.updateWorldMatrix(true, false);
    group.getWorldQuaternion(around);
    rig.updateMatrixWorld(true);

    limbs.legs.forEach((leg, i) => {
      const angle = crankAngle + i * Math.PI;
      const px = fit.bb[0] + Math.cos(angle) * fit.crank;
      const py = fit.bb[1] + Math.sin(angle) * fit.crank;
      const ankle = world(at(px - 0.09, py + 0.09, leg.side * PEDAL_SIDE));
      const ball = world(at(px + 0.02, py + 0.01, leg.side * PEDAL_SIDE));
      const knee = joint(worldPos(leg.hip), ankle, thigh, shin, pole(leg.side * 0.25, 0, -1));
      aim(leg.hip, leg.knee, knee);
      aim(leg.knee, leg.ankle, ankle);
      aim(leg.ankle, leg.ball, ball);
    });

    for (const arm of limbs.arms) {
      const grip = world(at(fit.hand[0], fit.hand[1], arm.side * fit.handSide));
      const wrist = world(at(fit.hand[0] - 0.075, fit.hand[1] + 0.025, arm.side * fit.handSide));
      const elbow = joint(worldPos(arm.shoulder), wrist, upper, fore, pole(arm.side * 0.55, -0.8, 0.1));
      aim(arm.shoulder, arm.elbow, elbow);
      aim(arm.elbow, arm.wrist, wrist);
      aim(arm.wrist, arm.knuckle, grip);
    }

    // La tête : l'inclinaison voulue par rapport au monde, quel que soit l'angle du cou.
    const parent = head.parent!.getWorldQuaternion(new THREE.Quaternion());
    head.quaternion.copy(parent.invert().multiply(around.clone().multiply(headLook).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)))));
    head.updateWorldMatrix(false, true);
  };

  pose(0);
  return { group, pose };
}
