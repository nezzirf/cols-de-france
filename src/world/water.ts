// Mer du monde d'entraînement : un grand plan à hauteur du niveau de la mer. Sa couleur dépend de la
// profondeur lue dans le relief, d'où le dégradé turquoise près du rivage et l'écume qui le longe.

import * as THREE from 'three';
import type { HeightField } from './heightField';
import { pbr } from './materials';

/** Demi-côté du plan : la mer se perd dans la brume bien avant ses bords. */
const REACH_M = 60000;

export class Water {
  readonly mesh: THREE.Mesh;
  private time = { value: 0 };
  private depthMap: THREE.DataTexture;

  constructor(field: HeightField, renderer: THREE.WebGLRenderer, seaLevelM: number) {
    const { cols, rows, x0, z0, stepM } = field.meta;
    this.depthMap = new THREE.DataTexture(field.heights, cols, rows, THREE.RedFormat, THREE.FloatType);
    // Sans filtrage linéaire des textures flottantes, la profondeur se lit en marches de 20 m.
    this.depthMap.minFilter = this.depthMap.magFilter = renderer.extensions.has('OES_texture_float_linear')
      ? THREE.LinearFilter
      : THREE.NearestFilter;
    this.depthMap.generateMipmaps = false;
    this.depthMap.needsUpdate = true;

    const uniforms = {
      uHeights: { value: this.depthMap },
      uRect: { value: new THREE.Vector4(x0, z0, (cols - 1) * stepM, (rows - 1) * stepM) },
      uSize: { value: new THREE.Vector2(cols, rows) },
      uSea: { value: seaLevelM },
      uTime: this.time,
    };
    const material = pbr({ color: 0xffffff, roughness: 0.1, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWaterXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform sampler2D uHeights;
          uniform vec4 uRect;
          uniform vec2 uSize;
          uniform float uSea;
          uniform float uTime;
          varying vec2 vWaterXZ;
          float wave(vec2 p) {
            return sin(p.x * 0.9 + uTime * 1.2) * 0.5 + sin(p.y * 1.3 - uTime * 0.9 + p.x * 0.5) * 0.4
              + sin((p.x * 0.7 + p.y) * 2.3 + uTime * 2.1) * 0.25;
          }`,
        )
        .replace(
          '#include <color_fragment>',
          `vec2 wuv = (vWaterXZ - uRect.xy) / uRect.zw;
          wuv = wuv * (uSize - 1.0) / uSize + 0.5 / uSize;
          float depth = uSea - texture2D(uHeights, wuv).r;
          float t = smoothstep(0.0, 9.0, clamp(depth, 0.0, 30.0));
          vec3 water = mix(vec3(0.07, 0.5, 0.56), vec3(0.004, 0.05, 0.12), pow(t, 0.6));
          float swell = sin(uTime * 1.3 + vWaterXZ.x * 0.07 + vWaterXZ.y * 0.03) * 0.18;
          float foam = smoothstep(0.42, 0.0, depth + swell) * (0.55 + 0.45 * sin(uTime * 2.0 + vWaterXZ.x * 0.4));
          diffuseColor.rgb = mix(water, vec3(0.9, 0.95, 0.97), clamp(foam, 0.0, 1.0));`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          float e = 0.6;
          float w0 = wave(vWaterXZ);
          float gx = wave(vWaterXZ + vec2(e, 0.0)) - w0;
          float gz = wave(vWaterXZ + vec2(0.0, e)) - w0;
          normal = normalize(normal + (viewMatrix * vec4(-gx, 0.0, -gz, 0.0)).xyz * 0.5);`,
        );
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(REACH_M * 2, REACH_M * 2).rotateX(-Math.PI / 2), material);
    this.mesh.position.set(x0 + ((cols - 1) * stepM) / 2, seaLevelM, z0 + ((rows - 1) * stepM) / 2);
    this.mesh.frustumCulled = false;
  }

  update(dt: number): void {
    this.time.value += dt;
  }

  dispose(): void {
    this.depthMap.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
