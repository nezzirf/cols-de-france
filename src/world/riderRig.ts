// Personnage du cycliste, fabriqué en code : un squelette humain debout, bras en croix, et seulement ce qui se
// voit hors de la combinaison (tête, cou, bras, mains, jambes, pieds). Le tronc, c'est la combinaison, rattachée
// à ce squelette.

import * as THREE from 'three';
import { pbr, skinMaterial } from './materials';
import { ball, place, turned } from './modelParts';
import { headGeometry } from './riderGear';
import { type Limb, skinSuit, type SuitPart } from './riderSuit';

/** Os du personnage : nom, parent, position au repos (mètres, debout, de face vers +Z, côté gauche vers +X). */
const BONES: [name: string, parent: string | null, at: [number, number, number]][] = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 0.95, 0]],
  ['spine_01', 'pelvis', [0, 1.06, 0]],
  ['spine_02', 'spine_01', [0, 1.18, 0]],
  ['spine_03', 'spine_02', [0, 1.31, 0]],
  ['neck_01', 'spine_03', [0, 1.5, 0]],
  ['Head', 'neck_01', [0, 1.6, 0]],
  ...(['l', 'r'] as const).flatMap((side): [string, string | null, [number, number, number]][] => {
    const s = side === 'l' ? 1 : -1;
    return [
      [`clavicle_${side}`, 'spine_03', [0.03 * s, 1.48, 0]],
      [`upperarm_${side}`, `clavicle_${side}`, [0.2 * s, 1.46, 0]],
      [`lowerarm_${side}`, `upperarm_${side}`, [0.45 * s, 1.46, 0]],
      [`hand_${side}`, `lowerarm_${side}`, [0.69 * s, 1.46, 0]],
      [`middle_01_${side}`, `hand_${side}`, [0.8 * s, 1.46, 0]],
      [`thigh_${side}`, 'pelvis', [0.1 * s, 0.96, 0]],
      [`calf_${side}`, `thigh_${side}`, [0.1 * s, 0.54, 0]],
      [`foot_${side}`, `calf_${side}`, [0.1 * s, 0.09, -0.02]],
      [`ball_${side}`, `foot_${side}`, [0.1 * s, 0.02, 0.13]],
    ];
  }),
];

/** Segments que la combinaison suit : l'os qui les porte, et leurs deux bouts. */
const LIMBS: [bone: string, to: string][] = [
  ['pelvis', 'spine_01'],
  ['spine_01', 'spine_02'],
  ['spine_02', 'spine_03'],
  ['spine_03', 'neck_01'],
  ['neck_01', 'Head'],
  ...(['l', 'r'] as const).flatMap((side): [string, string][] => [
    [`clavicle_${side}`, `upperarm_${side}`],
    [`upperarm_${side}`, `lowerarm_${side}`],
    [`lowerarm_${side}`, `hand_${side}`],
    [`thigh_${side}`, `calf_${side}`],
    [`calf_${side}`, `foot_${side}`],
  ]),
];

export interface Rig {
  group: THREE.Group;
}

export function buildRig(suit: SuitPart[]): Rig {
  const bones = new Map<string, THREE.Bone>();
  const rest = new Map<string, THREE.Vector3>();
  const list: THREE.Bone[] = [];
  for (const [name, parent, at] of BONES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const world = new THREE.Vector3(...at);
    rest.set(name, world);
    bone.position.copy(world).sub(parent ? rest.get(parent)! : new THREE.Vector3());
    if (parent) bones.get(parent)!.add(bone);
    bones.set(name, bone);
    list.push(bone);
  }
  const group = new THREE.Group();
  group.add(bones.get('root')!);
  group.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);

  const skin = skinMaterial(0xd2a07a);
  const glove = pbr({ color: 0x131417, roughness: 0.6 });
  const sock = pbr({ color: 0xf4f4f1, roughness: 0.8 });
  const shoe = pbr({ color: 0xeeeeea, roughness: 0.32 });
  const sole = pbr({ color: 0x17181b, roughness: 0.4 });
  const hair = pbr({ color: 0x2c2118, roughness: 0.75 });
  const lips = pbr({ color: 0xa96a5c, roughness: 0.5 });

  /** Un volume tourné de longueur 1, étiré entre deux points d'un os (dans le repère de cet os). */
  const part = (bone: string, geometry: THREE.BufferGeometry, material: THREE.Material, from: THREE.Vector3, to: THREE.Vector3): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material);
    place(mesh, from, to);
    bones.get(bone)!.add(mesh);
    return mesh;
  };
  const link = (bone: string, child: string): THREE.Vector3 => rest.get(child)!.clone().sub(rest.get(bone)!);
  const origin = new THREE.Vector3();

  // Cou
  part('neck_01', turned([0.058, 0.05, 0.05], 16), skin, origin, link('neck_01', 'Head').add(new THREE.Vector3(0, 0.05, 0)));

  // Tête : centrée sur le crâne, de face vers -Z comme le reste du cycliste dessiné, puis retournée vers +Z.
  const skull = new THREE.Group();
  skull.name = 'skull';
  skull.position.set(0, 0.09, 0.005);
  skull.rotation.y = Math.PI;
  skull.scale.setScalar(0.94);
  skull.add(new THREE.Mesh(headGeometry(), skin));
  const nose = new THREE.Mesh(turned([0.012, 0.015, 0.018, 0.016, 0.004], 10), skin);
  place(nose, new THREE.Vector3(0, 0.012, -0.096), new THREE.Vector3(0, -0.03, -0.116));
  skull.add(nose);
  const mouth = ball(1, lips);
  mouth.scale.set(0.024, 0.0055, 0.008);
  mouth.position.set(0, -0.063, -0.083);
  skull.add(mouth);
  for (const side of [-1, 1]) {
    const ear = ball(1, skin);
    ear.scale.set(0.009, 0.03, 0.019);
    ear.position.set(side * 0.086, -0.012, 0.01);
    skull.add(ear);
  }
  const nape = ball(1, hair);
  nape.scale.set(0.083, 0.066, 0.062);
  nape.position.set(0, -0.012, 0.05);
  skull.add(nape);
  bones.get('Head')!.add(skull);

  // Bras : ce qui dépasse des manches courtes, puis l'avant-bras et la main gantée.
  const upperArm = turned([0.05, 0.048, 0.045, 0.041, 0.038], 18);
  const foreArm = turned([0.038, 0.044, 0.043, 0.036, 0.029, 0.024], 18);
  for (const side of ['l', 'r'] as const) {
    part(`upperarm_${side}`, upperArm, skin, origin, link(`upperarm_${side}`, `lowerarm_${side}`));
    const elbow = ball(0.04, skin);
    bones.get(`lowerarm_${side}`)!.add(elbow);
    part(`lowerarm_${side}`, foreArm, skin, origin, link(`lowerarm_${side}`, `hand_${side}`));
    const palm = ball(1, glove);
    palm.scale.set(0.058, 0.022, 0.046);
    palm.position.copy(link(`hand_${side}`, `middle_01_${side}`)).multiplyScalar(0.45);
    bones.get(`hand_${side}`)!.add(palm);
    const direction = side === 'l' ? 1 : -1;
    for (let k = 0; k < 4; k++) {
      const finger = new THREE.Mesh(turned([0.0095, 0.0095, 0.008], 8), glove);
      const across = (0.018 - k * 0.012) * -1;
      place(finger, new THREE.Vector3(0.05 * direction, -0.004, across), new THREE.Vector3(0.12 * direction, -0.03, across));
      bones.get(`hand_${side}`)!.add(finger);
    }
    const thumb = new THREE.Mesh(turned([0.011, 0.01, 0.008], 8), glove);
    place(thumb, new THREE.Vector3(0.02 * direction, -0.004, 0.03), new THREE.Vector3(0.07 * direction, -0.03, 0.05));
    bones.get(`hand_${side}`)!.add(thumb);
  }

  // Jambes : la cuisse sous le cuissard, le genou, le mollet, la chaussette, la chaussure à deux sangles.
  const thigh = turned([0.085, 0.083, 0.078, 0.071, 0.063, 0.055, 0.05], 20);
  const calf = turned([0.048, 0.052, 0.054, 0.049, 0.042, 0.036, 0.031], 20);
  const sockGeo = turned([0.042, 0.04, 0.038, 0.037], 16);
  const footGeo = turned([0, 0.03, 0.04, 0.043, 0.038, 0.027, 0], 16);
  footGeo.scale(1.08, 1, 0.82);
  const soleGeo = turned([0, 0.03, 0.038, 0.04, 0.036, 0.024, 0], 12);
  soleGeo.scale(1.12, 1, 0.22);
  const strapNear = turned([0.0465, 0.0465], 16).scale(1.08, 1, 0.84);
  const strapFar = turned([0.0385, 0.0385], 16).scale(1.08, 1, 0.84);
  for (const side of ['l', 'r'] as const) {
    part(`thigh_${side}`, thigh, skin, origin, link(`thigh_${side}`, `calf_${side}`));
    bones.get(`calf_${side}`)!.add(ball(0.052, skin));
    const shin = link(`calf_${side}`, `foot_${side}`);
    part(`calf_${side}`, calf, skin, origin, shin);
    part(`calf_${side}`, sockGeo, sock, shin.clone().multiplyScalar(0.62), shin);
    // Chaussure : du talon aux orteils, dans le repère de la cheville.
    const heel = new THREE.Vector3(0, -0.03, -0.06);
    const toe = link(`foot_${side}`, `ball_${side}`).add(new THREE.Vector3(0, -0.01, 0.075));
    part(`foot_${side}`, footGeo, shoe, heel, toe);
    part(`foot_${side}`, soleGeo, sole, heel.clone().add(new THREE.Vector3(0, -0.026, 0)), toe.clone().add(new THREE.Vector3(0, -0.024, 0)));
    const along = (t: number) => heel.clone().lerp(toe, t);
    part(`foot_${side}`, strapNear, sole, along(0.47), along(0.55));
    part(`foot_${side}`, strapFar, sole, along(0.66), along(0.73));
  }

  // La combinaison, rattachée aux os les plus proches de chaque point du tissu.
  const limbs: Limb[] = LIMBS.map(([bone, to]) => ({ bone: list.indexOf(bones.get(bone)!), from: rest.get(bone)!, to: rest.get(to)! }));
  for (const mesh of skinSuit(skeleton, limbs, suit)) group.add(mesh);
  return { group };
}
