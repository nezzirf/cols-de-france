// Vélo détaillé : cadre selon la silhouette du modèle, roues, transmission, poste de pilotage.

import * as THREE from 'three';
import type { BikeAssetId, BikeShape } from '../sim/bikes';
import type { FrameDesign } from '../sim/bikeDesigns';
import { bikeAssetReady, cloneMeshBike, meshBikeReady, rcrAssetReady, y1rsAssetReady } from './bikeAsset';
import { type AssetCoat, buildAssetBike, type RiderFit } from './bikeFromAsset';
import { buildRcrBike } from './bikeRcr';
import { buildMeshBike } from './meshBike';
import { MESH_BIKES } from './meshBikeSpecs';
import { buildY1rsBike } from './bikeY1rs';
import { buildY1rsModelBike } from './bikeY1rsModel';
import { buildChain, type Wheel } from './chain';
import { pbr } from './materials';
import { at, ball, link, place, type Point, profiled, turned } from './modelParts';

export const BB: Point = [0.03, 0.29];
/** Tours de roue pour un tour de pédalier. */
export const WHEEL_TURNS_PER_CRANK = 2.6;
const REAR_X = -0.49;
const FRONT_X = 0.51;
/** Rayons par côté. */
const SPOKES = 12;
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
  /** Seconde couleur en dégradé sur le cadre du vélo modélisé. */
  coat?: AssetCoat | null;
  /** Modèle 3D propre au vélo choisi, avec sa peinture d'origine. */
  asset?: BikeAssetId;
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
  // Moyeu : un corps et deux flasques, avec l'axe qui dépasse de chaque côté.
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 16).rotateZ(Math.PI / 2), mats.metal));
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.116, 8).rotateZ(Math.PI / 2), mats.metal));
  for (const side of [-1, 1]) {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.004, 24).rotateZ(Math.PI / 2), mats.metal);
    flange.position.x = side * 0.03;
    wheel.add(flange);
  }
  // Valve, au pied de la jante.
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0034, 0.04, 6), mats.metal);
  valve.position.set(0, rimOuter - design.rimDepth - 0.012, 0);
  wheel.add(valve);
  if (disc) {
    wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(rimOuter - 0.01, rimOuter - 0.01, 0.024, 40).rotateZ(Math.PI / 2), mats.carbon));
  } else {
    // Rayons croisés : de chaque côté, ils partent d'un flasque et rejoignent la jante en biais.
    const inner = rimOuter - design.rimDepth;
    const spokeGeo = new THREE.CylinderGeometry(0.0014, 0.0014, 1, 4).translate(0, 0.5, 0);
    const per = SPOKES;
    for (const side of [-1, 1]) {
      for (let i = 0; i < per; i++) {
        const hubAngle = (i / per) * Math.PI * 2 + (side > 0 ? Math.PI / per : 0);
        const rimAngle = hubAngle + side * (Math.PI * 2 * 2) / per;
        const a = new THREE.Vector3(side * 0.03, 0.024 * Math.cos(hubAngle), 0.024 * Math.sin(hubAngle));
        const b = new THREE.Vector3(side * 0.004, inner * Math.cos(rimAngle), inner * Math.sin(rimAngle));
        const spoke = new THREE.Mesh(spokeGeo, mats.metal);
        place(spoke, a, b);
        wheel.add(spoke);
      }
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
  tape: THREE.Material;
  dark: THREE.Material;
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
  bar.add(new THREE.Mesh(new THREE.TubeGeometry(path, 36, 0.0125, 10), mats.tape));
  // Levier de frein : une lame fine sous la cocotte.
  const lever = profiled([0.5 + reach + 0.045, 0.975], [0.5 + reach + 0.082, 0.905], 0.008, 0.016, mats.carbon, side * 0.21);
  bar.add(lever);
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

/** Selle : bec étroit vers l'avant, arrière large, léger creux au milieu. */
function saddleGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 30, 14);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    let y = p.getY(i);
    const z = p.getZ(i); // -1 : le bec, vers l'avant
    const t = Math.min(1, Math.max(0, (z + 0.95) / 1.25));
    const width = 0.3 + 0.7 * t * t * (3 - 2 * t);
    if (y > 0) y *= 1 - 0.22 * Math.exp(-((z + 0.1) ** 2) / 0.12) + 0.2 * Math.max(0, z) ** 2;
    p.setXYZ(i, x * 0.07 * width, y * 0.022 - 0.004, z * 0.135);
  }
  g.computeVertexNormals();
  return g;
}

/** Plateau denté, avec ses bras : une pièce plate qui tourne avec les manivelles. */
function chainringGroup(teeth: number, outer: number, mats: Mats): THREE.Group {
  const root = outer - 0.006;
  const step = (Math.PI * 2) / teeth;
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const base = i * step;
    const pts: [number, number][] = [
      [root, base],
      [outer, base + step * 0.25],
      [outer, base + step * 0.5],
      [root, base + step * 0.75],
    ];
    pts.forEach(([r, a], k) => {
      const px = r * Math.cos(a);
      const py = r * Math.sin(a);
      if (i === 0 && k === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    });
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, outer - 0.032, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.003, bevelEnabled: false });
  geo.translate(0, 0, -0.0015);
  geo.rotateY(Math.PI / 2);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, mats.carbon));
  const arm = new THREE.BoxGeometry(0.004, 0.036, 0.012).translate(0, outer - 0.03, 0);
  for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(arm, mats.carbon);
    m.rotation.x = (k / 5) * Math.PI * 2;
    group.add(m);
  }
  return group;
}

export function buildBike(look: BikeLook, base: THREE.Material, mono: boolean): { group: THREE.Group; wheels: THREE.Group[]; drive(crankAngle: number): void; fit?: RiderFit } {
  if (look.asset === 'rcr' && look.shape === 'route' && rcrAssetReady()) {
    const bike = buildRcrBike(look.wheelRadiusM, mono ? base : null);
    return { group: bike.group, wheels: [], drive: (crank) => bike.drive(crank, crank * WHEEL_TURNS_PER_CRANK), fit: bike.fit };
  }
  // Vélos modélisés d'un seul maillage (Cannondale d'EF, Specialized SL9, Pinarello Dogma) quand leur fichier est chargé.
  if (look.asset && look.asset in MESH_BIKES && (look.shape === 'route' || look.shape === 'clm') && meshBikeReady(look.asset)) {
    const id = look.asset as keyof typeof MESH_BIKES;
    const bike = buildMeshBike(MESH_BIKES[id], () => cloneMeshBike(id), look.wheelRadiusM, mono ? base : null);
    return { group: bike.group, wheels: [], drive: (crank) => bike.drive(crank, crank * WHEEL_TURNS_PER_CRANK), fit: bike.fit };
  }
  // Colnago Y1Rs : le modèle 3D quand son fichier est chargé, sinon le vélo dessiné en code d'après ses photos.
  if (look.asset === 'y1rs' && look.shape === 'route' && y1rsAssetReady()) {
    const bike = buildY1rsModelBike(look.wheelRadiusM, mono ? base : null);
    return { group: bike.group, wheels: [], drive: (crank) => bike.drive(crank, crank * WHEEL_TURNS_PER_CRANK), fit: bike.fit };
  }
  if (look.asset === 'y1rs' && look.shape === 'route') {
    const bike = buildY1rsBike(look.wheelRadiusM, look.tyreM, mono ? base : null);
    return { group: bike.group, wheels: [], drive: (crank) => bike.drive(crank, crank * WHEEL_TURNS_PER_CRANK), fit: bike.fit };
  }
  // Vélo de route : le modèle fait par un artiste, quand son fichier est chargé.
  if (look.shape === 'route' && bikeAssetReady()) {
    const paintColor = ((look.frame ?? base) as THREE.MeshStandardMaterial).color ?? new THREE.Color(0xc41d16);
    const bike = buildAssetBike(look.wheelRadiusM, mono ? base : null, paintColor, look.coat ?? null);
    return { group: bike.group, wheels: [], drive: (crank) => bike.drive(crank, crank * WHEEL_TURNS_PER_CRANK), fit: bike.fit };
  }
  const group = new THREE.Group();
  const design = look.design ?? DEFAULT_DESIGN;
  const frame = look.frame ?? base;
  const shade = (color: number, roughness: number, metalness = 0) => (mono ? base : pbr({ color, roughness, metalness }));
  const mats: Mats = {
    frame,
    paint: look.paint ?? frame,
    carbon: shade(0x1b1d21, 0.38, 0.1),
    rubber: shade(0x141517, 0.95),
    metal: shade(0xb4b8bd, 0.32, 0.9),
    bottle: shade(0xe9e6df, 0.55),
    tape: shade(0x1c1d20, 0.97),
    dark: shade(0x2a2c31, 0.5, 0.55),
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
  const saddle = new THREE.Mesh(saddleGeometry(), mats.tape);
  saddle.position.copy(at(SADDLE[0] - 0.01, SADDLE[1] + 0.015));
  group.add(saddle);
  // Rails sous la selle.
  for (const side of [-1, 1]) group.add(link([SADDLE[0] - 0.1, SADDLE[1] + 0.002], [SADDLE[0] + 0.1, SADDLE[1] + 0.004], 0.0034, mats.metal, side * 0.028));

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

  // Transmission, côté droit : plateau, chaîne en maillons, cassette et dérailleur
  const ringRadius = 0.101;
  const ring = chainringGroup(50, ringRadius + 0.004, mats);
  ring.position.copy(at(BB[0], BB[1], GEAR_SIDE));
  group.add(ring);
  const inner = chainringGroup(34, 0.072, mats);
  inner.position.copy(at(BB[0], BB[1], GEAR_SIDE - 0.011));
  group.add(inner);
  const cassette = new THREE.Mesh(turned([0.052, 0.054, 0.049, 0.045, 0.04, 0.036, 0.032, 0.029, 0.025, 0.022], 24).rotateZ(Math.PI / 2).scale(0.058, 1, 1).translate(GEAR_SIDE - 0.005, 0, 0), mats.metal);
  cassette.position.copy(at(REAR_X, wheelR));
  group.add(cassette);

  // Dérailleur : deux galets en S, une chape et le corps accroché à la patte.
  const upper: Wheel = { c: [REAR_X + 0.006, wheelR - 0.078], r: 0.0243, dir: -1 };
  const lower: Wheel = { c: [REAR_X - 0.015, wheelR - 0.134], r: 0.0243, dir: 1 };
  const cogWheel: Wheel = { c: [REAR_X, wheelR], r: 0.0344, dir: 1 };
  const ringWheel: Wheel = { c: [BB[0], BB[1]], r: ringRadius, dir: 1 };
  for (const w of [upper, lower]) {
    const pulley = new THREE.Mesh(new THREE.CylinderGeometry(w.r - 0.002, w.r - 0.002, 0.012, 18).rotateZ(Math.PI / 2), mats.dark);
    pulley.position.copy(at(w.c[0], w.c[1], GEAR_SIDE - 0.003));
    group.add(pulley);
  }
  for (const side of [-1, 1]) {
    group.add(link(upper.c, lower.c, 0.0042, mats.dark, GEAR_SIDE - 0.003 + side * 0.0075));
  }
  const hangerPoint: Point = [REAR_X - 0.012, wheelR - 0.012];
  group.add(link(hangerPoint, upper.c, 0.008, mats.dark, GEAR_SIDE + 0.004));
  const knuckle = ball(1, mats.dark);
  knuckle.scale.set(0.012, 0.016, 0.016);
  knuckle.position.copy(at(hangerPoint[0], hangerPoint[1], GEAR_SIDE + 0.004));
  group.add(knuckle);

  const chain = buildChain([ringWheel, cogWheel, upper, lower], GEAR_SIDE - 0.002, mats.metal, mats.dark);
  group.add(chain.group);
  const drive = (crankAngle: number) => {
    // Le plateau et la chaîne tournent avec les manivelles, la chaîne d'un arc égal au plateau.
    ring.rotation.x = crankAngle;
    inner.rotation.x = crankAngle;
    chain.advance(crankAngle * ringRadius);
  };
  drive(0);

  // Étriers de frein à disque, sur le fourreau et sur la fourche.
  for (const [fx, y] of [
    [REAR_X + 0.065, wheelR + 0.05],
    [FRONT_X - 0.04, wheelR + 0.07],
  ] as Point[]) {
    const caliper = ball(1, mats.dark);
    caliper.scale.set(0.014, 0.03, 0.024);
    caliper.position.copy(at(fx, y, -0.05));
    group.add(caliper);
  }

  // Compteur sur son support, devant la potence.
  if (!tt && look.shape !== 'ville') {
    const mount = profiled([0.5, 1.0], [0.575, 1.018], 0.012, 0.012, mats.carbon);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.012, 0.074), mats.carbon);
    head.position.copy(at(0.585, 1.022));
    head.rotation.x = -0.1;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.058), new THREE.MeshBasicMaterial({ color: 0x1d3b4f }));
    screen.rotation.x = -Math.PI / 2 - 0.1;
    screen.position.copy(at(0.585, 1.0285));
    group.add(mount, head, screen);
  }

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
  return { group, wheels, drive };
}
