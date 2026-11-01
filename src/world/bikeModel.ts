// Vélo détaillé : cadre selon la silhouette du modèle, roues, transmission, poste de pilotage.

import * as THREE from 'three';
import type { BikeShape } from '../sim/bikes';
import type { FrameDesign } from '../sim/bikeDesigns';
import { toon } from './materials';
import { at, ball, link, place, type Point, profiled, turned } from './modelParts';

export const BB: Point = [0.03, 0.29];
const REAR_X = -0.49;
const FRONT_X = 0.51;
const SPOKES = 18;
const HEAD_TOP: Point = [0.44, 0.84];
const HEAD_LOW: Point = [0.47, 0.72];
const SADDLE: Point = [-0.13, 0.92];
const GEAR_SIDE = 0.045;

export interface BikeLook {
  shape: BikeShape;
  tyreM: number;
  wheelRadiusM: number;
  design?: FrameDesign;
  brand?: string;
  frame?: THREE.Material;
  /** Second ton de peinture. */
  paint?: THREE.Material;
}

/** Points du cadre, en fonction de la silhouette. */
export function frameLayout(design: FrameDesign, wheelR: number) {
  const up = (design.topTubeRearY - BB[1]) / (SADDLE[1] - BB[1]);
  const seatTop: Point = [BB[0] + (SADDLE[0] - BB[0]) * up, design.topTubeRearY];
  const stayY = seatTop[1] + (BB[1] - seatTop[1]) * design.stayDrop;
  const stayT = (stayY - BB[1]) / (seatTop[1] - BB[1]);
  const stay: Point = [BB[0] + (seatTop[0] - BB[0]) * stayT, stayY];
  return { seatTop, stay, rear: [REAR_X, wheelR] as Point, front: [FRONT_X, wheelR] as Point };
}

const DEFAULT_DESIGN: FrameDesign = { tubeDepth: 0.05, tubeWidth: 0.036, topTubeRearY: 0.8, stayDrop: 0.35, rimDepth: 0.045, stem: 'integree' };

/** Jante creuse, dessinée en coupe puis tournée autour de l'axe de la roue. */
function rimGeometry(radius: number, depth: number): THREE.BufferGeometry {
  const half = 0.012;
  const profile = [
    new THREE.Vector2(radius - depth, 0),
    new THREE.Vector2(radius - depth * 0.45, half),
    new THREE.Vector2(radius, half * 0.9),
    new THREE.Vector2(radius, -half * 0.9),
    new THREE.Vector2(radius - depth * 0.45, -half),
    new THREE.Vector2(radius - depth, 0),
  ];
  const g = new THREE.LatheGeometry(profile, 56).rotateZ(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function buildWheel(x: number, look: BikeLook, design: FrameDesign, mats: Mats, disc: boolean): THREE.Group {
  const radius = look.wheelRadiusM;
  const wheel = new THREE.Group();
  wheel.name = 'roue';
  wheel.position.copy(at(x, radius));
  const centre = radius - look.tyreM;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(centre, look.tyreM, 10, 56).rotateY(Math.PI / 2), mats.rubber));
  const rimOuter = centre - look.tyreM * 0.6;
  wheel.add(new THREE.Mesh(rimGeometry(rimOuter, design.rimDepth), mats.carbon));
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 12).rotateZ(Math.PI / 2), mats.metal));
  if (disc) {
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(rimOuter - 0.01, rimOuter - 0.01, 0.024, 40).rotateZ(Math.PI / 2), mats.carbon));
  } else {
    const inner = rimOuter - design.rimDepth;
    for (let i = 0; i < SPOKES; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, inner, 4).translate(0, inner / 2, 0), mats.metal);
      spoke.rotation.x = (i / SPOKES) * Math.PI * 2;
      spoke.position.x = i % 2 ? 0.012 : -0.012;
      wheel.add(spoke);
    }
  }
  // Disque de frein, côté gauche comme sur tous les vélos.
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.003, 24).rotateZ(Math.PI / 2), mats.metal);
  rotor.position.x = -0.05;
  wheel.add(rotor);
  return wheel;
}

interface Mats {
  frame: THREE.Material;
  paint: THREE.Material;
  carbon: THREE.Material;
  rubber: THREE.Material;
  metal: THREE.Material;
  bottle: THREE.Material;
}

function dropBar(side: number, reach: number, mats: Mats): THREE.Object3D {
  const path = new THREE.CatmullRomCurve3([
    at(0.5, 1.0, 0),
    at(0.5, 1.0, side * 0.2),
    at(0.5 + reach, 0.985, side * 0.21),
    at(0.5 + reach + 0.05, 0.92, side * 0.21),
    at(0.5 + reach - 0.02, 0.865, side * 0.21),
    at(0.5 + reach - 0.09, 0.87, side * 0.21),
  ]);
  const bar = new THREE.Group();
  bar.add(new THREE.Mesh(new THREE.TubeGeometry(path, 24, 0.0115, 7), mats.carbon));
  const hood = ball(1, mats.carbon);
  hood.scale.set(0.017, 0.026, 0.038);
  hood.position.copy(at(0.5 + reach + 0.03, 1.0, side * 0.21));
  bar.add(hood);
  return bar;
}

/** Nom de la marque peint sur le tube diagonal, des deux côtés. */
function brandDecals(brand: string, a: Point, b: Point, width: number): THREE.Mesh[] {
  if (typeof document === 'undefined') return [];
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d')!;
  g.font = 'italic 800 74px Bahnschrift, "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 6;
  const text = brand.toUpperCase();
  const fit = Math.min(1, 480 / g.measureText(text).width);
  g.setTransform(fit, 0, 0, 1, 256, 48);
  g.strokeText(text, 0, 0);
  g.fillText(text, 0, 0);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const from = at(a[0], a[1]);
  const to = at(b[0], b[1]);
  const length = from.distanceTo(to) * 0.62;
  return [-1, 1].map((side) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(length, length * 0.19), material);
    const normal = new THREE.Vector3(side, 0, 0);
    // Le texte se lit de l'arrière vers l'avant à droite, et l'inverse à gauche.
    const x = new THREE.Vector3().subVectors(to, from).normalize().multiplyScalar(side);
    const y = new THREE.Vector3().crossVectors(normal, x);
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, normal));
    plane.position.copy(from).lerp(to, 0.5);
    plane.position.x = side * (width / 2 + 0.002);
    return plane;
  });
}

export function buildBike(look: BikeLook, base: THREE.Material, mono: boolean): { group: THREE.Group; wheels: THREE.Group[]; ring: THREE.Mesh } {
  const group = new THREE.Group();
  const design = look.design ?? DEFAULT_DESIGN;
  const frame = look.frame ?? base;
  const shade = (color: number) => (mono ? base : toon({ color }));
  const mats: Mats = {
    frame,
    paint: look.paint ?? frame,
    carbon: shade(0x1b1d21),
    rubber: shade(0x111214),
    metal: shade(0xa9adb2),
    bottle: shade(0xe9e6df),
  };
  const wheelR = look.wheelRadiusM;
  const tt = look.shape === 'clm';
  const flatBar = look.shape === 'vtt' || look.shape === 'ville';
  const { seatTop, stay, rear, front } = frameLayout(design, wheelR);
  const { tubeDepth: depth, tubeWidth: width } = design;
  const rearMat = design.twoTone === 'arriere' ? mats.paint : frame;
  const frontMat = design.twoTone === 'avant' ? mats.paint : frame;

  const wheels = [buildWheel(REAR_X, look, design, mats, tt), buildWheel(FRONT_X, look, design, mats, false)];
  group.add(...wheels);

  // Triangle avant
  if (design.splitSeatTube) {
    const split: Point = [BB[0] + (seatTop[0] - BB[0]) * 0.72, BB[1] + (seatTop[1] - BB[1]) * 0.72];
    group.add(profiled(BB, split, width, depth * 0.9, rearMat));
    for (const side of [-1, 1]) group.add(profiled(split, seatTop, width * 0.4, depth * 0.45, rearMat, side * 0.012));
  } else {
    group.add(profiled(BB, seatTop, width, depth * 0.8, rearMat));
  }
  group.add(
    profiled(BB, HEAD_LOW, width * 1.15, depth, frame),
    profiled(seatTop, HEAD_TOP, width * 0.95, depth * 0.75, frame),
    profiled(HEAD_TOP, HEAD_LOW, 0.05, Math.max(0.07, depth), frontMat),
  );
  const shell = ball(1, frame);
  shell.scale.set(0.045, 0.05, 0.055);
  shell.position.copy(at(BB[0], BB[1]));
  group.add(shell);

  // Bases et haubans, de part et d'autre de la roue arrière
  for (const side of [-1, 1]) {
    group.add(
      profiled(rear, BB, 0.018, 0.026, rearMat, side * 0.05),
      profiled(rear, stay, 0.013, 0.02, rearMat, side * 0.044),
      profiled(HEAD_LOW, front, 0.024, look.shape === 'vtt' ? 0.05 : Math.max(0.03, depth * 0.55), look.shape === 'vtt' ? mats.carbon : frontMat, side * 0.05),
    );
  }

  // Tige et selle
  group.add(profiled(seatTop, [SADDLE[0], SADDLE[1] - 0.006], width * 0.8, depth * 0.55, mats.carbon));
  const saddle = ball(1, mats.carbon);
  saddle.scale.set(0.058, 0.021, 0.135);
  saddle.position.copy(at(SADDLE[0] - 0.01, SADDLE[1] + 0.015));
  group.add(saddle);

  // Poste de pilotage
  const barFront: Point = [0.5, flatBar ? 1.02 : 1.0];
  if (design.stem === 'v') {
    // Potence en V : deux branches qui partent du pivot, signature du Cervélo S5.
    for (const side of [-1, 1]) group.add(profiled(HEAD_TOP, barFront, 0.016, 0.03, mats.carbon, side * 0.024));
  } else {
    group.add(profiled(HEAD_TOP, barFront, 0.03, design.stem === 'integree' ? 0.045 : 0.03, mats.carbon));
  }
  if (flatBar) {
    const bar = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.7, 3, 8).rotateZ(Math.PI / 2), mats.carbon);
    bar.position.copy(at(barFront[0], barFront[1] + 0.01));
    group.add(bar);
  } else {
    group.add(dropBar(-1, tt ? 0.02 : 0.08, mats), dropBar(1, tt ? 0.02 : 0.08, mats));
  }
  if (tt) {
    for (const side of [-1, 1]) {
      group.add(link([0.46, 0.99], [0.84, 1.05], 0.011, mats.carbon, side * 0.06));
      const pad = ball(1, mats.carbon);
      pad.scale.set(0.045, 0.012, 0.075);
      pad.position.copy(at(0.47, 1.0, side * 0.07));
      group.add(pad);
    }
  }

  // Transmission, côté droit
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.007, 36).rotateZ(Math.PI / 2), mats.carbon);
  ring.position.copy(at(BB[0], BB[1], GEAR_SIDE));
  group.add(ring);
  const cassette = new THREE.Mesh(turned([0.052, 0.058, 0.066, 0.074, 0.085], 20).rotateZ(Math.PI / 2).scale(0.05, 1, 1).translate(GEAR_SIDE + 0.02, 0, 0), mats.metal);
  cassette.position.copy(at(REAR_X, wheelR));
  group.add(cassette);
  const pulley = at(REAR_X + 0.02, wheelR - 0.2, GEAR_SIDE);
  const hanger = new THREE.Mesh(turned([0.012, 0.009], 8), mats.carbon);
  place(hanger, at(REAR_X, wheelR - 0.04, GEAR_SIDE), pulley);
  group.add(hanger);
  const cage = ball(1, mats.carbon);
  cage.scale.set(0.008, 0.024, 0.022);
  cage.position.copy(pulley);
  group.add(cage);
  const chainTop = new THREE.Mesh(turned([0.0045, 0.0045], 6), mats.metal);
  place(chainTop, at(BB[0], BB[1] + 0.1, GEAR_SIDE), at(REAR_X, wheelR + 0.07, GEAR_SIDE));
  const chainLow = new THREE.Mesh(turned([0.0045, 0.0045], 6), mats.metal);
  place(chainLow, at(BB[0], BB[1] - 0.1, GEAR_SIDE), pulley);
  group.add(chainTop, chainLow);

  // Bidon sur le tube diagonal, sauf en contre-la-montre
  if (!tt) {
    const t = 0.32;
    const u = 0.68;
    const offset = depth / 2 + 0.04;
    const lift = (p: Point): Point => [p[0] - 0.55 * offset, p[1] + 0.84 * offset];
    const bottle = new THREE.Mesh(turned([0.034, 0.036, 0.036, 0.036, 0.03, 0.012], 14), mats.bottle);
    const a = lift([BB[0] + (HEAD_LOW[0] - BB[0]) * t, BB[1] + (HEAD_LOW[1] - BB[1]) * t]);
    const b = lift([BB[0] + (HEAD_LOW[0] - BB[0]) * u, BB[1] + (HEAD_LOW[1] - BB[1]) * u]);
    place(bottle, at(a[0], a[1]), at(b[0], b[1]));
    group.add(bottle);
  }

  if (look.brand && !mono) group.add(...brandDecals(look.brand, BB, HEAD_LOW, width * 1.15));
  return { group, wheels, ring };
}
