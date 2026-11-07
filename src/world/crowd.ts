// Le public des grands cols : six spectateurs modélisés, banderoles et arches. Tous les spectateurs
// d'un même modèle forment un seul objet instancié : quelques centaines de personnes ne coûtent presque rien.

import * as THREE from 'three';
import { type ArchPlan, type BannerPlan, type CrowdPlan, type Spectator, assignLooks } from '../sim/crowd';
import { type SpectatorModel, loadSpectators } from './crowdAsset';
import type { Route } from '../sim/route';
import type { HeightField } from './heightField';
import { plate } from './landmarks';
import { pbr } from './materials';
import { shoulderDrop } from './road';

/** Les spectateurs plus loin que cela du cycliste ne bougent pas : on ne les voit pas sauter. */
const ANIMATED_WITHIN_M = 140;

interface Pose {
  mesh: THREE.InstancedMesh;
  base: THREE.Matrix4[];
  phase: number[];
  distM: number[];
  cheering: boolean[];
  /** Attribut d'instance (phase, acclame, entrain) : l'entrain se met à jour avec la distance au cycliste. */
  move?: THREE.InstancedBufferAttribute;
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
  private disposed = false;
  private lastSort = -1;
  private time = { value: 0 };

  constructor(
    private route: Route,
    private field: HeightField,
    scene: THREE.Scene,
    plan: CrowdPlan,
  ) {
    // Tant que les modèles ne sont pas là, il n'y a personne : mieux que des silhouettes qui changeraient d'un coup.
    void loadSpectators().then((models) => {
      if (models && !this.disposed) this.buildSpectators(plan.spectators, models);
    });
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

  /** Les bras bougent sur la carte graphique : pour chaque sommet de bras, une rotation autour de l'épaule selon le temps et la personne. */
  private armMaterial(): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.time;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          attribute vec3 aArm;      // poids, côté (±1), élévation du bras quand elle acclame
          attribute vec3 aPivot;    // l'épaule
          attribute vec3 aMove;     // par personne : phase, 1 si elle acclame, entrain (0 à 1) selon la distance du cycliste
          attribute vec3 aLeg;      // hanche, genou, 1 si les jambes plient`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          float armWeight = aArm.x;
          vec2 armAngles = vec2(0.0);
          if (armWeight > 0.0) {
            float wave = sin(uTime * 6.0 + aMove.x);
            // Elle acclame : les bras montent presque à la verticale et s'agitent. Sinon, ils se balancent à peine.
            float raise = aMove.y > 0.5 ? aArm.z + 0.3 * clamp(aArm.z / 1.9, 0.4, 1.0) * wave : 0.1 * sin(uTime * 1.3 + aMove.x);
            float swing = aMove.y > 0.5 ? 0.45 * (1.0 - clamp(aArm.z / 1.9, 0.0, 1.0)) * sin(uTime * 6.0 + aMove.x + aArm.y * 1.6) : 0.3 * sin(uTime * 2.1 + aMove.x + aArm.y * 1.6);
            armAngles = vec2(aArm.y * raise * armWeight, swing * armWeight);
            float cz = cos(armAngles.x), sz = sin(armAngles.x), cx = cos(armAngles.y), sx = sin(armAngles.y);
            // La normale tourne comme le bras.
            vec3 n = objectNormal;
            n = vec3(n.x * cz - n.y * sz, n.x * sz + n.y * cz, n.z);
            n = vec3(n.x, n.y * cx - n.z * sx, n.y * sx + n.z * cx);
            objectNormal = n;
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          if (armWeight > 0.0) {
            vec3 rel = transformed - aPivot;
            float cz = cos(armAngles.x), sz = sin(armAngles.x), cx = cos(armAngles.y), sx = sin(armAngles.y);
            rel = vec3(rel.x * cz - rel.y * sz, rel.x * sz + rel.y * cz, rel.z);
            rel = vec3(rel.x, rel.y * cx - rel.z * sx, rel.y * sx + rel.z * cx);
            transformed = aPivot + rel;
          }
          // Le saut : en l'air, les cuisses se lèvent et les genoux se plient, les talons montent ; au sol, les jambes sont tendues.
          float airborne = aMove.z * smoothstep(0.12, 0.85, abs(sin(uTime * 5.5 + aMove.x)));
          if (aLeg.z > 0.5 && airborne > 0.0 && transformed.y < aLeg.x) {
            float below = smoothstep(aLeg.x, aLeg.x - 0.1, transformed.y);
            float lower = smoothstep(aLeg.y + 0.07, aLeg.y - 0.07, transformed.y);
            float thigh = -0.75 * airborne;
            float shin = 1.35 * airborne;
            vec3 hip = vec3(0.0, aLeg.x, 0.0);
            float ct = cos(thigh), st = sin(thigh);
            vec3 v = transformed - hip;
            vec3 upper = vec3(v.x, v.y * ct - v.z * st, v.y * st + v.z * ct);
            vec3 knee = vec3(0.0, aLeg.y - aLeg.x, 0.0);
            vec3 kneeMoved = vec3(0.0, knee.y * ct, knee.y * st);
            float cs = cos(thigh + shin), ss = sin(thigh + shin);
            vec3 r = v - knee;
            vec3 low = kneeMoved + vec3(r.x, r.y * cs - r.z * ss, r.y * ss + r.z * cs);
            transformed = mix(transformed, hip + mix(upper, low, lower), below);
          }`,
        );
    };
    return material;
  }

  private buildSpectators(list: Spectator[], models: SpectatorModel[]): void {
    const material = this.armMaterial();
    const looks = assignLooks(list);
    const tint = new THREE.Color();
    models.forEach(({ geometry }, look) => {
      const people = list.filter((_, i) => looks[i] === look);
      if (people.length === 0) return;
      const mesh = new THREE.InstancedMesh(geometry, material, people.length);
      const pose: Pose = { mesh, base: [], phase: [], distM: [], cheering: [] };
      const move = new Float32Array(people.length * 3);
      people.forEach((s, i) => {
        const p = this.route.at(s.distM);
        const x = p.x + Math.cos(p.heading) * s.offsetM * s.side;
        const z = p.z + Math.sin(p.heading) * s.offsetM * s.side;
        const y = this.surfaceAt(x, z, p.ele);
        // Tous regardent la route (le modèle regarde vers +Z), avec un peu d'écart.
        const yaw = Math.atan2(-s.side * Math.cos(p.heading), -s.side * Math.sin(p.heading)) + (s.phase - Math.PI) * 0.12;
        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(0, yaw, 0);
        this.dummy.scale.setScalar(s.scale);
        this.dummy.updateMatrix();
        pose.base.push(this.dummy.matrix.clone());
        pose.phase.push(s.phase);
        pose.distM.push(s.distM);
        pose.cheering.push(s.cheering);
        move[3 * i] = s.phase;
        move[3 * i + 1] = s.cheering ? 1 : 0;
        mesh.setMatrixAt(i, this.dummy.matrix);
        // Un léger voile de teinte et de clarté, pour que deux personnes du même modèle ne soient pas jumelles.
        mesh.setColorAt(i, tint.setHSL(s.hue, 0.18, 0.78 + 0.2 * ((s.hue * 7) % 1)));
      });
      const moveAttr = new THREE.InstancedBufferAttribute(move, 3);
      moveAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aMove', moveAttr);
      pose.move = moveAttr;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.poses.push(pose);
    });
  }

  /** Les spectateurs qui acclament sautent sur place, surtout ceux que le cycliste est en train de croiser. */
  update(timeS: number, riderM: number): void {
    this.time.value = timeS;
    // Un nouveau calcul tous les 1/30 s suffit : ces sauts ne demandent pas de fluidité.
    if (timeS - this.lastSort < 1 / 30) return;
    this.lastSort = timeS;
    for (const pose of this.poses) {
      let touched = false;
      for (let i = 0; i < pose.base.length; i++) {
        if (!pose.cheering[i]) continue;
        const gap = pose.distM[i] - riderM;
        const array = pose.move!.array as Float32Array;
        if (gap > ANIMATED_WITHIN_M || gap < -30) {
          if (array[3 * i + 2] !== 0) {
            array[3 * i + 2] = 0;
            pose.move!.needsUpdate = true;
          }
          continue;
        }
        // Plus le cycliste est proche, plus ils s'agitent.
        const excitement = 1 - Math.min(1, Math.abs(gap) / ANIMATED_WITHIN_M) * 0.6;
        array[3 * i + 2] = excitement;
        const hop = Math.abs(Math.sin(timeS * 5.5 + pose.phase[i])) * 0.2 * excitement;
        this.dummy.matrix.copy(pose.base[i]);
        this.dummy.matrix.elements[13] += hop;
        pose.mesh.setMatrixAt(i, this.dummy.matrix);
        touched = true;
      }
      if (touched) {
        pose.mesh.instanceMatrix.needsUpdate = true;
        pose.move!.needsUpdate = true;
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
  }
}
