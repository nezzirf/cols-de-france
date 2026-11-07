// Cycliste modélisé : un personnage humain rigué, posé sur le vélo. À chaque image, jambes et bras sont
// recalculés (deux segments articulés) pour que les pieds suivent les pédales et les mains restent sur
// les cocottes ; le buste reste penché sur le vélo.

import * as THREE from 'three';
import { KIT_STYLES, type Livery } from '../sim/kits';
import type { RiderFit } from './bikeFromAsset';
import { at } from './modelParts';
import { cloneRiderAsset, type HeadFrame, riderGlasses, riderHead, riderHeadModel, riderHelmetGeometry } from './riderAsset';
import { place, turned } from './modelParts';
import { pbr } from './materials';

const PEDAL_SIDE = 0.072;
/** Les genoux montent droit vers l'avant, au plus près du cadre : léger rappel vers l'intérieur (0 : droit, plus : vers le cadre). */
const KNEE_IN = 0.05;
/** Avant-pied par rapport à l'axe de la pédale : en avant (m), épaisseur de la pédale au-dessus de l'axe, hauteur de l'os de l'avant-pied au-dessus de la semelle. */
const CLEAT_FORWARD = 0.005;
const PEDAL_TOP = 0.012;
/** Redressement du buste par rapport à la fiche du vélo : 0 le garde tel quel, 1 le rend vertical. */
const TORSO_RISE = 0.15;
/** Penchée supplémentaire (rad) du bassin, des reins et du haut du dos par rapport à la droite du buste : plus, moins de cambrure. La somme est nulle. */
const LUMBAR_TILT = [-0.2, -0.1, 0.12, 0.18] as const;
const TORSO_BONES = ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head'] as const;
/** Inclinaison de la tête par rapport à l'horizontale, pour regarder la route. */
const HEAD_PITCH = -0.12;

/**
 * Matière de la tête modélisée : le casque est rouge dans la texture, et seule cette calotte prend la couleur du casque de
 * l'équipe, en gardant ombres et reflets. Les lunettes (à l'avant, à hauteur des yeux), le col et la peau restent tels quels.
 */
function teamHeadMaterial(map: THREE.Texture | null, team: THREE.Color): THREE.Material {
  const material = new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
  const uniform = { value: team.clone() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTeam = uniform;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vRawPos;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRawPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uTeam;\nvarying vec3 vRawPos;\nvoid main() {')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float redness = smoothstep(0.32, 0.5, c.r - max(c.g, c.b));
          // Repère de la tête d'origine : visage vers +X, y de -0,49 (cou) à +0,49 (sommet du casque).
          bool glasses = vRawPos.x > 0.2 && vRawPos.y < 0.15;
          bool neckZone = vRawPos.y < -0.12;
          if (glasses || neckZone) redness = 0.0;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(c, uTeam * clamp(lum / 0.2, 0.0, 1.6), redness);
          // Le cou est teinté de rouge dans la texture (reflet du col) : il prend la couleur de la peau du visage.
          float neck = smoothstep(0.0, -0.12, vRawPos.y) * smoothstep(0.12, 0.3, c.r - max(c.g, c.b)) * (1.0 - redness);
          vec3 skinTone = vec3(0.62, 0.33, 0.25);
          diffuseColor.rgb = mix(diffuseColor.rgb, skinTone * clamp(0.55 + lum * 1.4, 0.6, 1.15), neck);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'team-head';
  return material;
}
/** Tête modélisée : largeur (casque compris), hauteur des yeux et pointe du nez dans son repère d'origine ; réglages de pose. */
const HEAD_MODEL_WIDTH = 0.68;
const HEAD_MODEL_EYES = 0.02;
const HEAD_MODEL_NOSE = 0.448;
const HEAD_MODEL_FIT = { margin: 0.03, lift: 0, front: 0.012 };
/** Part du redressement du cou par rapport au dos : 0 le prolonge, 1 le rend vertical. */
const NECK_RISE = 0.12;

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

/** Tourne `bone` de `angle` autour de `axis` (repère du monde), sans toucher à la position de son origine. */
function turn(bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  bone.updateWorldMatrix(true, false);
  const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
  const world = new THREE.Quaternion().setFromAxisAngle(axis, angle).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(parent.invert().multiply(world));
  bone.updateWorldMatrix(false, true);
}

/** Fermeture des doigts sur la cocotte : première et seconde phalange (rad). */
const FINGER_CURL = [0.61, 0.87] as const;
/** Tour de l'avant-bras et de la main pour poser la paume vers le bas (rad). */
const PRONATION = Math.PI / 2;

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
  /** Liserés du col, des manches et de la taille. */
  accent: THREE.Material;
  helmet: THREE.Material;
  /** Motif du maillot et couleur des manches ; absent, le maillot est uni. */
  livery?: Livery;
  /** Tout en une seule matière, comme une statue. */
  mono: boolean;
}

const CLOTH_UNIFORMS = ['uJersey', 'uShorts', 'uGloves', 'uShoes', 'uSocks', 'uAccent', 'uSecond', 'uSleeveL', 'uSleeveR'] as const;

/** Les trois poches dorsales du maillot : centres espacés de 10,5 cm, 9,4 cm de large, 14 cm de haut, au bas du dos. */
const POCKET_SDF = `
float pocketsSdf(vec3 r) {
  float d = 1.0;
  for (int i = 0; i < 3; i++) {
    float cx = (float(i) - 1.0) * 0.105;
    d = min(d, max(abs(r.x - cx) - 0.047, abs(r.y - 1.145) - 0.07));
  }
  return d;
}`;

/**
 * Matière de la peau, où le maillot, le cuissard, les gants, les chaussettes et les chaussures sont peints
 * par pixel d'après la hauteur au repos : un bord reste net, et suit le corps quand il bouge.
 */
function dressSkin(source: THREE.MeshStandardMaterial, outfit: Outfit): THREE.MeshStandardMaterial {
  const skin = source.clone();
  // Les muscles du dessin de la peau s'adoucissent : un coureur est plus sec qu'un haltérophile.
  skin.normalScale = new THREE.Vector2(0.55, 0.55);
  // Un teint hâlé de coureur qui roule dehors : plus foncé, un peu plus chaud.
  skin.color.multiply(new THREE.Color(0.62, 0.42, 0.3));
  const colorOf = (m: THREE.Material): THREE.Color => ((m as THREE.MeshStandardMaterial).color ?? new THREE.Color(0x888888)).clone();
  const colors: Record<(typeof CLOTH_UNIFORMS)[number], THREE.Color> = {
    uJersey: colorOf(outfit.jersey),
    uShorts: colorOf(outfit.shorts),
    uGloves: new THREE.Color(0x131417),
    uShoes: new THREE.Color(0xeeeeea),
    uSocks: new THREE.Color(0xf4f4f1),
    uAccent: colorOf(outfit.accent),
    uSecond: new THREE.Color(outfit.livery?.second ?? 0),
    uSleeveL: outfit.livery?.sleeveL != null ? new THREE.Color(outfit.livery.sleeveL) : colorOf(outfit.jersey),
    uSleeveR: outfit.livery?.sleeveR != null ? new THREE.Color(outfit.livery.sleeveR) : colorOf(outfit.jersey),
  };
  const style = Math.max(0, KIT_STYLES.indexOf(outfit.livery?.style ?? 'plain'));
  skin.onBeforeCompile = (shader) => {
    for (const name of CLOTH_UNIFORMS) shader.uniforms[name] = { value: colors[name] };
    shader.uniforms.uStyle = { value: style };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aRest;\nvarying vec3 vRest;${POCKET_SDF}`)
      // Les poches du dos sont en léger relief : la peau se gonfle de 7 mm, bords arrondis.
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRest = aRest;
        float pocketBack = 1.0 - smoothstep(-0.07, -0.04, aRest.z);
        transformed += normalize(objectNormal) * 0.007 * (1.0 - smoothstep(-0.014, 0.0, pocketsSdf(aRest))) * pocketBack;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vRest;\nuniform vec3 uJersey;\nuniform vec3 uShorts;\nuniform vec3 uGloves;\nuniform vec3 uShoes;\nuniform vec3 uSocks;\nuniform vec3 uAccent;\nuniform vec3 uSecond;\nuniform vec3 uSleeveL;\nuniform vec3 uSleeveR;\nuniform float uStyle;${POCKET_SDF}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float w = 0.004;
        float ax = abs(vRest.x);
        float y = vRest.y;
        float shorts = smoothstep(0.66 - w, 0.66 + w, y) * (1.0 - smoothstep(1.03 - w, 1.03 + w, y));
        float collar = 1.5 + 0.04 * smoothstep(0.05, 0.11, ax);
        float torso = smoothstep(1.03 - w, 1.03 + w, y) * (1.0 - smoothstep(collar - w, collar + w, y));
        float armT = (ax - 0.24) * 0.28 + (1.4175 - y) * 0.96;
        float sleeve = 1.0 - smoothstep(0.15 - w, 0.15 + w, armT);
        float jersey = torso * mix(1.0, sleeve, smoothstep(0.23 - w, 0.23 + w, ax));
        float gloves = smoothstep(0.45 - w, 0.45 + w, ax) * step(0.7, y);
        float shoes = 1.0 - smoothstep(0.115 - w, 0.115 + w, y);
        float socks = (1.0 - smoothstep(0.3 - w, 0.3 + w, y)) * (1.0 - shoes);
        diffuseColor.rgb = mix(diffuseColor.rgb, uShorts, shorts);
        // Détails du maillot : liserés au col, aux manches et à la taille, fermeture, panneaux latéraux, poches dorsales.
        float back = 1.0 - smoothstep(-0.07, -0.04, vRest.z);
        float front = smoothstep(0.04, 0.07, vRest.z);
        float armZone = smoothstep(0.23 - w, 0.23 + w, ax);
        float trim = smoothstep(collar - 0.03 - w, collar - 0.03 + w, y)
          + smoothstep(1.03 - w, 1.03 + w, y) * (1.0 - smoothstep(1.07 - w, 1.07 + w, y))
          + smoothstep(0.125 - w, 0.125 + w, armT) * armZone;
        trim = clamp(trim, 0.0, 1.0) * jersey;
        float sd = pocketsSdf(vRest);
        float pocket = (1.0 - smoothstep(-0.0015, 0.0015, sd)) * back * jersey;
        float stitch = (1.0 - smoothstep(0.0008, 0.0022, abs(sd + 0.004))) * back * jersey;
        float lip = pocket * smoothstep(1.185 - w, 1.185 + w, y);
        float zip = (1.0 - smoothstep(0.0025, 0.0045, ax)) * front * jersey;
        vec3 jerseyCol = uJersey;
        // Motif de la seconde couleur sur le torse (rel : 0 à la taille, 1 au col), puis manches.
        float rel = clamp((y - 1.03) / (collar - 1.03), 0.0, 1.0);
        float sx = vRest.x;
        float panel = 0.0;
        if (uStyle < 0.5) panel = 0.0;
        else if (uStyle < 1.5) panel = smoothstep(0.38, 0.41, rel) * (1.0 - smoothstep(0.62, 0.65, rel));
        else if (uStyle < 2.5) panel = 1.0 - smoothstep(0.2, 0.23, rel);
        else if (uStyle < 3.5) panel = 1.0 - smoothstep(0.38, 0.41, rel);
        else if (uStyle < 4.5) panel = 1.0 - smoothstep(0.05, 0.9, rel);
        else if (uStyle < 5.5) {
          float v = rel - 0.55 - 1.6 * sx;
          panel = max(1.0 - smoothstep(0.09, 0.11, abs(v)), 1.0 - smoothstep(0.025, 0.04, abs(v - 0.3)));
        }
        else if (uStyle < 6.5) panel = smoothstep(0.02, 0.06, -sx) * smoothstep(0.6, 0.65, rel);
        else if (uStyle < 7.5) panel = smoothstep(0.11, 0.115, ax);
        else if (uStyle < 8.5) panel = smoothstep(-0.18, 0.18, sx);
        else panel = max(1.0 - smoothstep(0.03, 0.036, ax), smoothstep(0.07, 0.074, ax) * (1.0 - smoothstep(0.098, 0.102, ax)));
        jerseyCol = mix(jerseyCol, uSecond, panel * (1.0 - armZone));
        jerseyCol = mix(jerseyCol, sx > 0.0 ? uSleeveL : uSleeveR, armZone);
        jerseyCol *= 1.0 - 0.1 * smoothstep(0.11, 0.17, ax) * (1.0 - armZone);
        float weave = fract(sin(dot(floor(vRest.xy * 200.0 + vRest.z * 150.0), vec2(12.9898, 78.233))) * 43758.5453);
        jerseyCol *= 0.985 + 0.03 * weave;
        jerseyCol = mix(jerseyCol, jerseyCol * 0.8, pocket);
        jerseyCol = mix(jerseyCol, uAccent, max(trim, lip));
        jerseyCol = mix(jerseyCol, jerseyCol * 0.5, stitch);
        jerseyCol = mix(jerseyCol, vec3(0.04), zip);
        diffuseColor.rgb = mix(diffuseColor.rgb, jerseyCol, jersey);
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

/** Réglage du casque modélisé sur la tête : marge de largeur, hauteur au-dessus du crâne, décalage vers l'avant, inclinaison. */
/** Réglage des lunettes sur la tête : marge de largeur, hauteur par rapport aux yeux, avance de l'écran par rapport au bout du nez. */
const GLASSES_FIT = { margin: 0.012, lift: -0.028, front: 0.004 };

/** Une sphère déformée en nez : du haut (collé au visage) vers la pointe, la largeur et l'avance grandissent. */
function noseGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 24, 16);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = (1 - y) / 2;
    const grow = t * t * (3 - 2 * t);
    const width = FACE.noseTopWidth + (FACE.noseBaseWidth - FACE.noseTopWidth) * grow;
    const depth = FACE.noseTopDepth + (FACE.noseBaseDepth - FACE.noseTopDepth) * grow;
    // Une section qui reste large jusqu'au bout (au lieu de s'effiler comme une sphère) : la pointe est ronde, pas pointue.
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const blunt = r > 1e-6 ? Math.pow(r, 0.55) / r : 0;
    p.setXYZ(i, p.getX(i) * blunt * width, y * FACE.noseHeight, p.getZ(i) * blunt * depth);
  }
  g.computeVertexNormals();
  return g;
}

/** Part du chemin que fait la clavicule vers la main (0 : épaule fixe, 1 : elle la vise). */
const SHOULDER_FOLLOW = 0.3;

const HELMET_FIT = { margin: 0.04, lift: 0.012, forward: 0.012, pitch: -0.12 };

/**
 * Nez et bouche : distance sous les yeux, taille (demi-axes) et avance par rapport à la peau. Le nez est un seul
 * volume lisse, étroit et plat en haut, qui s'élargit et s'avance en descendant jusqu'à la pointe.
 */
const FACE = {
  noseDrop: 0.036, noseOut: 0.0, noseHeight: 0.022, noseTopWidth: 0.0036, noseBaseWidth: 0.0092, noseTopDepth: 0.0022, noseBaseDepth: 0.011,
  mouthDrop: 0.09, mouthWidth: 0.02, mouthHeight: 0.0035, mouthDepth: 0.004, mouthOut: 0.0,
};

function modelledHelmetMaterial(accent: THREE.Material): THREE.Material {
  const color = ((accent as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xdddddd)).clone();
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.36, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
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
  // Hauteur de l'os de l'avant-pied au-dessus de la semelle : le personnage au repos a les pieds au sol.
  const ballHeight = worldPos(bone('ball_l')).y;

  // Tenue : maillot, cuissard, gants, chaussettes et chaussures sont peints sur la peau, par zones de hauteur.
  rig.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh && o.name === 'SuperHero_Male') {
      const skin = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
      o.material = outfit.mono ? outfit.jersey : dressSkin(skin, outfit);
    }
    if (o instanceof THREE.SkinnedMesh && o.name === 'Shoes' && outfit.mono) o.material = outfit.jersey;
  });

  // Casque ajusté sur le crâne, avec sa sangle. Tout se pose dans le repère d'origine du personnage, puis
  // se rattache à l'os de la tête : ils le suivent quand il s'incline.
  const headBone = bone('Head');
  const skull = riderHead();
  const dark = outfit.mono ? outfit.jersey : pbr({ color: 0x16181c, roughness: 0.5 });
  const fitted = new THREE.Group();
  fitted.matrixAutoUpdate = false;
  fitted.matrix.copy(skull.restInverse);
  headBone.add(fitted);
  const modelled = riderHelmetGeometry();
  const newHead = riderHeadModel();
  if (newHead) {
    // Tête modélisée avec son casque et ses lunettes : elle regarde vers +X, le mannequin vers +Z.
    const scale = (skull.width + HEAD_MODEL_FIT.margin) / HEAD_MODEL_WIDTH;
    const material = outfit.mono ? outfit.jersey : teamHeadMaterial(newHead.map, (outfit.helmet as THREE.MeshStandardMaterial).color);
    const head3d = new THREE.Mesh(newHead.geometry, material);
    head3d.scale.setScalar(scale);
    head3d.rotation.y = -Math.PI / 2;
    head3d.position.set(skull.centre.x, skull.eyes.y + HEAD_MODEL_FIT.lift - HEAD_MODEL_EYES * scale, skull.centre.z + skull.size.z / 2 + HEAD_MODEL_FIT.front - HEAD_MODEL_NOSE * scale);
    fitted.add(head3d);
  } else if (modelled) {
    // Casque modélisé : mis à la largeur de la tête, posé sur le crâne, bordure au niveau du front.
    const box = new THREE.Box3().setFromBufferAttribute(modelled.getAttribute('position') as THREE.BufferAttribute);
    const scale = (skull.width + HELMET_FIT.margin) / (box.max.x - box.min.x);
    const shell = new THREE.Mesh(modelled, outfit.mono ? outfit.jersey : modelledHelmetMaterial(outfit.helmet));
    shell.scale.setScalar(scale);
    shell.rotation.set(HELMET_FIT.pitch, 0, 0);
    shell.position.set(skull.centre.x, skull.top + HELMET_FIT.lift - box.max.y * scale, skull.centre.z + HELMET_FIT.forward);
    fitted.add(shell);
    // Doublure sombre : par les aérations, on voit de la mousse et non le crâne.
    const lining = new THREE.Mesh(modelled, outfit.mono ? outfit.jersey : pbr({ color: 0x15161a, roughness: 0.8, side: THREE.DoubleSide }));
    lining.scale.setScalar(scale * 0.95);
    lining.rotation.copy(shell.rotation);
    lining.position.set(shell.position.x, skull.top + HELMET_FIT.lift - 0.006 - box.max.y * scale * 0.95, shell.position.z);
    fitted.add(lining);
  } else {
    fitted.add(new THREE.Mesh(skull.shell, outfit.mono ? outfit.jersey : helmetMaterial(outfit.helmet, skull)));
  }
  for (const side of newHead ? [] : [-1, 1]) {
    const strap = new THREE.Mesh(turned([0.0045, 0.0045], 6), dark);
    place(strap, new THREE.Vector3(skull.temple.x * side, skull.temple.y, skull.temple.z), new THREE.Vector3(skull.chin.x * side, skull.chin.y, skull.chin.z));
    fitted.add(strap);
  }
  // Visage : un nez et une bouche posés sur l'avant du visage lisse.
  const skinColor = ((rig.getObjectByName('SuperHero_Male') as THREE.SkinnedMesh | undefined)?.material as THREE.MeshStandardMaterial | undefined)?.color;
  const noseY = skull.eyes.y - FACE.noseDrop;
  const nose = new THREE.Mesh(noseGeometry(), outfit.mono ? outfit.jersey : pbr({ color: skinColor ?? 0xc99a82, roughness: 0.62 }));
  nose.position.set(skull.centre.x, noseY, skull.faceZ(noseY) + FACE.noseOut);
  const mouthY = skull.eyes.y - FACE.mouthDrop;
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), outfit.mono ? outfit.jersey : pbr({ color: 0x8a4a46, roughness: 0.5 }));
  mouth.scale.set(FACE.mouthWidth, FACE.mouthHeight, FACE.mouthDepth);
  mouth.position.set(skull.centre.x, mouthY, skull.faceZ(mouthY) + FACE.mouthOut);
  if (!newHead) fitted.add(nose, mouth);

  // Lunettes de sport : à la largeur de la tête, le milieu de l'écran à hauteur des yeux, l'avant de l'écran
  // juste devant le front.
  const sunglasses = newHead ? null : riderGlasses();
  if (sunglasses) {
    const box = new THREE.Box3().setFromBufferAttribute(sunglasses.geometry.getAttribute('position') as THREE.BufferAttribute);
    const scale = (skull.width + GLASSES_FIT.margin) / (box.max.x - box.min.x);
    const material = outfit.mono
      ? outfit.jersey
      : new THREE.MeshStandardMaterial({ map: sunglasses.map, color: 0xffffff, roughness: 0.18, metalness: 0.35, side: THREE.DoubleSide });
    const frame = new THREE.Mesh(sunglasses.geometry, material);
    frame.scale.setScalar(scale);
    // Le modèle regarde vers -Z : un demi-tour, pour que l'écran soit devant et les branches derrière.
    frame.rotation.y = Math.PI;
    frame.position.set(
      skull.centre.x,
      skull.eyes.y + GLASSES_FIT.lift - ((box.min.y + box.max.y) / 2) * scale,
      skull.centre.z + skull.size.z / 2 + GLASSES_FIT.front + box.min.z * scale,
    );
    fitted.add(frame);
  }

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
  // Le pied au repos : sa longueur (cheville - avant-pied) et son inclinaison, pour poser la semelle à plat.
  const footLen = length('foot_l', 'ball_l');
  const handLen = length('hand_l', 'middle_01_l');
  const footRest = worldPos(bone('foot_l')).sub(worldPos(bone('ball_l')));
  const footTilt = Math.atan2(footRest.y, Math.hypot(footRest.x, footRest.z));

  // Buste : une droite du bassin au cou, penchée comme le cycliste de la fiche du vélo.
  const pelvis = worldPos(bone('pelvis'));
  const lean = at(fit.neck[0], fit.neck[1], 0).sub(at(fit.hip[0], fit.hip[1], 0)).normalize().lerp(new THREE.Vector3(0, 1, 0), TORSO_RISE).normalize();
  const rest = TORSO_BONES.map((name) => worldPos(bone(name)));
  const up = new THREE.Vector3(0, 1, 0);
  const sideways = new THREE.Vector3(1, 0, 0);
  // Le dos s'arrondit en bas : le bassin et le bas des reins penchent plus que le buste, le haut du dos reprend l'écart.
  let spine = pelvis.clone();
  for (let i = 0; i < TORSO_BONES.length - 1; i++) {
    // La tête se redresse un peu par rapport au buste, pour regarder devant.
    const last = i === TORSO_BONES.length - 2;
    const dir = last ? lean.clone().lerp(up, NECK_RISE).normalize() : lean.clone().applyAxisAngle(sideways, -LUMBAR_TILT[i]);
    const next = spine.clone().addScaledVector(dir, rest[i + 1].distanceTo(rest[i]));
    aim(bone(TORSO_BONES[i]), bone(TORSO_BONES[i + 1]), next);
    spine = worldPos(bone(TORSO_BONES[i + 1]));
  }
  // La tête regarde la route : on la redresse par rapport à l'horizontale.
  const head = bone('Head');
  const headLook = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), fit.headPitch ?? HEAD_PITCH);

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
      collar: bone(side < 0 ? 'clavicle_l' : 'clavicle_r'),
      shoulder: bone(side < 0 ? 'upperarm_l' : 'upperarm_r'),
      elbow: bone(side < 0 ? 'lowerarm_l' : 'lowerarm_r'),
      wrist: bone(side < 0 ? 'hand_l' : 'hand_r'),
      knuckle: bone(side < 0 ? 'middle_01_l' : 'middle_01_r'),
      fingers: ['index', 'middle', 'ring', 'pinky'].map((n) => [bone(`${n}_01_${side < 0 ? 'l' : 'r'}`), bone(`${n}_02_${side < 0 ? 'l' : 'r'}`)] as const),
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
      // Le pied : l'avant-pied juste au-dessus de l'axe de la pédale, la semelle à plat sur elle (la cheville est derrière
      // et plus haut, selon l'inclinaison de l'os du pied au repos).
      const ball = world(at(px + CLEAT_FORWARD, py + PEDAL_TOP + ballHeight, leg.side * PEDAL_SIDE));
      const ankle = world(at(px + CLEAT_FORWARD - footLen * Math.cos(footTilt), py + PEDAL_TOP + ballHeight + footLen * Math.sin(footTilt), leg.side * PEDAL_SIDE));
      const knee = joint(worldPos(leg.hip), ankle, thigh, shin, pole(-leg.side * KNEE_IN, 0, -1));
      aim(leg.hip, leg.knee, knee);
      aim(leg.knee, leg.ankle, ankle);
      aim(leg.ankle, leg.ball, ball);
    });

    const slope = fit.handSlope ?? 0.25;
    const roll = fit.handRoll ?? 0;
    for (const arm of limbs.arms) {
      const grip = world(at(fit.hand[0], fit.hand[1], arm.side * fit.handSide));
      const wrist = world(at(fit.hand[0] - handLen * Math.cos(slope), fit.hand[1] - handLen * Math.sin(slope), arm.side * fit.handSide));
      // L'épaule suit un peu le bras qui part vers l'avant : sans cela, le haut du bras se tord sous le deltoïde.
      const collarAt = worldPos(arm.collar);
      const rest = worldPos(arm.shoulder).sub(collarAt);
      const follow = rest.clone().normalize().lerp(wrist.clone().sub(collarAt).normalize(), SHOULDER_FOLLOW).normalize().multiplyScalar(rest.length());
      aim(arm.collar, arm.shoulder, collarAt.add(follow));
      const elbow = joint(worldPos(arm.shoulder), wrist, upper, fore, pole(arm.side * 0.12, -1, 0.1));
      aim(arm.shoulder, arm.elbow, elbow);
      // Pronation : la paume regarde vers le bas, la moitié du tour à l'avant-bras, l'autre moitié à la main.
      aim(arm.elbow, arm.wrist, wrist);
      turn(arm.elbow, worldPos(arm.wrist).sub(worldPos(arm.elbow)).normalize(), -arm.side * PRONATION * 0.5);
      aim(arm.wrist, arm.knuckle, grip);
      turn(arm.wrist, worldPos(arm.knuckle).sub(worldPos(arm.wrist)).normalize(), -arm.side * (PRONATION * 0.5 - roll));
      // Les doigts se referment sur la cocotte : chaque phalange tourne autour de l'axe latéral, vers le bas.
      const across = new THREE.Vector3(1, 0, 0).applyQuaternion(around);
      for (const [first, second] of arm.fingers) {
        turn(first, across, -FINGER_CURL[0]);
        turn(second, across, -FINGER_CURL[1]);
      }
    }

    // La tête : l'inclinaison voulue par rapport au monde, quel que soit l'angle du cou.
    const parent = head.parent!.getWorldQuaternion(new THREE.Quaternion());
    head.quaternion.copy(parent.invert().multiply(around.clone().multiply(headLook).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI, 0)))));
    head.updateWorldMatrix(false, true);
  };

  pose(0);
  return { group, pose };
}
