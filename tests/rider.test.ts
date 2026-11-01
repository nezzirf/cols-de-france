import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { turned } from '../src/world/modelParts';
import { createRiderModel, helmetPoint, ROAD_LOOK, solveJoint } from '../src/world/rider';

const length = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('articulations', () => {
  const hip: [number, number] = [-0.12, 0.98];
  const foot: [number, number] = [0.1, 0.3];

  it('garde la longueur de la cuisse et du tibia', () => {
    const knee = solveJoint(hip, foot, 0.43, 0.42, 1);
    expect(length(hip, knee)).toBeCloseTo(0.43, 6);
    expect(length(knee, foot)).toBeCloseTo(0.42, 6);
  });
  it('plie le genou vers l’avant', () => {
    const knee = solveJoint(hip, foot, 0.43, 0.42, 1);
    expect(knee[0]).toBeGreaterThan((hip[0] + foot[0]) / 2);
  });
  it('plie le coude vers le bas', () => {
    const shoulder: [number, number] = [0.3, 1.36];
    const hand: [number, number] = [0.6, 1.0];
    const elbow = solveJoint(shoulder, hand, 0.31, 0.29, -1);
    expect(elbow[1]).toBeLessThan((shoulder[1] + hand[1]) / 2);
  });
  it('reste défini quand le membre est trop court pour atteindre le point', () => {
    const j = solveJoint([0, 0], [5, 0], 0.4, 0.4, 1);
    expect(Number.isFinite(j[0]) && Number.isFinite(j[1])).toBe(true);
  });
});

describe('casque', () => {
  const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize();

  it('est plus long que large, comme un casque de course', () => {
    const length = helmetPoint(dir(0, 0, 1), 1.65).z - helmetPoint(dir(0, 0, -1), 1.65).z;
    const width = helmetPoint(dir(1, 0, 0), 1.65).x * 2;
    expect(length / width).toBeGreaterThan(1.3);
  });
  it('s’affine vers l’arrière', () => {
    const middle = helmetPoint(dir(1, 0, 0), 1.65).x;
    const rear = helmetPoint(dir(1, 0, 2), 1.65).x;
    expect(rear).toBeLessThan(middle * 0.5);
  });
  it('a une pointe plus longue en contre-la-montre', () => {
    expect(helmetPoint(dir(0, 0, 1), 2.3).z).toBeGreaterThan(helmetPoint(dir(0, 0, 1), 1.65).z);
  });
});

describe('surfaces', () => {
  it('ne laisse pas de couture sur un volume fermé', () => {
    const g = turned([0.1, 0.12, 0.1], 16);
    const n = g.getAttribute('normal');
    const rows = 3;
    // La dernière colonne de sommets rejoint la première : leurs normales doivent coïncider.
    const last = 16 * rows;
    expect(n.getX(last + 1)).toBeCloseTo(n.getX(1), 5);
    expect(n.getZ(last + 1)).toBeCloseTo(n.getZ(1), 5);
  });
});

describe('modèle', () => {
  const make = (shape: typeof ROAD_LOOK.shape) =>
    createRiderModel(new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial(), { ...ROAD_LOOK, shape });

  it.each(['route', 'gravel', 'clm', 'vtt', 'ville'] as const)('se construit et pédale sans erreur (%s)', (shape) => {
    const r = make(shape);
    for (let a = 0; a < Math.PI * 2; a += 0.4) r.pose(a);
    r.group.traverse((o) => {
      expect(Number.isFinite(o.position.x + o.position.y + o.position.z)).toBe(true);
      expect(Number.isFinite(o.scale.y)).toBe(true);
    });
  });
  it('tient au-dessus du sol et à hauteur d’homme', () => {
    const r = make('route');
    r.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(r.group);
    expect(box.min.y).toBeGreaterThan(-0.03);
    expect(box.max.y).toBeGreaterThan(1.5);
    expect(box.max.y).toBeLessThan(1.8);
  });
  it('fait tourner les roues avec le pédalier', () => {
    const r = make('route');
    r.pose(1);
    const wheel = r.group.getObjectByName('roue')!;
    const first = wheel.rotation.x;
    r.pose(2);
    expect(wheel.rotation.x).not.toBe(first);
  });
});
