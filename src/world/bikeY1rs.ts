// Colnago Y1Rs, dessiné d'après ses photos : cadre noir, avant blanc qui se fond dans le noir, tube de selle
// et haubans plongeants, cockpit intégré à ailes plates, roues ENVE hautes à grands logos blancs.
// Aucun modèle 3D n'existe pour lui : tout est construit en code, avec le même repère que les autres vélos.

import * as THREE from 'three';
import type { AssetBike, RiderFit } from './bikeFromAsset';
import { buildChain, type Wheel } from './chain';
import { lacquer, pbr } from './materials';
import { at, ball, link, place, type Point, profiled } from './modelParts';

const BB: Point = [0.03, 0.287];
const CRANK = 0.172;
const RIM_DEPTH = 0.065;
const GEAR_SIDE = 0.045;
const RING_R = 0.104;
const SPOKES = 14;

/** Point du cadre d'après la photo de profil : pixels (x vers l'avant, y vers le bas) en mètres autour du boîtier. */
const PX = 0.00399;
const P = (px: number, py: number): Point => [BB[0] + (px - 190) * PX, BB[1] + (252 - py) * PX];

const BLACK = new THREE.Color(0x14161a);
const WHITE = new THREE.Color(0xeceef1);
const smooth = (a: number, b: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Texte blanc sur fond transparent, collé en tournant sur un plan. */
function textTexture(draw: (g: CanvasRenderingContext2D, size: number) => void, size: number, aspect = 1): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / aspect);
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Flanc de jante : « ENVE » en grandes lettres blanches, quatre fois autour de la roue. */
function rimLogos(inner: number, outer: number): THREE.Texture | null {
  return textTexture((g, size) => {
    const mid = (inner + outer) / 2 / outer;
    g.translate(size / 2, size / 2);
    g.fillStyle = '#f4f6f8';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `900 ${Math.round(size * (outer - inner) / outer * 0.36)}px Bahnschrift, "Arial Black", sans-serif`;
    for (let k = 0; k < 4; k++) {
      g.save();
      g.rotate((k / 4) * Math.PI * 2 + 0.4);
      g.translate(0, -mid * size * 0.5);
      g.rotate(0);
      g.scale(1.9, 1);
      g.fillText('ENVE', 0, 0);
      g.restore();
    }
  }, 1024);
}

function buildWheel(x: number, radius: number, tyre: number, mats: Mats, rimMat: THREE.Material, logos: THREE.Texture | null, mono: boolean): THREE.Group {
  const wheel = new THREE.Group();
  wheel.position.copy(at(x, radius));
  const centre = radius - tyre;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(centre, tyre, 10, 64).rotateY(Math.PI / 2), mats.rubber));
  const rimOuter = centre - tyre * 0.6;
  const inner = rimOuter - RIM_DEPTH;
  // Jante haute : un profil en U renversé, tourné autour de l'axe de la roue.
  const half = 0.0125;
  const profile = [
    new THREE.Vector2(inner, 0),
    new THREE.Vector2(inner + RIM_DEPTH * 0.12, half * 0.85),
    new THREE.Vector2(inner + RIM_DEPTH * 0.55, half),
    new THREE.Vector2(rimOuter, half * 0.8),
    new THREE.Vector2(rimOuter, -half * 0.8),
    new THREE.Vector2(inner + RIM_DEPTH * 0.55, -half),
    new THREE.Vector2(inner + RIM_DEPTH * 0.12, -half * 0.85),
    new THREE.Vector2(inner, 0),
  ];
  const rimGeo = new THREE.LatheGeometry(profile, 72).rotateZ(Math.PI / 2);
  rimGeo.computeVertexNormals();
  wheel.add(new THREE.Mesh(rimGeo, rimMat));
  if (logos && !mono) {
    const decal = new THREE.MeshBasicMaterial({ map: logos, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const side of [-1, 1]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, rimOuter, 72, 1), decal);
      // L'anneau est dessiné dans le plan XY ; la roue tourne autour de X : on le couche dans le plan YZ.
      ring.rotation.y = side * Math.PI / 2;
      ring.position.x = side * (half + 0.0006);
      wheel.add(ring);
    }
  }
  // Moyeu, axe et rayons fins presque radiaux.
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.07, 16).rotateZ(Math.PI / 2), mats.metal));
  wheel.add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.116, 8).rotateZ(Math.PI / 2), mats.metal));
  const spokeGeo = new THREE.CylinderGeometry(0.0013, 0.0013, 1, 4).translate(0, 0.5, 0);
  for (const side of [-1, 1]) {
    for (let i = 0; i < SPOKES; i++) {
      const hubAngle = (i / SPOKES) * Math.PI * 2 + (side > 0 ? Math.PI / SPOKES : 0);
      const rimAngle = hubAngle + side * 0.18;
      const a = new THREE.Vector3(side * 0.03, 0.022 * Math.cos(hubAngle), 0.022 * Math.sin(hubAngle));
      const b = new THREE.Vector3(side * 0.006, (inner + 0.004) * Math.cos(rimAngle), (inner + 0.004) * Math.sin(rimAngle));
      const spoke = new THREE.Mesh(spokeGeo, mats.dark);
      place(spoke, a, b);
      wheel.add(spoke);
    }
  }
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.003, 24).rotateZ(Math.PI / 2), mats.metal);
  rotor.position.x = -0.05;
  wheel.add(rotor);
  return wheel;
}

interface Mats {
  black: THREE.Material;
  white: THREE.Material;
  carbon: THREE.Material;
  rubber: THREE.Material;
  metal: THREE.Material;
  dark: THREE.Material;
  tape: THREE.Material;
}

/** Un tube coupé en tronçons dont la couleur passe du noir au blanc selon `share(t)` (t : 0 au début, 1 à la fin). */
function fadedTube(a: Point, b: Point, width: number, depth: number, side: number, share: (t: number) => number, steps: number, mono: THREE.Material | null): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  for (let i = 0; i < steps; i++) {
    const t0 = i / steps;
    const t1 = (i + 1) / steps;
    const p = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    // Un léger chevauchement évite les fentes entre tronçons.
    const mat = mono ?? lacquer({ color: BLACK.clone().lerp(WHITE, share((t0 + t1) / 2)), roughness: 0.28, clearcoat: 0.6 });
    out.push(profiled(p(t0), p(Math.min(1, t1 + 0.02)), width, depth, mat, side));
  }
  return out;
}

function nameDecal(text: string, a: Point, b: Point, width: number): THREE.Mesh[] {
  const texture = textTexture((g, size) => {
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 900 ${Math.round(size * 0.2)}px Bahnschrift, "Arial Black", sans-serif`;
    g.translate(size / 2, size / 10);
    g.fillText(text, 0, 0);
  }, 1024, 5.3);
  if (!texture) return [];
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const from = at(a[0], a[1]);
  const to = at(b[0], b[1]);
  const length = from.distanceTo(to) * 0.7;
  return [-1, 1].map((side) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(length, length * 0.19), material);
    const normal = new THREE.Vector3(side, 0, 0);
    // Le nom se lit de l'arrière vers l'avant à droite du vélo, et dans l'autre sens à gauche.
    const x = new THREE.Vector3().subVectors(to, from).normalize().multiplyScalar(-side);
    const y = new THREE.Vector3().crossVectors(normal, x);
    plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, normal));
    plane.position.copy(from).lerp(to, 0.5);
    plane.position.x = side * (width / 2 + 0.0015);
    return plane;
  });
}

export function buildY1rsBike(wheelRadiusM: number, tyreM: number, base: THREE.Material | null): AssetBike {
  const mono = base !== null;
  const group = new THREE.Group();
  const pick = (m: THREE.Material): THREE.Material => base ?? m;
  const mats: Mats = {
    black: pick(lacquer({ color: BLACK, roughness: 0.28, clearcoat: 0.6 })),
    white: pick(lacquer({ color: WHITE, roughness: 0.3, clearcoat: 0.6 })),
    carbon: pick(pbr({ color: 0x1b1d21, roughness: 0.38, metalness: 0.1 })),
    rubber: pick(pbr({ color: 0x141517, roughness: 0.95 })),
    metal: pick(pbr({ color: 0xb4b8bd, roughness: 0.32, metalness: 0.9 })),
    dark: pick(pbr({ color: 0x2a2c31, roughness: 0.5, metalness: 0.55 })),
    tape: pick(pbr({ color: 0x1c1d20, roughness: 0.97 })),
  };

  // Les points du cadre, lus sur la photo de profil.
  const R = wheelRadiusM;
  const rear: Point = [P(88, 240)[0], R];
  const front: Point = [P(350, 240)[0], R];
  const headTop = P(298, 128);
  const headLow = P(320, 180);
  const seatJoin = P(176, 150);
  const seatTop = P(152, 104);
  const stayTop = P(171, 182);
  const stem: Point = [headTop[0] + 0.115, headTop[1] + 0.04];

  const logos = rimLogos(R - tyreM - tyreM * 0.6 - RIM_DEPTH, R - tyreM - tyreM * 0.6);
  const rimMat = pick(pbr({ color: 0x15171a, roughness: 0.32, metalness: 0.15 }));
  const wheels = [buildWheel(rear[0], R, tyreM, mats, rimMat, logos, mono), buildWheel(front[0], R, tyreM, mats, rimMat, logos, mono)];
  group.add(...wheels);

  // Triangle principal : tube de selle droit, tube horizontal qui blanchit vers l'avant, gros tube diagonal.
  group.add(profiled(BB, seatJoin, 0.03, 0.074, mats.black));
  group.add(profiled(seatJoin, seatTop, 0.026, 0.048, mats.carbon));
  const none = mono ? base : null;
  group.add(...fadedTube(seatJoin, headTop, 0.032, 0.05, 0, (t) => smooth(0.35, 0.8, t), 6, none));
  group.add(...fadedTube(BB, headLow, 0.046, 0.108, 0, (t) => smooth(0.8, 1, t), 5, none));
  group.add(profiled(headTop, headLow, 0.052, 0.076, mats.white));
  const shell = ball(1, mats.black);
  shell.scale.set(0.045, 0.05, 0.058);
  shell.position.copy(at(BB[0], BB[1]));
  group.add(shell);
  const crown = ball(1, mats.white);
  crown.scale.set(0.034, 0.03, 0.05);
  crown.position.copy(at(headLow[0] + 0.006, headLow[1] - 0.01));
  group.add(crown);

  // Bases, haubans plongeants (ils rejoignent le tube de selle très bas), fourche blanche qui noircit vers l'axe.
  for (const side of [-1, 1]) {
    group.add(profiled(rear, BB, 0.02, 0.034, mats.black, side * 0.05), profiled(rear, stayTop, 0.014, 0.026, mats.black, side * 0.045));
    group.add(...fadedTube([headLow[0] + 0.004, headLow[1] - 0.012], front, 0.024, 0.052, side * 0.05, (t) => 1 - smooth(0.1, 0.75, t), 6, none));
  }

  // Tige et selle noires.
  const saddle = ball(1, mats.tape);
  saddle.scale.set(0.034, 0.014, 0.135);
  saddle.position.copy(at(seatTop[0] - 0.012, seatTop[1] + 0.04));
  group.add(saddle);
  const nose = ball(1, mats.tape);
  nose.scale.set(0.02, 0.011, 0.04);
  nose.position.copy(at(seatTop[0] + 0.12, seatTop[1] + 0.047));
  group.add(nose);
  for (const side of [-1, 1]) group.add(link([seatTop[0] - 0.09, seatTop[1] + 0.026], [seatTop[0] + 0.08, seatTop[1] + 0.03], 0.0034, mats.metal, side * 0.026));

  // Cockpit intégré : potence blanche, ailes plates un peu en arrière, puis cocottes et guidon noirs.
  group.add(profiled([headTop[0] - 0.002, headTop[1] + 0.012], stem, 0.04, 0.05, mats.white));
  const side0 = (sign: number): THREE.Group => {
    const path = new THREE.CatmullRomCurve3([
      at(stem[0], stem[1], 0),
      at(stem[0] - 0.01, stem[1], sign * 0.09),
      at(stem[0] - 0.03, stem[1] - 0.002, sign * 0.2),
      at(stem[0] + 0.035, stem[1] + 0.012, sign * 0.213),
      at(stem[0] + 0.1, stem[1] + 0.03, sign * 0.213),
      at(stem[0] + 0.17, stem[1] + 0.018, sign * 0.213),
      at(stem[0] + 0.195, stem[1] - 0.05, sign * 0.213),
      at(stem[0] + 0.15, stem[1] - 0.12, sign * 0.213),
      at(stem[0] + 0.06, stem[1] - 0.125, sign * 0.213),
    ]);
    const bar = new THREE.Group();
    bar.add(new THREE.Mesh(new THREE.TubeGeometry(path, 40, 0.0125, 10), mats.black));
    const hood = ball(1, mats.carbon);
    hood.scale.set(0.02, 0.03, 0.045);
    hood.position.copy(at(stem[0] + 0.125, stem[1] + 0.04, sign * 0.213));
    hood.rotation.x = 0.35;
    bar.add(hood);
    bar.add(profiled([stem[0] + 0.15, stem[1] + 0.045], [stem[0] + 0.19, stem[1] - 0.04], 0.008, 0.018, mats.carbon, sign * 0.213));
    return bar;
  };
  group.add(side0(-1), side0(1));

  // Pédalier : deux plateaux, deux manivelles, deux pédales tenues à plat ; tout tourne avec la jambe.
  const crankset = new THREE.Group();
  crankset.position.copy(at(BB[0], BB[1]));
  const ringGeo = new THREE.RingGeometry(RING_R - 0.03, RING_R, 50, 1).rotateY(Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.7, roughness: 0.4, side: THREE.DoubleSide }));
  ring.position.x = GEAR_SIDE;
  const small = new THREE.Mesh(new THREE.RingGeometry(0.052, 0.074, 40, 1).rotateY(Math.PI / 2), ring.material);
  small.position.x = GEAR_SIDE - 0.01;
  crankset.add(ring, small);
  for (let k = 0; k < 5; k++) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.012, 0.075).translate(0, 0, -0.045), mats.carbon);
    arm.position.x = GEAR_SIDE - 0.004;
    arm.rotation.x = (k / 5) * Math.PI * 2;
    crankset.add(arm);
  }
  const pedals: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    // La manivelle gauche part vers l'avant (angle 0), la droite vers l'arrière.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.026, CRANK + 0.02).translate(0, 0, -(CRANK + 0.02) / 2 + 0.01), mats.carbon);
    arm.position.x = side * 0.06;
    arm.rotation.x = side < 0 ? 0 : Math.PI;
    crankset.add(arm);
    const pedal = new THREE.Group();
    pedal.position.set(side * 0.085, 0, side < 0 ? -CRANK : CRANK);
    pedal.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.1), mats.dark));
    const spindle = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 8).rotateZ(Math.PI / 2), mats.metal);
    spindle.position.x = -side * 0.02;
    pedal.add(spindle);
    crankset.add(pedal);
    pedals.push(pedal);
  }
  group.add(crankset);

  // Chaîne, cassette, dérailleur : comme sur les autres vélos dessinés.
  const cassette = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.024, 0.04, 20).rotateZ(Math.PI / 2), mats.metal);
  cassette.position.copy(at(rear[0], rear[1], GEAR_SIDE - 0.005));
  group.add(cassette);
  const upper: Wheel = { c: [rear[0] + 0.006, R - 0.078], r: 0.0243, dir: -1 };
  const lower: Wheel = { c: [rear[0] - 0.015, R - 0.134], r: 0.0243, dir: 1 };
  const cogWheel: Wheel = { c: [rear[0], R], r: 0.0344, dir: 1 };
  const ringWheel: Wheel = { c: [BB[0], BB[1]], r: RING_R, dir: 1 };
  for (const w of [upper, lower]) {
    const pulley = new THREE.Mesh(new THREE.CylinderGeometry(w.r - 0.002, w.r - 0.002, 0.012, 18).rotateZ(Math.PI / 2), mats.dark);
    pulley.position.copy(at(w.c[0], w.c[1], GEAR_SIDE - 0.003));
    group.add(pulley);
  }
  for (const side of [-1, 1]) group.add(link(upper.c, lower.c, 0.0042, mats.dark, GEAR_SIDE - 0.003 + side * 0.0075));
  group.add(link([rear[0] - 0.012, R - 0.012], upper.c, 0.008, mats.dark, GEAR_SIDE + 0.004));
  const chain = buildChain([ringWheel, cogWheel, upper, lower], GEAR_SIDE - 0.002, mats.metal, mats.dark);
  group.add(chain.group);

  // Étriers de frein à disque.
  for (const [fx, y] of [
    [rear[0] + 0.065, R + 0.05],
    [front[0] - 0.04, R + 0.07],
  ] as Point[]) {
    const caliper = ball(1, mats.dark);
    caliper.scale.set(0.014, 0.03, 0.024);
    caliper.position.copy(at(fx, y, -0.05));
    group.add(caliper);
  }

  group.add(...nameDecal('COLNAGO', BB, headLow, 0.046));

  // Le coureur : bassin sur la selle, mains sur les cocottes ; le buste plus couché que sur les autres vélos, cockpit long.
  const hip: Point = [seatTop[0] - 0.09, seatTop[1] + 0.04 + 0.075 + 0.02];
  const fit: RiderFit = {
    bb: BB,
    crank: CRANK,
    hip,
    shoulder: [hip[0] + 0.52, hip[1] + 0.27],
    neck: [hip[0] + 0.6, hip[1] + 0.32],
    head: [hip[0] + 0.69, hip[1] + 0.39],
    hand: [stem[0] + 0.115, stem[1] + 0.07],
    handSide: 0.213,
    handRoll: 0.8,
    handSlope: 0.4,
    thigh: 0.45,
    shin: 0.44,
  };

  const drive = (crankAngle: number, wheelAngle: number): void => {
    crankset.rotation.x = crankAngle;
    for (const pedal of pedals) pedal.rotation.x = -crankAngle;
    for (const wheel of wheels) wheel.rotation.x = wheelAngle;
    chain.advance(crankAngle * RING_R);
  };
  drive(0, 0);
  return { group, fit, drive };
}
