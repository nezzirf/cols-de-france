// Le public des grands cols : spectateurs modélisés à gros traits, banderoles et arches. Tous les spectateurs
// d'une même pose forment un seul objet instancié : quelques centaines de personnes ne coûtent presque rien.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ArchPlan, BannerPlan, CrowdPlan, Spectator } from '../sim/crowd';
import type { Route } from '../sim/route';
import type { HeightField } from './heightField';
import { plate } from './landmarks';
import { pbr } from './materials';
import { shoulderDrop } from './road';

/** Les spectateurs plus loin que cela du cycliste ne bougent pas : on ne les voit pas sauter. */
const ANIMATED_WITHIN_M = 140;
const SKIN = 0xd9a47c;
const TROUSERS = 0x2d3340;

function part(w: number, h: number, d: number, x: number, y: number, z: number, color: number, tilt = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (tilt !== 0) g.rotateZ(tilt);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g.toNonIndexed();
}

function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

/** Le haut du corps, blanc : l'instance le teinte aux couleurs du vêtement. */
function bodyGeometry(cheering: boolean): THREE.BufferGeometry {
  const parts = [part(0.24, 0.58, 0.4, 0, 1.12, 0, 0xffffff)];
  if (cheering) {
    // Les bras en l'air, légèrement écartés.
    parts.push(part(0.1, 0.62, 0.1, 0, 1.52, 0.3, 0xffffff, 0.18), part(0.1, 0.62, 0.1, 0, 1.52, -0.3, 0xffffff, -0.18));
  } else {
    parts.push(part(0.1, 0.52, 0.1, 0, 1.08, 0.26, 0xffffff), part(0.1, 0.52, 0.1, 0, 1.08, -0.26, 0xffffff));
  }
  return merged(parts);
}

/** Jambes, tête et cheveux : leurs couleurs ne changent pas avec le vêtement. */
function restGeometry(skin: number): THREE.BufferGeometry {
  return merged([
    part(0.14, 0.82, 0.14, 0, 0.41, 0.1, TROUSERS),
    part(0.14, 0.82, 0.14, 0, 0.41, -0.1, TROUSERS),
    part(0.2, 0.22, 0.2, 0.01, 1.54, 0, skin),
    part(0.22, 0.09, 0.22, 0, 1.68, 0, 0x2a2420),
  ]);
}

interface Pose {
  body: THREE.InstancedMesh;
  rest: THREE.InstancedMesh;
  base: THREE.Matrix4[];
  phase: number[];
  distM: number[];
  cheering: boolean;
}

function archPole(): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 6.4, 10), pbr({ color: 0xd62828 }));
}

function arch(plan: ArchPlan): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-5.4, 5.4]) {
    const pole = archPole();
    pole.position.set(x, 3.1, 0);
    g.add(pole);
  }
  const beam = plate({ width: 11, height: 1.5, bg: '#d62828', fg: '#ffffff', lines: [{ text: `FLAMME ROUGE · ${plan.label}`, size: 0.6, bold: true }] });
  beam.position.y = 6;
  g.add(beam);
  return g;
}

function banner(plan: BannerPlan): THREE.Group {
  const g = new THREE.Group();
  const cloth = plate({ width: 4.4, height: 0.95, bg: plan.bg, fg: plan.fg, lines: [{ text: plan.text, size: 0.62, bold: true }] });
  cloth.position.y = 1.6;
  g.add(cloth);
  for (const x of [-2.2, 2.2]) {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), pbr({ color: 0x6b4a2b }));
    stick.position.set(x, 1.1, 0);
    g.add(stick);
  }
  return g;
}

export class Crowd {
  private poses: Pose[] = [];
  private group = new THREE.Group();
  private dummy = new THREE.Object3D();
  private geometries: THREE.BufferGeometry[] = [];
  private lastSort = -1;

  constructor(
    private route: Route,
    private field: HeightField,
    scene: THREE.Scene,
    plan: CrowdPlan,
  ) {
    this.buildSpectators(plan.spectators);
    for (const b of plan.banners) this.place(banner(b), b.distM, b.side * 4.8, 0.45 * b.side);
    for (const a of plan.arches) this.place(arch(a), a.distM, 0, 0);
    scene.add(this.group);
  }

  /** Le sol réellement visible : le relief, ou le talus de la route s'il passe au-dessus. */
  private surfaceAt(x: number, z: number, roadEle: number): number {
    return Math.max(this.field.height(x, z), roadEle + shoulderDrop(this.field.exactRoadDistance(x, z)));
  }

  private place(obj: THREE.Object3D, distM: number, side: number, yaw: number): void {
    const p = this.route.at(distM);
    const x = p.x + Math.cos(p.heading) * side;
    const z = p.z + Math.sin(p.heading) * side;
    obj.position.set(x, this.surfaceAt(x, z, p.ele), z);
    obj.rotation.y = -p.heading + yaw;
    this.group.add(obj);
  }

  private buildSpectators(list: Spectator[]): void {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    for (const cheering of [true, false]) {
      const people = list.filter((s) => s.cheering === cheering);
      if (people.length === 0) continue;
      const bodyGeo = bodyGeometry(cheering);
      const restGeo = restGeometry(SKIN);
      this.geometries.push(bodyGeo, restGeo);
      const body = new THREE.InstancedMesh(bodyGeo, material, people.length);
      const rest = new THREE.InstancedMesh(restGeo, material, people.length);
      const pose: Pose = { body, rest, base: [], phase: [], distM: [], cheering };
      const tint = new THREE.Color();
      people.forEach((s, i) => {
        const p = this.route.at(s.distM);
        const x = p.x + Math.cos(p.heading) * s.offsetM * s.side;
        const z = p.z + Math.sin(p.heading) * s.offsetM * s.side;
        const y = this.surfaceAt(x, z, p.ele);
        // Tous regardent la route, avec un peu d'écart.
        const yaw = Math.atan2(s.side * Math.sin(p.heading), -s.side * Math.cos(p.heading)) + (s.phase - Math.PI) * 0.12;
        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.setScalar(s.scale);
        this.dummy.updateMatrix();
        pose.base.push(this.dummy.matrix.clone());
        pose.phase.push(s.phase);
        pose.distM.push(s.distM);
        body.setMatrixAt(i, this.dummy.matrix);
        rest.setMatrixAt(i, this.dummy.matrix);
        // Des vêtements vifs, comme dans la foule d'une arrivée.
        tint.setHSL(s.hue, 0.65, 0.5);
        body.setColorAt(i, tint);
        // Un peu de variété de carnation et de teinte des jambes, d'une personne à l'autre.
        rest.setColorAt(i, tint.setScalar(0.6 + 0.4 * ((s.hue * 7) % 1)));
      });
      body.frustumCulled = false;
      rest.frustumCulled = false;
      body.castShadow = true;
      rest.castShadow = true;
      this.group.add(body, rest);
      this.poses.push(pose);
    }
  }

  /** Les spectateurs qui acclament sautent sur place, surtout ceux que le cycliste est en train de croiser. */
  update(timeS: number, riderM: number): void {
    // Un nouveau calcul tous les 1/30 s suffit : ces sauts ne demandent pas de fluidité.
    if (timeS - this.lastSort < 1 / 30) return;
    this.lastSort = timeS;
    for (const pose of this.poses) {
      if (!pose.cheering) continue;
      let touched = false;
      for (let i = 0; i < pose.base.length; i++) {
        const gap = pose.distM[i] - riderM;
        if (gap > ANIMATED_WITHIN_M || gap < -30) continue;
        // Plus le cycliste est proche, plus ils s'agitent.
        const excitement = 1 - Math.min(1, Math.abs(gap) / ANIMATED_WITHIN_M) * 0.6;
        const hop = Math.abs(Math.sin(timeS * 5.5 + pose.phase[i])) * 0.2 * excitement;
        this.dummy.matrix.copy(pose.base[i]);
        this.dummy.matrix.elements[13] += hop;
        pose.body.setMatrixAt(i, this.dummy.matrix);
        pose.rest.setMatrixAt(i, this.dummy.matrix);
        touched = true;
      }
      if (touched) {
        pose.body.instanceMatrix.needsUpdate = true;
        pose.rest.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    this.group.removeFromParent();
  }
}
