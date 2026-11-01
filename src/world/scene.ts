// Assemble la scène 3D : ciel, relief, route, végétation, repères, cycliste et ghost.

import * as THREE from 'three';
import type { Bike } from '../sim/bikes';
import type { BuildingData, Route } from '../sim/route';
import { buildBuildings } from './buildings';
import { buildCliffRocks } from './cliffs';
import { ambienceOf, biomeAt, biomeLabel, type BiomeName } from './biomes';
import { HeightField } from './heightField';
import { LandCover } from './landCover';
import { Landmarks, type RouteEvent } from './landmarks';
import { Pipeline } from './pipeline';
import { FreeCamera } from './freeCamera';
import { createRiderModel, type RiderModel } from './rider';
import { bikeShape, dressedRider } from './riderSetup';
import { buildRoad, stations } from './road';
import { createSky } from './sky';
import { groundMaterial, SUN_DIRECTION, TerrainSystem } from './terrain';
import { Vegetation } from './vegetation';

const RIDER_LATERAL_M = 1.4;
const GHOST_LATERAL_M = 0.2;
const SHADOW_RANGE_M = 130;
const SHADOW_TEXEL_M = (SHADOW_RANGE_M * 2) / 3072;

export type CameraMode = 'poursuite' | 'embarquée';

export class World {
  readonly events: RouteEvent[];
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.3, 60000);
  private fog = new THREE.FogExp2(0xcad9e2, 0.00009);
  private sun = new THREE.DirectionalLight(0xfff3e2, 3.0);
  private pipeline: Pipeline;
  private skyTime: { value: number };
  private terrain: TerrainSystem;
  private vegetation: Vegetation;
  private field: HeightField;
  private rider: RiderModel;
  private ghost: RiderModel;
  private crank = 0;
  private cameraHeading: number | null = null;
  private lastTerrainUpdate = 0;
  private biome: BiomeName | null = null;
  private targetFog = new THREE.Color(0xcad9e2);
  private targetDensity = 0.00009;
  cameraMode: CameraMode = 'poursuite';
  free: FreeCamera | null = null;
  onBiomeChange: (label: string) => void = () => {};

  constructor(
    private canvas: HTMLCanvasElement,
    private route: Route,
    rawHeights: Float32Array,
    buildings: BuildingData[],
    bike: Bike,
    ortho: HTMLImageElement | HTMLCanvasElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pipeline = new Pipeline(this.renderer, this.camera);

    this.scene.fog = this.fog;
    const sky = createSky(this.fog, SUN_DIRECTION);
    this.skyTime = sky.time;
    this.scene.add(sky.mesh);
    // Reflets du ciel sur les matières : ce qui fait briller un cadre ou un toit comme en vrai.
    const skyOnly = new THREE.Scene();
    skyOnly.add(createSky(this.fog, SUN_DIRECTION).mesh);
    const reflections = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = reflections.fromScene(skyOnly, 0, 0.1, 100).texture;
    this.scene.environmentIntensity = 0.42;
    reflections.dispose();
    this.scene.add(new THREE.HemisphereLight(0xeef1f2, 0x9a8a6a, 1.05));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(3072, 3072);
    const c = this.sun.shadow.camera;
    c.left = c.bottom = -SHADOW_RANGE_M;
    c.right = c.top = SHADOW_RANGE_M;
    c.near = 10;
    c.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.5;
    this.scene.add(this.sun, this.sun.target);

    this.field = new HeightField(route, rawHeights);
    const photo = new THREE.Texture(ortho);
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.flipY = false;
    photo.anisotropy = 8;
    photo.generateMipmaps = true;
    photo.minFilter = THREE.LinearMipmapLinearFilter;
    photo.needsUpdate = true;
    const ground = groundMaterial(route.data.biomes, photo, route.data.terrain);
    this.terrain = new TerrainSystem(this.field, ground, this.scene);
    const roadStations = stations(route);
    this.scene.add(buildRoad(route, ground, roadStations));
    this.scene.add(buildCliffRocks(roadStations, route, this.field, route.data.biomes));
    const occupancy = buildBuildings(buildings, route.data.buildingStyle, this.field, this.scene);
    this.vegetation = new Vegetation(this.field, route.data.biomes, occupancy, new LandCover(ortho, route.data.terrain), this.scene);
    this.events = new Landmarks(route, this.field, this.scene).events;

    this.rider = dressedRider(bike);
    this.rider.group.traverse((o) => (o.castShadow = true));
    this.scene.add(this.rider.group);
    const ghostMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.42, depthWrite: false });
    this.ghost = createRiderModel(ghostMat, ghostMat, bikeShape(bike));
    this.ghost.group.visible = false;
    this.scene.add(this.ghost.group);

    window.addEventListener('resize', this.resize);
    this.resize();
    const p = route.at(0);
    this.terrain.update(p.x, p.z, 1000);
  }

  /** Démarre la caméra libre à l'endroit et dans la direction de la caméra actuelle. */
  enterFreeCamera(): FreeCamera {
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.free = new FreeCamera(this.camera.position, Math.atan2(dir.x, -dir.z), Math.asin(dir.y));
    return this.free;
  }

  exitFreeCamera(): void {
    this.free = null;
    this.cameraHeading = null;
  }

  private updateFreeCamera(free: FreeCamera, dt: number): { x: number; z: number; ele: number } {
    free.update(dt, (x, z) => this.field.height(x, z));
    this.camera.position.set(free.x, free.y, free.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(free.pitch, -free.yaw, 0);
    return { x: free.x, z: free.z, ele: this.field.height(free.x, free.z) };
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.pipeline.resize(w, h);
  };

  private placeOnRoad(model: THREE.Group, distM: number, lateral: number): void {
    const p = this.route.at(distM);
    model.position.set(p.x + Math.cos(p.heading) * lateral, p.ele + 0.02, p.z + Math.sin(p.heading) * lateral);
    model.rotation.order = 'YXZ';
    model.rotation.y = -p.heading;
    model.rotation.x = Math.atan(p.grade / 100);
  }

  private updateBiome(ele: number): void {
    const b = biomeAt(ele, this.route.data.biomes);
    if (b === this.biome) return;
    const first = this.biome === null;
    this.biome = b;
    const a = ambienceOf(b);
    this.targetFog.set(a.fog);
    this.targetDensity = a.density;
    if (!first) this.onBiomeChange(biomeLabel(b, this.route.data.biomes));
  }

  /** La zone d'ombre suit le cycliste, par pas d'un texel pour que les ombres ne scintillent pas. */
  private updateSun(x: number, y: number, z: number): void {
    const sx = Math.round(x / SHADOW_TEXEL_M) * SHADOW_TEXEL_M;
    const sz = Math.round(z / SHADOW_TEXEL_M) * SHADOW_TEXEL_M;
    this.sun.target.position.set(sx, y, sz);
    this.sun.position.set(sx, y, sz).addScaledVector(SUN_DIRECTION, 420);
  }

  private updateCamera(distM: number, dt: number): void {
    const p = this.route.at(distM);
    const ahead = this.route.at(distM + 16);
    const px = p.x + Math.cos(p.heading) * RIDER_LATERAL_M;
    const pz = p.z + Math.sin(p.heading) * RIDER_LATERAL_M;
    if (this.cameraHeading === null) this.cameraHeading = p.heading;
    let delta = p.heading - this.cameraHeading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.cameraHeading += delta * Math.min(1, dt * 2.2);
    const h = this.cameraHeading;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);

    if (this.cameraMode === 'poursuite') {
      const cx = px - fx * 6.4;
      const cz = pz - fz * 6.4;
      const ground = Math.max(this.field.height(cx, cz), this.route.eleAt(distM - 6.4));
      this.camera.position.set(cx, Math.max(ground + 1.7, p.ele + 2.5), cz);
      this.camera.lookAt(px + fx * 10, ahead.ele + 0.9, pz + fz * 10);
    } else {
      this.camera.position.set(px + fx * 0.3, p.ele + 1.55, pz + fz * 0.3);
      this.camera.lookAt(px + fx * 18, ahead.ele + 1.2, pz + fz * 18);
    }
  }

  render(distM: number, cadenceRpm: number, ghostDistM: number | null, dt: number, now: number): void {
    const p = this.route.at(distM);
    this.crank += ((cadenceRpm / 60) * Math.PI * 2 * dt) % (Math.PI * 2);
    this.rider.pose(-this.crank);
    this.placeOnRoad(this.rider.group, distM, RIDER_LATERAL_M);
    this.rider.group.visible = this.cameraMode === 'poursuite' || this.free !== null;

    this.ghost.group.visible = ghostDistM !== null;
    if (ghostDistM !== null) {
      this.placeOnRoad(this.ghost.group, ghostDistM, GHOST_LATERAL_M);
      this.ghost.pose(-this.crank * 0.96);
    }

    // Tout le détail du décor suit la caméra libre, pour inspecter n'importe quel endroit.
    let focus: { x: number; z: number; ele: number } = p;
    if (this.free) focus = this.updateFreeCamera(this.free, dt);
    else this.updateCamera(distM, dt);
    this.updateBiome(focus.ele);
    this.updateSun(focus.x, focus.ele, focus.z);
    this.fog.color.lerp(this.targetFog, Math.min(1, dt * 0.6));
    this.fog.density += (this.targetDensity - this.fog.density) * Math.min(1, dt * 0.6);
    this.skyTime.value += dt;

    this.vegetation.update(focus.x, focus.z, dt);
    if (now - this.lastTerrainUpdate > 300) {
      this.lastTerrainUpdate = now;
      this.terrain.update(focus.x, focus.z);
    }
    this.pipeline.render(this.scene, dt);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.pipeline.dispose();
    this.renderer.dispose();
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }
}
