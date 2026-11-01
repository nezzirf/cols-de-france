// Maillage du relief par blocs, avec niveaux de détail selon la distance au cycliste.
// La teinte est calculée au pixel selon l'altitude et la pente, d'où les étages de
// végétation visibles de loin sur les versants réels.

import * as THREE from 'three';
import type { Biomes, TerrainMeta } from '../sim/route';
import { ROCK_COLORS } from './biomes';
import type { HeightField } from './heightField';
import { pbr } from './materials';

const CHUNK_CELLS = 64;
const LOD_STEPS = [1, 2, 4, 8];
const LOD_RANGES_M = [1500, 3200, 7000];
const MAX_REBUILDS_PER_FRAME = 3;
const SKIRT_M = 40;

export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.62, 0.38).normalize();

const GROUND_FUNCTIONS = /* glsl */ `
  uniform vec3 uRock;
  uniform vec3 uBands;
  uniform sampler2D uOrtho;
  uniform vec4 uOrthoRect;
  uniform float uWorld;
  varying vec3 vWorld;
  varying vec3 vGroundNormal;
  varying float vDistance;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }
  vec3 srgb(float r, float g, float b) { return pow(vec3(r, g, b), vec3(2.2)); }

  /** Monde d'entraînement : la couleur vient de la vue aérienne peinte, le shader n'ajoute que le grain. */
  vec3 worldGround() {
    vec3 n = normalize(vGroundNormal);
    float fine = fbm(vWorld.xz * 0.06);
    float grain = fbm(vWorld.xz * 0.55);
    float blades = noise(vWorld.xz * 3.1);
    vec3 base = texture2D(uOrtho, (vWorld.xz - uOrthoRect.xy) / uOrthoRect.zw).rgb;
    float luma = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float steep = 1.0 - n.y + (fine - 0.5) * 0.14;
    float wall = smoothstep(0.24, 0.42, steep);
    // Les parois montrent la roche du lieu : le même ton, plus sombre et moins saturé.
    float strata = fract(vWorld.y / 2.6 + vWorld.x * 0.03 + fine * 1.6);
    float layers = 0.72 + 0.34 * smoothstep(0.0, 0.16, strata) * smoothstep(1.0, 0.7, strata);
    vec3 rockTone = mix(vec3(luma), base, 0.45) * (0.5 + 0.35 * fine) * layers;
    vec3 c = base * (0.8 + 0.3 * grain + 0.14 * blades);
    c = mix(c, rockTone, wall);
    // Sous les touffes d'herbe le sol est plus sombre ; ni le sable, ni la neige n'en ont.
    float grassy = smoothstep(0.008, 0.04, base.g - max(base.r, base.b * 0.6));
    float underGrass = (1.0 - smoothstep(25.0, 120.0, vDistance)) * (1.0 - wall) * grassy;
    return c * mix(1.0, 0.62, underGrass);
  }

  vec3 groundColor() {
    if (uWorld > 0.5) return worldGround();
    vec3 n = normalize(vGroundNormal);
    float wide = fbm(vWorld.xz * 0.0035);
    float fine = fbm(vWorld.xz * 0.06);
    float grain = fbm(vWorld.xz * 0.55);
    float blades = noise(vWorld.xz * 3.1);
    float h = vWorld.y + (wide - 0.5) * 130.0;

    // Prairies de fauche : grandes parcelles aux verts différents, comme vues du col.
    float parcel = step(0.5, noise(floor(vWorld.xz / vec2(120.0, 75.0)) * 1.7));
    vec3 valley = mix(srgb(0.30, 0.47, 0.20), srgb(0.44, 0.54, 0.25), parcel * 0.6 + fine * 0.4);
    vec3 forest = mix(srgb(0.11, 0.23, 0.13), srgb(0.19, 0.31, 0.16), fine);
    vec3 alpage = mix(srgb(0.38, 0.47, 0.23), srgb(0.54, 0.54, 0.31), fine);
    float scree = fbm(vWorld.xz * 1.9);
    vec3 rock = uRock * (0.55 + 0.42 * fine + 0.5 * scree * grain);

    vec3 c = mix(valley, forest, smoothstep(uBands.x - 70.0, uBands.x + 70.0, h));
    c = mix(c, alpage, smoothstep(uBands.y - 60.0, uBands.y + 60.0, h));
    c = mix(c, rock, smoothstep(uBands.z - 70.0, uBands.z + 90.0, h));
    float steep = 1.0 - n.y + (fine - 0.5) * 0.14;
    // Paroi : la roche à nu, en strates inclinées qui se lisent de loin comme une falaise.
    float strata = fract(vWorld.y / 2.6 + vWorld.x * 0.03 + fine * 1.6);
    float layers = 0.72 + 0.34 * smoothstep(0.0, 0.16, strata) * smoothstep(1.0, 0.7, strata);
    c = mix(c, rock * 0.92 * layers, smoothstep(0.24, 0.4, steep));
    c = mix(c, vec3(0.94, 0.97, 1.03), smoothstep(2780.0, 2980.0, h) * smoothstep(0.45, 0.2, steep));
    c *= 0.8 + 0.3 * grain + 0.14 * blades;

    // Photo aérienne : la vraie couleur des lieux, seule au loin et en teinte de près. Les
    // parois y échappent, la photo n'y montre que le sommet de la pente.
    vec3 photo = texture2D(uOrtho, (vWorld.xz - uOrthoRect.xy) / uOrthoRect.zw).rgb;
    float photoLuma = dot(photo, vec3(0.2126, 0.7152, 0.0722));
    // Éclaircit les tons moyens sans brûler la roche claire, que le soleil ferait passer pour de la neige.
    photo = mix(vec3(photoLuma), photo, 1.2) * mix(1.3, 0.82, smoothstep(0.25, 0.7, photoLuma));
    float wall = smoothstep(0.24, 0.4, steep);
    float distant = mix(0.3, 1.0, smoothstep(40.0, 200.0, vDistance));
    vec3 ground = mix(c, photo, distant * (1.0 - wall * 0.85));
    // De près, le sol passe sous l'herbe : plus sombre, il ne ressort pas entre les touffes.
    float underGrass = (1.0 - smoothstep(25.0, 120.0, vDistance)) * (1.0 - wall) * (1.0 - smoothstep(uBands.z - 40.0, uBands.z + 40.0, h));
    return ground * mix(1.0, 0.56, underGrass);
  }

  /** Relief de surface : pierres et mottes que le maillage de 20 m ne peut pas porter. */
  float bumpAt(vec2 p) { return fbm(p * 0.55) + 0.45 * fbm(p * 2.3); }
`;

interface Chunk {
  mesh: THREE.Mesh;
  lod: number;
  cx: number;
  cz: number;
  col: number;
  row: number;
}

/** Matière du sol, partagée avec les talus de la route pour qu'ils s'y fondent. */
export function groundMaterial(biomes: Biomes, photo: THREE.Texture, terrain: TerrainMeta, world = false): THREE.MeshStandardMaterial {
  const uniforms = {
    uWorld: { value: world ? 1 : 0 },
    uRock: { value: new THREE.Color(ROCK_COLORS[biomes.rock]) },
    uBands: { value: new THREE.Vector3(biomes.valley, biomes.forest, biomes.alpage) },
    uOrtho: { value: photo },
    uOrthoRect: {
      value: new THREE.Vector4(terrain.x0, terrain.z0, (terrain.cols - 1) * terrain.stepM, (terrain.rows - 1) * terrain.stepM),
    },
  };
  const material = pbr({ color: 0xffffff, roughness: 1 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;\nvarying vec3 vGroundNormal;\nvarying float vDistance;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorld = position;\nvGroundNormal = normal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDistance = -mvPosition.z;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${GROUND_FUNCTIONS}`)
      .replace('#include <color_fragment>', 'diffuseColor.rgb = groundColor();')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (vDistance < BUMP_RANGE) {
          float e = 0.35;
          float gx = bumpAt(vWorld.xz + vec2(e, 0.0)) - bumpAt(vWorld.xz - vec2(e, 0.0));
          float gz = bumpAt(vWorld.xz + vec2(0.0, e)) - bumpAt(vWorld.xz - vec2(0.0, e));
          float strength = 2.6 * (1.0 - smoothstep(BUMP_RANGE * 0.5, BUMP_RANGE, vDistance));
          normal = normalize(normal + (viewMatrix * vec4(-gx, 0.0, -gz, 0.0)).xyz * strength);
        }`,
      );
    shader.defines = { ...shader.defines, BUMP_RANGE: '180.0' };
  };
  return material;
}

export class TerrainSystem {
  private chunks: Chunk[] = [];
  private indexCache = new Map<number, THREE.BufferAttribute>();
  private group = new THREE.Group();

  constructor(
    private field: HeightField,
    material: THREE.Material,
    scene: THREE.Scene,
  ) {
    const { cols, rows } = field.meta;
    for (let r = 0; r + CHUNK_CELLS < rows; r += CHUNK_CELLS) {
      for (let c = 0; c + CHUNK_CELLS < cols; c += CHUNK_CELLS) {
        const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
        mesh.receiveShadow = true;
        const chunk: Chunk = {
          mesh,
          lod: -1,
          col: c,
          row: r,
          cx: field.meta.x0 + (c + CHUNK_CELLS / 2) * field.meta.stepM,
          cz: field.meta.z0 + (r + CHUNK_CELLS / 2) * field.meta.stepM,
        };
        this.build(chunk, LOD_STEPS.length - 1);
        this.chunks.push(chunk);
        this.group.add(mesh);
      }
    }
    scene.add(this.group);
  }

  private indices(step: number): THREE.BufferAttribute {
    const cached = this.indexCache.get(step);
    if (cached) return cached;
    const n = CHUNK_CELLS / step;
    const side = n + 1;
    const skirtStart = side * side;
    const out: number[] = [];
    const quad = (a: number, b: number, c: number, d: number) => out.push(a, c, b, b, c, d);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const k = r * side + c;
        quad(k, k + 1, k + side, k + side + 1);
      }
    }
    // Jupes : elles masquent les fissures entre deux blocs de niveaux différents.
    const edge = this.edgeVertices(side);
    for (let i = 0; i < edge.length; i++) {
      const a = edge[i];
      const b = edge[(i + 1) % edge.length];
      const sa = skirtStart + i;
      const sb = skirtStart + ((i + 1) % edge.length);
      out.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb);
    }
    const attr = new THREE.BufferAttribute(new Uint32Array(out), 1);
    this.indexCache.set(step, attr);
    return attr;
  }

  private edgeVertices(side: number): number[] {
    const e: number[] = [];
    for (let c = 0; c < side - 1; c++) e.push(c);
    for (let r = 0; r < side - 1; r++) e.push(r * side + side - 1);
    for (let c = side - 1; c > 0; c--) e.push((side - 1) * side + c);
    for (let r = side - 1; r > 0; r--) e.push(r * side);
    return e;
  }

  private build(chunk: Chunk, lod: number): void {
    const { cols, rows, stepM, x0, z0 } = this.field.meta;
    const h = this.field.heights;
    const step = LOD_STEPS[lod];
    const n = CHUNK_CELLS / step;
    const side = n + 1;
    const edge = this.edgeVertices(side);
    const count = side * side + edge.length;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);

    const at = (r: number, c: number) => h[Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))];
    let v = 0;
    for (let i = 0; i < side; i++) {
      for (let j = 0; j < side; j++) {
        const r = chunk.row + i * step;
        const c = chunk.col + j * step;
        pos[v * 3] = x0 + c * stepM;
        pos[v * 3 + 1] = at(r, c);
        pos[v * 3 + 2] = z0 + r * stepM;
        const dx = at(r, c + step) - at(r, c - step);
        const dz = at(r + step, c) - at(r - step, c);
        const len = Math.hypot(dx, 2 * step * stepM, dz);
        nor[v * 3] = -dx / len;
        nor[v * 3 + 1] = (2 * step * stepM) / len;
        nor[v * 3 + 2] = -dz / len;
        v++;
      }
    }
    for (const e of edge) {
      pos[v * 3] = pos[e * 3];
      pos[v * 3 + 1] = pos[e * 3 + 1] - SKIRT_M;
      pos[v * 3 + 2] = pos[e * 3 + 2];
      nor.set(nor.subarray(e * 3, e * 3 + 3), v * 3);
      v++;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(this.indices(step));
    geo.computeBoundingSphere();
    chunk.mesh.geometry.dispose();
    chunk.mesh.geometry = geo;
    chunk.lod = lod;
  }

  /** Affine les blocs proches : limité par image pour ne pas provoquer de saccades. */
  update(x: number, z: number, budget = MAX_REBUILDS_PER_FRAME): number {
    let pending = 0;
    const todo = this.chunks
      .map((chunk) => {
        const d = Math.hypot(chunk.cx - x, chunk.cz - z);
        let lod = LOD_RANGES_M.findIndex((range) => d < range);
        if (lod < 0) lod = LOD_STEPS.length - 1;
        return { chunk, lod, d };
      })
      .filter((t) => t.chunk.lod !== t.lod)
      .sort((a, b) => a.d - b.d);
    for (const t of todo) {
      if (budget-- > 0) this.build(t.chunk, t.lod);
      else pending++;
    }
    return pending;
  }
}
