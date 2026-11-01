// Cycliste modélisé : un personnage humain rigué, posé sur le vélo. À chaque image, jambes et bras sont
// recalculés (deux segments articulés) pour que les pieds suivent les pédales et les mains restent sur
// les cocottes ; le buste reste penché sur le vélo.

import * as THREE from 'three';
import type { RiderFit } from './bikeFromAsset';
import { at } from './modelParts';
import { cloneRiderAsset, type HeadFrame, riderHead, riderIsSuited } from './riderAsset';
import { addGlasses } from './riderGear';
import { place, turned } from './modelParts';
import { pbr } from './materials';

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

/** Tenue du cycliste : les matières déjà choisies pour le vélo et le maillot de l'équipe. */
export interface Outfit {
  jersey: THREE.Material;
  shorts: THREE.Material;
  /** Casque. */
  accent: THREE.Material;
  /** Tout en une seule matière, comme une statue. */
  mono: boolean;
}

const CLOTH_UNIFORMS = ['uJersey', 'uShorts', 'uGloves', 'uShoes', 'uSocks'] as const;

/**
 * Matière de la peau, où le maillot, le cuissard, les gants, les chaussettes et les chaussures sont peints
 * par pixel d'après la hauteur au repos : un bord reste net, et suit le corps quand il bouge.
 */
function dressSkin(source: THREE.MeshStandardMaterial, outfit: Outfit): THREE.MeshStandardMaterial {
  const skin = source.clone();
  // Les muscles du dessin de la peau s'adoucissent : un coureur est plus sec qu'un haltérophile.
  skin.normalScale = new THREE.Vector2(0.55, 0.55);
  const colorOf = (m: THREE.Material): THREE.Color => ((m as THREE.MeshStandardMaterial).color ?? new THREE.Color(0x888888)).clone();
  const colors: Record<(typeof CLOTH_UNIFORMS)[number], THREE.Color> = {
    uJersey: colorOf(outfit.jersey),
    uShorts: colorOf(outfit.shorts),
    uGloves: new THREE.Color(0x131417),
    uShoes: new THREE.Color(0xeeeeea),
    uSocks: new THREE.Color(0xf4f4f1),
  };
  // Une valeur décimale : le shader compare ce nombre à 0.5, et GLSL n'accepte pas un entier là.
  skin.defines = { SUITED: riderIsSuited() ? '1.0' : '0.0' };
  skin.onBeforeCompile = (shader) => {
    for (const name of CLOTH_UNIFORMS) shader.uniforms[name] = { value: colors[name] };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRest;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vRest;\nuniform vec3 uJersey;\nuniform vec3 uShorts;\nuniform vec3 uGloves;\nuniform vec3 uShoes;\nuniform vec3 uSocks;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float w = 0.004;
        float ax = abs(vRest.x);
        float y = vRest.y;
        float shorts = SUITED > 0.5 ? 0.0 : smoothstep(0.66 - w, 0.66 + w, y) * (1.0 - smoothstep(1.03 - w, 1.03 + w, y));
        float collar = 1.555 + 0.045 * smoothstep(0.05, 0.11, ax);
        float torso = smoothstep(1.03 - w, 1.03 + w, y) * (1.0 - smoothstep(collar - w, collar + w, y));
        float jersey = SUITED > 0.5 ? 0.0 : torso * (1.0 - smoothstep(0.36 - w, 0.36 + w, ax));
        float gloves = smoothstep(0.7 - w, 0.7 + w, ax) * step(1.2, y);
        float shoes = 1.0 - smoothstep(0.115 - w, 0.115 + w, y);
        float socks = (1.0 - smoothstep(0.3 - w, 0.3 + w, y)) * (1.0 - shoes);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShorts, shorts);
        diffuseColor.rgb = mix(diffuseColor.rgb, uJersey, jersey);
        diffuseColor.rgb = mix(diffuseColor.rgb, uGloves, gloves);
        diffuseColor.rgb = mix(diffuseColor.rgb, uSocks, socks);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShoes, shoes);
        float cloth = clamp(shorts + jersey + gloves + socks + shoes, 0.0, 1.0);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.7, cloth);')
      // Une chaussure est lisse : les orteils du dessin de la peau n'y apparaissent pas.
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>' + '\nnormal = mix(normal, nonPerturbedNormal, max(shoes, socks));');
  };
  return skin;
}

/**
 * Casque aéro : la couleur de l'équipe sous un vernis, un bord de mousse sombre, deux prises d'air sur le
 * front et une longue fente d'évacuation au sommet, dessinés par pixel sur la calotte.

 */
function helmetMaterial(accent: THREE.Material, skull: HeadFrame): THREE.Material {
  const color = ((accent as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xdddddd)).clone();
  const material = new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uVents = { value: new THREE.Vector3(skull.vents.front, skull.vents.middle, skull.vents.depth) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRim;\nvarying float vRim;\nvarying vec3 vShell;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRim = aRim;\nvShell = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRim;\nvarying vec3 vShell;\nuniform vec3 uVents;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float foam = 1.0 - smoothstep(0.004, 0.012, vRim);
        float ax = abs(vShell.x);
        float zf = uVents.x;
        float zm = uVents.y;
        float dd = uVents.z;
        float intake = smoothstep(0.014, 0.016, ax) * (1.0 - smoothstep(0.029, 0.031, ax)) * smoothstep(zf - 0.09, zf - 0.085, vShell.z) * (1.0 - smoothstep(zf - 0.035, zf - 0.03, vShell.z));
        float exhaust = (1.0 - smoothstep(0.005, 0.007, ax)) * smoothstep(zm - 0.42 * dd, zm - 0.415 * dd, vShell.z) * (1.0 - smoothstep(zm + 0.03, zm + 0.035, vShell.z));
        float slot = max(intake, exhaust) * smoothstep(0.025, 0.035, vRim);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.015), max(foam, slot));`,
      );
  };
  return material;
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

  // Le modèle regarde vers +Z, le jeu vers -Z ; sa taille s'ajuste à la longueur des jambes du vélo.
  rig.rotation.y = Math.PI;
  rig.updateMatrixWorld(true);
  const restLeg = worldPos(bone('thigh_l')).distanceTo(worldPos(bone('calf_l'))) + worldPos(bone('calf_l')).distanceTo(worldPos(bone('foot_l')));
  rig.scale.setScalar((fit.thigh + fit.shin) / restLeg);
  rig.updateMatrixWorld(true);

  // Tenue : maillot, cuissard, gants, chaussettes et chaussures sont peints sur la peau, par zones de hauteur.
  rig.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh && o.name === 'SuperHero_Male') {
      const skin = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
      o.material = outfit.mono ? outfit.jersey : dressSkin(skin, outfit);
    }
  });

  // Casque ajusté sur le crâne, sangle et lunettes. Tout se pose dans le repère d'origine du personnage, puis
  // se rattache à l'os de la tête : ils le suivent quand il s'incline.
  const headBone = bone('Head');
  const skull = riderHead();
  const dark = outfit.mono ? outfit.jersey : pbr({ color: 0x16181c, roughness: 0.5 });
  const lens = outfit.mono ? outfit.jersey : pbr({ color: 0x24384a, roughness: 0.1, metalness: 0.7, transparent: true, opacity: 0.8 });
  const fitted = new THREE.Group();
  fitted.matrixAutoUpdate = false;
  fitted.matrix.copy(skull.restInverse);
  headBone.add(fitted);
  fitted.add(new THREE.Mesh(skull.shell, outfit.mono ? outfit.jersey : helmetMaterial(outfit.accent, skull)));
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(turned([0.0045, 0.0045], 6), dark);
    place(strap, new THREE.Vector3(skull.temple.x * side, skull.temple.y, skull.temple.z), new THREE.Vector3(skull.chin.x * side, skull.chin.y, skull.chin.z));
    fitted.add(strap);
  }
  const glasses = new THREE.Group();
  addGlasses(glasses, { dark, lens });
  // Les lunettes sont dessinées pour une tête de 17 cm de large, face vers -Z ; le personnage regarde vers +Z.
  const size = skull.width / 0.172;
  // Un peu plus hautes que celles du dessin d'origine, et en avant des yeux, que le visage enfonce.
  glasses.scale.set(size * 0.92, size * 1.1, size * 0.96);
  glasses.rotation.y = Math.PI;
  glasses.position.set(skull.eyes.x, skull.eyes.y - 0.018 * size * 1.1, skull.eyes.z + 0.05 - 0.117 * size);
  fitted.add(glasses);

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
  // La tête regarde la route : on la redresse par rapport à l'horizontale.
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
