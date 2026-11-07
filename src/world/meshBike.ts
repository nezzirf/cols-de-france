// Vélos modélisés d'un seul maillage, sans cycliste (Cannondale d'EF, Specialized SL9). Chaque fichier est dans un cube
// d'un mètre, regarde vers -Z comme le jeu, et a son côté transmission à +X. Le jeu y découpe les deux roues (rayons et
// moyeu) pour les faire tourner, retire la manivelle d'origine et redessine manivelles et pédales pour qu'elles suivent les
// jambes ; le cycliste du jeu s'assied sur la selle et pose les mains sur les cocottes.

import * as THREE from 'three';
import type { AssetBike, RiderFit } from './bikeFromAsset';
import { pbr } from './materials';
import { at, type Point } from './modelParts';

export interface MeshBikeSpec {
  id: string;
  url: string;
  /** Rayon du pneu, hauteur des moyeux, position (z) des moyeux, sol : dans le repère du modèle. */
  tyreR: number;
  hubY: number;
  frontHubZ: number;
  rearHubZ: number;
  groundY: number;
  /** Axe du pédalier (z, y). */
  bbZ: number;
  bbY: number;
  /** Selle (centre, sommet) et cocottes (haut), pour poser le cycliste. */
  saddle: { z: number; top: number };
  hood: { z: number; y: number; side: number };
  /** Le fichier a posé une ombre à plat sous chaque roue : on retire ce qui est collé au sol. */
  dropShadows?: boolean;
}

const CRANK = 0.172;
/** Position du pédalier dans le repère du jeu : celle des autres vélos. */
const BB_FORWARD = 0.03;
/** Seuls les rayons et le moyeu tournent (jusqu'au bord intérieur de la jante) : pneu et jante, de révolution, restent en place. */
const SPIN_SHARE = 0.85;
const WHEEL_HALF = 0.019;
const HUB_HALF = 0.026;
const HUB_ZONE = 0.07;
/** Manivelles et pédales : à plus de 5,5 cm de l'axe du vélo, près du pédalier. */
const CRANK_MIN_X = 0.055;
const CRANK_RADIUS = 0.13;

const frontName = (spec: MeshBikeSpec): string => `${spec.id}_front_wheel`;
const rearName = (spec: MeshBikeSpec): string => `${spec.id}_rear_wheel`;

/** Prépare le fichier chargé : sépare les deux roues du reste du maillage et en retire les manivelles. */
export function splitMeshBike(spec: MeshBikeSpec): (scene: THREE.Object3D) => void {
  const spin = spec.tyreR * SPIN_SHARE;
  const inWheel = (x: number, y: number, z: number, hubZ: number): boolean => {
    const r = Math.hypot(y - spec.hubY, z - hubZ);
    if (r > spin) return false;
    return Math.abs(x) <= (r < HUB_ZONE ? HUB_HALF : WHEEL_HALF);
  };
  // La manivelle droite du fichier part vers l'avant, dans le plan de la chaîne (x > 3 cm) : elle se distingue du plateau
  // (rayon de 6 cm) et de la chaîne (qui part vers l'arrière) par sa place devant le pédalier.
  const isCrank = (x: number, y: number, z: number): boolean => {
    const r = Math.hypot(y - spec.bbY, z - spec.bbZ);
    if (Math.abs(x) > CRANK_MIN_X && r < CRANK_RADIUS) return true;
    return x > 0.03 && r > 0.058 && r < CRANK_RADIUS && z < spec.bbZ - 0.025;
  };
  return (scene) => {
    scene.updateMatrixWorld(true);
    let source: THREE.Mesh | null = null;
    scene.traverse((o) => {
      if (!source && o instanceof THREE.Mesh) source = o;
    });
    if (!source) return;
    const mesh: THREE.Mesh = source;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    if (!index) return;
    const world = mesh.matrixWorld;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const front: number[] = [];
    const rear: number[] = [];
    const rest: number[] = [];
    const all3 = (hubZ: number): boolean => inWheel(a.x, a.y, a.z, hubZ) && inWheel(b.x, b.y, b.z, hubZ) && inWheel(c.x, c.y, c.z, hubZ);
    for (let t = 0; t < index.count; t += 3) {
      const i = index.getX(t);
      const j = index.getX(t + 1);
      const k = index.getX(t + 2);
      a.fromBufferAttribute(position, i).applyMatrix4(world);
      b.fromBufferAttribute(position, j).applyMatrix4(world);
      c.fromBufferAttribute(position, k).applyMatrix4(world);
      if (spec.dropShadows && (Math.max(a.y, b.y, c.y) < spec.groundY - 0.0007 || (Math.max(a.y, b.y, c.y) < spec.groundY + 0.006 && Math.abs(a.x + b.x + c.x) / 3 > 0.022))) continue;
      if (all3(spec.frontHubZ)) front.push(i, j, k);
      else if (all3(spec.rearHubZ)) rear.push(i, j, k);
      else if (isCrank((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3)) continue;
      else rest.push(i, j, k);
    }
    // Les trois morceaux partagent les mêmes sommets : seule la liste des triangles change (le fichier pèse déjà lourd).
    const piece = (triangles: number[]): THREE.BufferGeometry => {
      const g = new THREE.BufferGeometry();
      for (const name of Object.keys(geometry.attributes)) g.setAttribute(name, geometry.getAttribute(name));
      g.setIndex(triangles);
      return g;
    };
    mesh.geometry = piece(rest);
    for (const [name, triangles] of [
      [frontName(spec), front],
      [rearName(spec), rear],
    ] as [string, number[]][]) {
      const wheel = new THREE.Mesh(piece(triangles), mesh.material);
      wheel.name = name;
      wheel.position.copy(mesh.position);
      wheel.quaternion.copy(mesh.quaternion);
      wheel.scale.copy(mesh.scale);
      mesh.parent?.add(wheel);
    }
  };
}

export function buildMeshBike(spec: MeshBikeSpec, cloneAsset: () => THREE.Object3D, wheelRadiusM: number, material: THREE.Material | null): AssetBike {
  const group = new THREE.Group();
  const root = cloneAsset();
  const scale = wheelRadiusM / spec.tyreR;
  // Le modèle regarde déjà vers -Z : on le pose sur le sol, pédalier à sa place.
  root.scale.setScalar(scale);
  root.position.set(0, -spec.groundY * scale, -BB_FORWARD - spec.bbZ * scale);
  group.add(root);
  group.updateMatrixWorld(true);
  const onBike = (z: number, y: number): Point => [BB_FORWARD - (z - spec.bbZ) * scale, (y - spec.groundY) * scale];

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
    pivot.position.set(0, spec.hubY, z);
    root.add(pivot);
    root.updateMatrixWorld(true);
    pivot.attach(mesh);
    return pivot;
  };
  const wheels = [wheel(frontName(spec), spec.frontHubZ), wheel(rearName(spec), spec.rearHubZ)];

  const carbon = material ?? pbr({ color: 0x15171a, roughness: 0.4, metalness: 0.15 });
  const dark = material ?? pbr({ color: 0x2a2c31, roughness: 0.5, metalness: 0.5 });
  const bb = onBike(spec.bbZ, spec.bbY);

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

  const saddle = onBike(spec.saddle.z, spec.saddle.top);
  // Le bassin est calé comme sur le Van Rysel (23,5 cm derrière le pédalier, 78 cm au-dessus) : la jambe ne doit pas être
  // plus courte que la distance à la pédale basse, sinon le pied décolle.
  const hip: Point = [Math.max(saddle[0] - 0.035, bb[0] - 0.235), Math.min(saddle[1] + 0.075, bb[1] + 0.78)];
  const fit: RiderFit = {
    bb,
    crank: CRANK,
    hip,
    shoulder: [hip[0] + 0.5, hip[1] + 0.3],
    neck: [hip[0] + 0.58, hip[1] + 0.36],
    head: [hip[0] + 0.67, hip[1] + 0.44],
    hand: onBike(spec.hood.z, spec.hood.y),
    handSide: spec.hood.side * scale,
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
