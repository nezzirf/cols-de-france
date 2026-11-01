// Cycliste articulé : le corps est fait de volumes de révolution galbés, et jambes et bras
// sont recalculés à chaque image pour que les pieds suivent les pédales.

import * as THREE from 'three';
import type { BikeShape } from '../sim/bikes';
import { BB as BB_POINT, type BikeLook, buildBike } from './bikeModel';
import { toon } from './materials';
import { at, ball, place, type Point, turned } from './modelParts';

const THIGH = 0.43;
const SHIN = 0.42;
const UPPER_ARM = 0.31;
const FOREARM = 0.29;
const CRANK = 0.172;
const PEDAL_SIDE = 0.1;
const HIP = new THREE.Vector2(-0.12, 0.98); // x vers l'avant (+) dans le plan du vélo, y vers le haut
const BB = new THREE.Vector2(BB_POINT[0], BB_POINT[1]);
const WHEEL_TURNS_PER_CRANK = 2.6;
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

/** Modèle orienté vers -Z, posé sur le sol en y = 0. */
export function createRiderModel(jersey: THREE.Material, kit: THREE.Material, look: RiderLook = ROAD_LOOK): RiderModel {
  const group = new THREE.Group();
  const mono = look.mono === true || kit === jersey;
  const skin = mono ? jersey : toon({ color: 0xd9a884 });
  const sock = mono ? jersey : toon({ color: 0xf1efe9 });
  const shoeMat = mono ? jersey : toon({ color: 0xf3f3f0 });
  const accent = look.accent ?? jersey;
  const dark = kit;
  const tt = look.shape === 'clm';
  const posture = POSTURES[look.shape];

  // --- Vélo ---
  const bike = buildBike(look, jersey, mono);
  group.add(bike.group);
  const wheels = bike.wheels;

  const unitArm = turned([0.012, 0.012], 8);
  const cranks = [new THREE.Mesh(unitArm, dark), new THREE.Mesh(unitArm, dark)];
  const pedals = [-1, 1].map(() => {
    const p = ball(1, dark);
    p.scale.set(0.05, 0.012, 0.045);
    return p;
  });
  group.add(...cranks, ...pedals);

  // --- Corps ---
  const shoulderC = at(posture.shoulder[0], posture.shoulder[1]);
  const pelvis = at(HIP.x, HIP.y);

  const torsoProfile = [0.15, 0.158, 0.164, 0.17, 0.178, 0.19, 0.19, 0.16, 0.08];
  const torsoGeo = turned(torsoProfile, 18);
  torsoGeo.scale(1.12, 1, 0.74);
  const torso = new THREE.Mesh(torsoGeo, jersey);
  place(torso, pelvis, at(posture.neck[0], posture.neck[1]));
  group.add(torso);

  // Bande de couleur sur le maillot, comme les tenues d'équipe.
  const bandGeo = turned([0.181, 0.19, 0.196, 0.196], 18);
  bandGeo.scale(1.12, 1, 0.74);
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
    glute.scale.set(0.108, 0.118, 0.135);
    glute.position.copy(at(HIP.x - 0.025, HIP.y - 0.015, side * HIP_SIDE));
    group.add(glute);
  }

  const neck = new THREE.Mesh(turned([0.058, 0.05]), skin);
  place(neck, at(posture.neck[0], posture.neck[1]), at(posture.head[0], posture.head[1]));
  group.add(neck);

  const headGroup = new THREE.Group();
  headGroup.position.copy(at(posture.head[0], posture.head[1]));
  headGroup.rotation.x = posture.headTilt;
  group.add(headGroup);
  const skull = ball(1, skin);
  skull.scale.set(0.088, 0.108, 0.102);
  headGroup.add(skull);
  const jaw = ball(1, skin);
  jaw.scale.set(0.066, 0.07, 0.07);
  jaw.position.set(0, -0.052, -0.022);
  headGroup.add(jaw);
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
  const glasses = ball(1, dark);
  glasses.scale.set(0.082, 0.025, 0.05);
  glasses.position.set(0, 0.0, -0.068);
  headGroup.add(glasses);

  for (const side of [-1, 1]) {
    const sh = at(posture.shoulder[0], posture.shoulder[1], side * 0.17);
    const handPos = at(posture.hand[0], posture.hand[1], side * posture.handSide);
    const elbow2d = solveJoint(posture.shoulder, posture.hand, UPPER_ARM, FOREARM, -1);
    const elbow = at(elbow2d[0], elbow2d[1], side * (0.17 + posture.handSide) * 0.55);
    const deltoid = ball(0.074, jersey);
    deltoid.position.copy(sh);
    const upper = new THREE.Mesh(turned([0.066, 0.062, 0.05, 0.043]), jersey);
    place(upper, sh, elbow);
    const cuff = new THREE.Mesh(turned([0.047, 0.047]), accent);
    place(cuff, sh.clone().lerp(elbow, 0.84), elbow);
    const fore = new THREE.Mesh(turned([0.04, 0.042, 0.034, 0.026]), skin);
    place(fore, elbow, handPos);
    const elbowBall = ball(0.04, skin);
    elbowBall.position.copy(elbow);
    const glove = ball(1, dark);
    glove.scale.set(0.034, 0.03, 0.044);
    glove.position.copy(handPos);
    group.add(deltoid, upper, cuff, fore, elbowBall, glove);
  }

  // --- Jambes : géométries unitaires, étirées à chaque image ---
  const thighGeo = turned([0.1, 0.098, 0.086, 0.07, 0.058]);
  const calfGeo = turned([0.052, 0.06, 0.056, 0.044, 0.036]);
  const sockGeo = turned([0.04, 0.038, 0.036]);
  const footGeo = turned([0, 0.032, 0.042, 0.04, 0.03, 0]);
  footGeo.scale(1.05, 1, 0.8);
  const makeLeg = () => {
    const leg = {
      hip: ball(0.102, kit),
      thigh: new THREE.Mesh(thighGeo, kit),
      knee: ball(0.056, skin),
      calf: new THREE.Mesh(calfGeo, skin),
      sock: new THREE.Mesh(sockGeo, sock),
      foot: new THREE.Mesh(footGeo, shoeMat),
    };
    group.add(leg.hip, leg.thigh, leg.knee, leg.calf, leg.sock, leg.foot);
    return leg;
  };
  const legs = [makeLeg(), makeLeg()];
  const hip: Point = [HIP.x, HIP.y];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  const pose = (crankAngle: number) => {
    legs.forEach((leg, i) => {
      const angle = crankAngle + i * Math.PI;
      const side = i === 0 ? -1 : 1;
      const px = BB.x + Math.cos(angle) * CRANK;
      const py = BB.y + Math.sin(angle) * CRANK;
      const pedal = at(px, py, side * PEDAL_SIDE);
      pedals[i].position.copy(pedal);
      place(cranks[i], a.copy(at(BB.x, BB.y, side * 0.06)), b.copy(at(px, py, side * 0.06)));

      const ankle: Point = [px - 0.075, py + 0.075];
      const knee2d = solveJoint(hip, ankle, THIGH, SHIN, 1);
      const hipPos = at(hip[0], hip[1] - 0.02, side * HIP_SIDE);
      leg.hip.position.copy(hipPos);
      const kneePos = at(knee2d[0], knee2d[1], side * 0.11);
      const anklePos = at(ankle[0], ankle[1], side * PEDAL_SIDE);
      place(leg.thigh, hipPos, kneePos);
      leg.knee.position.copy(kneePos);
      place(leg.calf, kneePos, anklePos);
      place(leg.sock, a.copy(kneePos).lerp(anklePos, 0.72), anklePos);
      place(leg.foot, a.copy(at(ankle[0] - 0.05, ankle[1] - 0.045, side * PEDAL_SIDE)), b.copy(at(px + 0.13, py + 0.012, side * PEDAL_SIDE)));
    });
    for (const wheel of wheels) wheel.rotation.x = crankAngle * WHEEL_TURNS_PER_CRANK;
  };
  pose(0);
  return { group, pose };
}
