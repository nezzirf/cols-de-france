// Cycliste articulé : le corps est fait de volumes de révolution galbés, et jambes et bras
// sont recalculés à chaque image pour que les pieds suivent les pédales.

import * as THREE from 'three';
import type { BikeShape } from '../sim/bikes';
import { BB as BB_POINT, type BikeLook, buildBike, WHEEL_TURNS_PER_CRANK } from './bikeModel';
import { pbr, skinMaterial } from './materials';
import { at, ball, place, type Point, sculpt, turned, weldNormals } from './modelParts';
import { bibTexture } from './riderTextures';

const THIGH = 0.43;
const SHIN = 0.42;
const UPPER_ARM = 0.31;
const FOREARM = 0.29;
const CRANK = 0.172;
const PEDAL_SIDE = 0.1;
const HIP = new THREE.Vector2(-0.12, 0.98); // x vers l'avant (+) dans le plan du vélo, y vers le haut
const BB = new THREE.Vector2(BB_POINT[0], BB_POINT[1]);
const HIP_SIDE = 0.088;
const VENT_PIECES = 5;

export interface RiderLook extends BikeLook {
  /** Couleur du casque et des bandes du maillot ; absente, elle reprend le maillot. */
  accent?: THREE.Material;
  /** Une seule matière pour tout le corps, comme une statue. */
  mono?: boolean;
}

export const ROAD_LOOK: RiderLook = { shape: 'route', tyreM: 0.015, wheelRadiusM: 0.335 };

export interface RiderModel {
  group: THREE.Group;
  /** Positionne le pédalier à l'angle donné (radians), roues comprises. */
  pose(crankAngle: number): void;
}

/**
 * Deux segments articulés entre `a` et `b` : renvoie le coude ou le genou.
 * `bend` choisit le côté : +1 vers l'avant pour une jambe, -1 vers le bas pour un bras.
 */
export function solveJoint(a: Point, b: Point, first: number, second: number, bend: number): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dist = Math.hypot(dx, dy) || 1e-6;
  const d = Math.min(first + second - 1e-3, dist);
  const along = (first * first - second * second + d * d) / (2 * d);
  const across = Math.sqrt(Math.max(0, first * first - along * along));
  const ux = dx / dist;
  const uy = dy / dist;
  return [a[0] + ux * along - uy * across * bend, a[1] + uy * along + ux * across * bend];
}

interface Posture {
  shoulder: Point;
  neck: Point;
  head: Point;
  hand: Point;
  handSide: number;
  /** Rotation de la tête vers l'avant, pour regarder la route. */
  headTilt: number;
}

const POSTURES: Record<BikeShape, Posture> = {
  route: { shoulder: [0.3, 1.36], neck: [0.38, 1.43], head: [0.47, 1.53], hand: [0.6, 1.0], handSide: 0.2, headTilt: 0.2 },
  gravel: { shoulder: [0.27, 1.39], neck: [0.34, 1.46], head: [0.42, 1.57], hand: [0.58, 1.01], handSide: 0.22, headTilt: 0.14 },
  clm: { shoulder: [0.43, 1.2], neck: [0.51, 1.25], head: [0.62, 1.31], hand: [0.8, 1.05], handSide: 0.06, headTilt: 0.5 },
  vtt: { shoulder: [0.22, 1.42], neck: [0.29, 1.5], head: [0.37, 1.62], hand: [0.5, 1.03], handSide: 0.33, headTilt: 0.1 },
  ville: { shoulder: [-0.02, 1.5], neck: [0.01, 1.59], head: [0.04, 1.71], hand: [0.46, 1.02], handSide: 0.27, headTilt: 0 },
};

/** Dimensions du casque : demi-largeur, demi-hauteur et demi-longueur vers l'avant. */
const HELMET = { width: 0.104, height: 0.1, front: 0.118 };

/**
 * Point de la coque du casque à partir d'une direction : la moitié arrière s'allonge et se
 * resserre en pointe, ce qui donne le profil effilé des casques de course.
 */
export function helmetPoint(dir: THREE.Vector3, tail: number): THREE.Vector3 {
  const rear = Math.max(0, dir.z);
  const narrow = 1 - 0.55 * rear * rear;
  return new THREE.Vector3(
    dir.x * HELMET.width * narrow,
    dir.y * HELMET.height * (1 - 0.3 * rear * rear),
    dir.z * HELMET.front * (dir.z > 0 ? tail : 1),
  );
}

function helmetGeometry(tail: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.57);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const q = helmetPoint(v, tail);
    p.setXYZ(i, q.x, q.y, q.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Crâne, mâchoire et menton : une sphère resserrée vers le bas, le front en retrait. */
function headGeometry(): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 32, 24);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const jaw = y < 0 ? 1 - 0.42 * y * y : 1;
    const eyes = z < -0.55 && y > 0 && y < 0.34 ? 0.95 : 1;
    const chin = y < -0.7 && z < 0 ? 1.08 : 1;
    p.setXYZ(i, x * 0.086 * jaw, y * 0.118, z * 0.102 * jaw * eyes * chin);
  }
  g.computeVertexNormals();
  weldNormals(g);
  return g;
}

/** Point d'un profil de révolution, interpolé. */
function radiusAt(profile: number[], t: number): number {
  const f = t * (profile.length - 1);
  const i = Math.min(profile.length - 2, Math.floor(f));
  return profile[i] + (profile[i + 1] - profile[i]) * (f - i);
}

/** Modèle orienté vers -Z, posé sur le sol en y = 0. */
export function createRiderModel(jersey: THREE.Material, kit: THREE.Material, look: RiderLook = ROAD_LOOK): RiderModel {
  const group = new THREE.Group();
  const mono = look.mono === true || kit === jersey;
  const skin = mono ? jersey : skinMaterial(0xc99672);
  const sock = mono ? jersey : pbr({ color: 0xf1efe9, roughness: 0.8 });
  const shoeMat = mono ? jersey : pbr({ color: 0xf1f1ee, roughness: 0.32 });
  const soleMat = mono ? jersey : pbr({ color: 0x17181b, roughness: 0.4 });
  const lens = mono ? jersey : pbr({ color: 0x0b1118, roughness: 0.08, metalness: 0.95 });
  const hair = mono ? jersey : pbr({ color: 0x2c2118, roughness: 0.75 });
  const lips = mono ? jersey : pbr({ color: 0xa96a5c, roughness: 0.5 });
  const accent = look.accent ?? jersey;
  const dark = kit;
  const tt = look.shape === 'clm';

  // --- Vélo ---
  const bike = buildBike(look, jersey, mono);
  // Sur le vélo modélisé, le cycliste se cale sur sa selle et ses cocottes ; sinon, sur les cotes du vélo dessiné.
  const fit = bike.fit;
  const posture: Posture = fit
    ? { ...POSTURES.route, shoulder: fit.shoulder, neck: fit.neck, head: fit.head, hand: fit.hand, handSide: fit.handSide }
    : POSTURES[look.shape];
  const hipPt = fit ? new THREE.Vector2(fit.hip[0], fit.hip[1]) : HIP;
  const bbPt = fit ? new THREE.Vector2(fit.bb[0], fit.bb[1]) : BB;
  const thigh = fit?.thigh ?? THIGH;
  const shin = fit?.shin ?? SHIN;
  group.add(bike.group);
  const wheels = bike.wheels;

  const unitArm = turned([0.012, 0.012], 8);
  const cranks = [new THREE.Mesh(unitArm, dark), new THREE.Mesh(unitArm, dark)];
  const pedals = [-1, 1].map(() => {
    const p = ball(1, dark);
    p.scale.set(0.05, 0.012, 0.045);
    return p;
  });
  // Le vélo modélisé a déjà ses manivelles et ses pédales, que son squelette fait tourner.
  if (!fit) group.add(...cranks, ...pedals);

  // --- Corps ---
  const shoulderC = at(posture.shoulder[0], posture.shoulder[1]);
  const pelvis = at(hipPt.x, hipPt.y);

  const torsoProfile = [0.15, 0.156, 0.16, 0.163, 0.166, 0.172, 0.18, 0.188, 0.193, 0.19, 0.17, 0.135, 0.085];
  const torsoGeo = turned(torsoProfile, 28);
  torsoGeo.scale(1.12, 1, 0.74);
  // Le dos se creuse à la colonne et se bombe aux omoplates.
  sculpt(torsoGeo, (x, y, z) => {
    if (z <= 0) return [0, y > 0.55 ? 0.012 : 0];
    const blades = Math.exp(-((y - 0.72) ** 2) / 0.02) * 0.022 * Math.min(1, Math.abs(x) / 0.07);
    const spine = Math.exp(-(x * x) / 0.0012) * -0.009;
    return [0, blades + spine];
  });
  const torso = new THREE.Mesh(torsoGeo, jersey);
  place(torso, pelvis, at(posture.neck[0], posture.neck[1]));
  group.add(torso);

  const collar = new THREE.Mesh(turned([0.074, 0.07], 18), accent);
  place(collar, at(posture.neck[0], posture.neck[1]).lerp(at(posture.head[0], posture.head[1]), 0.05), at(posture.neck[0], posture.neck[1]).lerp(at(posture.head[0], posture.head[1]), 0.24));
  group.add(collar);

  // Dossard épinglé : un morceau de la surface du dos, juste au-dessus du maillot.
  const bib = bibTexture('127');
  if (bib && !mono) {
    const points = [0.13, 0.22, 0.31, 0.4].map((t) => new THREE.Vector2(radiusAt(torsoProfile, t) + 0.004, t));
    const patch = new THREE.LatheGeometry(points, 12, -0.62, 1.24);
    patch.scale(1.12, 1, 0.74);
    patch.computeVertexNormals();
    const paper = new THREE.Mesh(patch, pbr({ map: bib, roughness: 0.7 }));
    place(paper, pelvis, at(posture.neck[0], posture.neck[1]));
    group.add(paper);
  }

  // Bande de couleur sur le maillot, comme les tenues d'équipe.
  const bandGeo = turned([0.19, 0.198, 0.202, 0.2], 24);
  bandGeo.scale(1.12, 1, 0.74);
  // Le dos du maillot est bombé aux omoplates : la bande le suit, sinon son bord en émerge par endroits.
  sculpt(bandGeo, (_x, _y, z) => [0, z > 0 ? 0.026 : 0.002]);
  const band = new THREE.Mesh(bandGeo, accent);
  place(band, pelvis.clone().lerp(shoulderC, 0.58), pelvis.clone().lerp(shoulderC, 0.72));
  group.add(band);

  // Bassin : le cuissard remonte sur le bas du dos et enveloppe les hanches, sans quoi le
  // haut des cuisses reste séparé du torse.
  const waistGeo = turned([0.158, 0.164, 0.168, 0.166], 18);
  waistGeo.scale(1.14, 1, 0.8);
  const waist = new THREE.Mesh(waistGeo, kit);
  place(waist, pelvis.clone().add(at(-0.05, -0.04)), pelvis.clone().lerp(shoulderC, 0.26));
  group.add(waist);
  for (const side of [-1, 1]) {
    const glute = ball(1, kit);
    glute.scale.set(0.098, 0.098, 0.108);
    glute.position.copy(at(hipPt.x - 0.012, hipPt.y - 0.03, side * (HIP_SIDE - 0.012)));
    group.add(glute);
  }

  const neck = new THREE.Mesh(turned([0.058, 0.05]), skin);
  place(neck, at(posture.neck[0], posture.neck[1]), at(posture.head[0], posture.head[1]));
  group.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.copy(at(posture.head[0], posture.head[1]));
  headGroup.rotation.x = posture.headTilt;
  group.add(headGroup);
  headGroup.add(new THREE.Mesh(headGeometry(), skin));
  const nose = new THREE.Mesh(turned([0.012, 0.015, 0.018, 0.016, 0.004], 10), skin);
  place(nose, new THREE.Vector3(0, 0.012, -0.096), new THREE.Vector3(0, -0.03, -0.116));
  headGroup.add(nose);
  const mouth = ball(1, lips);
  mouth.scale.set(0.024, 0.0055, 0.008);
  mouth.position.set(0, -0.063, -0.083);
  headGroup.add(mouth);
  for (const side of [-1, 1]) {
    const ear = ball(1, skin);
    ear.scale.set(0.009, 0.03, 0.019);
    ear.position.set(side * 0.086, -0.012, 0.01);
    headGroup.add(ear);
  }
  const nape = ball(1, hair);
  nape.scale.set(0.083, 0.066, 0.062);
  nape.position.set(0, -0.012, 0.05);
  headGroup.add(nape);
  const tail = tt ? 2.3 : 1.65;
  const helmet = new THREE.Mesh(helmetGeometry(tail), accent);
  const shellY = 0.024;
  helmet.position.set(0, shellY, 0.004);
  headGroup.add(helmet);
  // Aérations : de longues fentes qui épousent la coque, tronçon par tronçon. Tracées d'un
  // seul trait, elles couperaient la courbure et passeraient à l'intérieur du casque.
  const ventGeo = turned([0.006, 0.012, 0.012, 0.006], 8);
  ventGeo.scale(1, 1, 0.5);
  const onShell = (d: THREE.Vector3) =>
    helmetPoint(d.clone().normalize(), tail).multiplyScalar(1.015).add(new THREE.Vector3(0, shellY, 0.004));
  const slot = (from: THREE.Vector3, to: THREE.Vector3) => {
    for (let k = 0; k < VENT_PIECES; k++) {
      const piece = new THREE.Mesh(ventGeo, dark);
      place(piece, onShell(from.clone().lerp(to, k / VENT_PIECES)), onShell(from.clone().lerp(to, (k + 1) / VENT_PIECES)));
      headGroup.add(piece);
    }
  };
  const ventCount = tt ? 1 : 2;
  for (let n = -ventCount; n <= ventCount; n++) {
    const across = n * 0.3;
    slot(new THREE.Vector3(across, 0.6, -0.75), new THREE.Vector3(across * 0.6, 0.8, 0.6));
  }
  for (const side of [-1, 1]) slot(new THREE.Vector3(side * 0.95, 0.28, -0.25), new THREE.Vector3(side * 0.7, 0.42, 0.68));
  // Sangle sous le menton.
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(turned([0.0055, 0.0055], 6), dark);
    place(strap, new THREE.Vector3(side * 0.09, 0.0, 0.01), new THREE.Vector3(side * 0.012, -0.115, -0.04));
    headGroup.add(strap);
  }
  // Lunettes enveloppantes : un écran courbe et brillant, qui reflète le ciel.
  const shield = new THREE.SphereGeometry(1, 24, 8, Math.PI * 1.5 - 1.1, 2.2, 1.28, 0.62);
  const glasses = new THREE.Mesh(shield, lens);
  (lens as THREE.Material).side = THREE.DoubleSide;
  glasses.scale.set(0.098, 0.082, 0.117);
  glasses.position.set(0, 0.018, 0);
  headGroup.add(glasses);
  for (const side of [-1, 1]) {
    const temple = new THREE.Mesh(turned([0.0035, 0.0035], 6), dark);
    place(temple, new THREE.Vector3(side * 0.09, 0.018, -0.05), new THREE.Vector3(side * 0.09, 0.014, 0.03));
    headGroup.add(temple);
  }

  for (const side of [-1, 1]) {
    const sh = at(posture.shoulder[0], posture.shoulder[1], side * 0.17);
    const handPos = at(posture.hand[0], posture.hand[1], side * posture.handSide);
    const elbow2d = solveJoint(posture.shoulder, posture.hand, UPPER_ARM, FOREARM, -1);
    const elbow = at(elbow2d[0], elbow2d[1], side * (0.17 + posture.handSide) * 0.55);
    const deltoid = ball(1, jersey);
    deltoid.scale.set(0.078, 0.082, 0.082);
    deltoid.position.copy(sh);
    const upperGeo = turned([0.066, 0.066, 0.062, 0.054, 0.046, 0.042], 18);
    sculpt(upperGeo, (_x, y, z) => [0, z > 0 ? 0.012 * Math.sin(y * Math.PI) : 0]);
    const upper = new THREE.Mesh(upperGeo, jersey);
    place(upper, sh, elbow);
    const cuff = new THREE.Mesh(turned([0.046, 0.045], 16), accent);
    place(cuff, sh.clone().lerp(elbow, 0.68), sh.clone().lerp(elbow, 0.76));
    const skinArm = new THREE.Mesh(turned([0.043, 0.04], 16), skin);
    place(skinArm, sh.clone().lerp(elbow, 0.74), elbow);
    const foreGeo = turned([0.038, 0.044, 0.043, 0.036, 0.029, 0.024], 18);
    const fore = new THREE.Mesh(foreGeo, skin);
    place(fore, elbow, handPos);
    const elbowBall = ball(0.04, skin);
    elbowBall.position.copy(elbow);
    const palm = ball(1, dark);
    palm.scale.set(0.038, 0.024, 0.048);
    palm.position.copy(handPos);
    group.add(deltoid, upper, cuff, skinArm, fore, elbowBall, palm);
    // Doigts refermés sur le cintre, et le pouce de l'autre côté.
    for (let k = 0; k < 4; k++) {
      const finger = new THREE.Mesh(turned([0.0095, 0.0095, 0.008], 8), dark);
      const offset = side * (0.022 - k * 0.0145);
      place(finger, handPos.clone().add(new THREE.Vector3(offset, 0.014, -0.035)), handPos.clone().add(new THREE.Vector3(offset, -0.03, -0.062)));
      group.add(finger);
    }
    const thumb = new THREE.Mesh(turned([0.011, 0.01, 0.008], 8), dark);
    place(thumb, handPos.clone().add(new THREE.Vector3(-side * 0.03, 0.005, -0.01)), handPos.clone().add(new THREE.Vector3(-side * 0.036, -0.03, -0.05)));
    group.add(thumb);
  }

  // --- Jambes : géométries unitaires, étirées à chaque image ---
  const thighGeo = turned([0.1, 0.098, 0.092, 0.084, 0.074, 0.064, 0.056], 20);
  sculpt(thighGeo, (_x, y, z) => [0, z > 0 ? 0.02 * Math.sin(Math.min(1, y * 1.3) * Math.PI) : -0.008 * Math.sin(y * Math.PI)]);
  const shortsGeo = turned([0.104, 0.102, 0.097, 0.089, 0.08], 20);
  sculpt(shortsGeo, (_x, y, z) => [0, z > 0 ? 0.021 * Math.sin(y * 0.92 * Math.PI) : -0.008 * Math.sin(y * Math.PI)]);
  // Mollet : le muscle est à l'arrière de la jambe et s'affine vers la cheville.
  const calfGeo = turned([0.05, 0.054, 0.056, 0.05, 0.043, 0.037, 0.032], 20);
  sculpt(calfGeo, (_x, y, z) => [0, z < 0 ? -0.024 * Math.exp(-((y - 0.3) ** 2) / 0.04) : 0.004 * Math.sin(y * Math.PI)]);
  const sockGeo = turned([0.042, 0.04, 0.038, 0.037], 16);
  const footGeo = turned([0, 0.03, 0.04, 0.043, 0.038, 0.027, 0], 16);
  footGeo.scale(1.08, 1, 0.82);
  const soleGeo = turned([0, 0.03, 0.038, 0.04, 0.036, 0.024, 0], 12);
  soleGeo.scale(1.12, 1, 0.22);
  // Deux sangles à scratch autour du pied : elles passent là où la chaussure est la plus large.
  const strapNear = turned([0.0465, 0.0465], 16).scale(1.08, 1, 0.84);
  const strapFar = turned([0.0385, 0.0385], 16).scale(1.08, 1, 0.84);
  const makeLeg = () => {
    const leg = {
      strapA: new THREE.Mesh(strapNear, dark),
      strapB: new THREE.Mesh(strapFar, dark),
      hip: ball(0.102, kit),
      thigh: new THREE.Mesh(thighGeo, skin),
      shorts: new THREE.Mesh(shortsGeo, kit),
      knee: ball(0.056, skin),
      calf: new THREE.Mesh(calfGeo, skin),
      sock: new THREE.Mesh(sockGeo, sock),
      foot: new THREE.Mesh(footGeo, shoeMat),
      sole: new THREE.Mesh(soleGeo, soleMat),
    };
    group.add(leg.hip, leg.thigh, leg.shorts, leg.knee, leg.calf, leg.sock, leg.foot, leg.sole, leg.strapA, leg.strapB);
    return leg;
  };
  const legs = [makeLeg(), makeLeg()];
  const hip: Point = [hipPt.x, hipPt.y];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  const pose = (crankAngle: number) => {
    legs.forEach((leg, i) => {
      const angle = crankAngle + i * Math.PI;
      const side = i === 0 ? -1 : 1;
      const px = bbPt.x + Math.cos(angle) * CRANK;
      const py = bbPt.y + Math.sin(angle) * CRANK;
      const pedal = at(px, py, side * PEDAL_SIDE);
      pedals[i].position.copy(pedal);
      place(cranks[i], a.copy(at(bbPt.x, bbPt.y, side * 0.06)), b.copy(at(px, py, side * 0.06)));

      const ankle: Point = [px - 0.075, py + 0.075];
      const knee2d = solveJoint(hip, ankle, thigh, shin, 1);
      const hipPos = at(hip[0], hip[1] - 0.02, side * HIP_SIDE);
      leg.hip.position.copy(hipPos);
      const kneePos = at(knee2d[0], knee2d[1], side * 0.11);
      const anklePos = at(ankle[0], ankle[1], side * PEDAL_SIDE);
      place(leg.thigh, hipPos, kneePos);
      place(leg.shorts, hipPos, a.copy(hipPos).lerp(kneePos, 0.82));
      leg.knee.position.copy(kneePos);
      place(leg.calf, kneePos, anklePos);
      place(leg.sock, a.copy(kneePos).lerp(anklePos, 0.66), anklePos);
      const heelX = ankle[0] - 0.05;
      const heelY = ankle[1] - 0.045;
      const toeX = px + 0.13;
      const toeY = py + 0.012;
      place(leg.foot, a.copy(at(heelX, heelY, side * PEDAL_SIDE)), b.copy(at(toeX, toeY, side * PEDAL_SIDE)));
      place(leg.sole, a.copy(at(heelX, heelY - 0.026, side * PEDAL_SIDE)), b.copy(at(toeX, toeY - 0.024, side * PEDAL_SIDE)));
      const heel3 = at(heelX, heelY, side * PEDAL_SIDE);
      const toe3 = at(toeX, toeY, side * PEDAL_SIDE);
      const along = (t: number) => heel3.clone().lerp(toe3, t);
      place(leg.strapA, along(0.47), along(0.55));
      place(leg.strapB, along(0.66), along(0.73));
    });
    for (const wheel of wheels) wheel.rotation.x = crankAngle * WHEEL_TURNS_PER_CRANK;
    bike.drive(crankAngle);
  };
  pose(0);
  return { group, pose };
}
