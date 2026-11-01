// Ciel : dégradé, soleil et nuages calculés au pixel, qui dérivent lentement.

import * as THREE from 'three';

export function createSky(fog: THREE.FogExp2, sun: THREE.Vector3): { mesh: THREE.Mesh; time: { value: number } } {
  const time = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: { uHorizon: { value: fog.color }, uSun: { value: sun }, uTime: time },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform float uTime;
      varying vec3 vDir;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 9.0; a *= 0.5; }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float t = pow(clamp(d.y, 0.0, 1.0), 0.5);
        vec3 c = mix(uHorizon, vec3(0.07, 0.24, 0.62), t);
        float s = max(dot(d, uSun), 0.0);
        c += vec3(1.0, 0.84, 0.6) * pow(s, 14.0) * 0.22;

        // Nuages projetés sur un plafond : ils s'étirent vers l'horizon comme de vrais cumulus.
        if (d.y > 0.015) {
          vec2 uv = d.xz / (d.y + 0.16) * 1.5 + vec2(uTime * 0.006, uTime * 0.002);
          float n = fbm(uv);
          float cover = smoothstep(0.46, 0.7, n);
          float shade = smoothstep(0.42, 0.72, fbm(uv + uSun.xz * 0.12));
          vec3 cloud = mix(vec3(1.3, 1.27, 1.22), vec3(0.72, 0.77, 0.86), shade);
          c = mix(c, cloud, cover * smoothstep(0.015, 0.14, d.y) * 0.95);
        }
        c += vec3(1.0, 0.93, 0.8) * smoothstep(0.9993, 0.9996, s) * 4.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, time };
}
