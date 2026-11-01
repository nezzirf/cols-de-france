// Rendu en deux temps : la scène dans une texture (avec sa profondeur), puis une passe finale
// qui trace les contours, règle l'exposition et les couleurs.

import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  #include <packing>
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 uTexel;
  uniform float uNear;
  uniform float uFar;
  uniform float uInk;
  const int AO_SAMPLES = 10;
  varying vec2 vUv;

  float viewZ(vec2 uv) {
    return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
  }
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;

    // Ombre de contact : assombrit les creux et les pieds d'objets, ce que le soleil seul ne
    // fait pas. Elle pose les bâtiments, les arbres et le cycliste sur le sol.
    float centre = viewZ(vUv);
    if (centre < 400.0) {
      float radius = clamp(110.0 / centre, 3.0, 22.0);
      float occlusion = 0.0;
      for (int i = 0; i < AO_SAMPLES; i++) {
        float a = float(i) * 2.399963;
        float r = radius * sqrt((float(i) + 0.5) / float(AO_SAMPLES));
        float gap = centre - viewZ(vUv + vec2(cos(a), sin(a)) * r * uTexel);
        occlusion += smoothstep(0.04, 0.5, gap) * (1.0 - smoothstep(1.2, 4.0, gap));
      }
      float fade = 1.0 - smoothstep(180.0, 400.0, centre);
      c *= 1.0 - 0.6 * fade * occlusion / float(AO_SAMPLES);
    }

    // Contour : le laplacien de la profondeur s'annule sur un plan, même rasant,
    // et ne réagit donc qu'aux vraies ruptures entre objets.
    if (uInk > 0.0) {
      float z = viewZ(vUv);
      vec2 t = uTexel * 1.25;
      float sum = viewZ(vUv + vec2(t.x, 0.0)) + viewZ(vUv - vec2(t.x, 0.0))
                + viewZ(vUv + vec2(0.0, t.y)) + viewZ(vUv - vec2(0.0, t.y));
      float edge = abs(sum - 4.0 * z) / z;
      float fade = 1.0 - smoothstep(120.0, 750.0, z);
      float ink = smoothstep(0.05, 0.14, edge) * fade * uInk;
      c = mix(c, c * vec3(0.16, 0.17, 0.22), ink);
    }

    c = aces(c * 1.08);
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(luma), c, 1.08);
    float d = distance(vUv, vec2(0.5));
    c *= 1.0 - 0.3 * smoothstep(0.45, 0.85, d);
    gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
  }
`;

const MIN_PIXEL_RATIO = 0.7;
const SLOW_FRAME_S = 1 / 42;
const SAMPLE_FRAMES = 90;

export class Pipeline {
  private target: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private quadScene = new THREE.Scene();
  private quadCamera = new THREE.Camera();
  private pixelRatio: number;
  private width = 1;
  private height = 1;
  private frames = 0;
  private time = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.pixelRatio = Math.min(window.devicePixelRatio, 1.5);
    renderer.toneMapping = THREE.NoToneMapping;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.texture },
        tDepth: { value: this.target.depthTexture },
        uTexel: { value: new THREE.Vector2() },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uInk: { value: 1 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setInk(strength: number): void {
    this.material.uniforms.uInk.value = strength;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    const w = Math.round(width * this.pixelRatio);
    const h = Math.round(height * this.pixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.target.setSize(w, h);
    this.material.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  /** Baisse la définition si la machine ne suit pas : la fluidité passe avant le détail. */
  private adapt(dt: number): void {
    this.time += dt;
    if (++this.frames < SAMPLE_FRAMES) return;
    const average = this.time / this.frames;
    this.frames = 0;
    this.time = 0;
    if (average > SLOW_FRAME_S && this.pixelRatio > MIN_PIXEL_RATIO) {
      this.pixelRatio = Math.max(MIN_PIXEL_RATIO, this.pixelRatio * 0.85);
      this.resize(this.width, this.height);
    }
  }

  render(scene: THREE.Scene, dt: number): void {
    this.adapt(dt);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
  }
}
