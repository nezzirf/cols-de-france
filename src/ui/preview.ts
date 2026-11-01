// Aperçu 3D du menu : le cycliste et son vélo tournent lentement, sur fond transparent.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Bike } from '../sim/bikes';
import { dressedRider } from '../world/riderSetup';

const TURN_RAD_PER_S = 0.28;
const DRAG_RAD_PER_PX = 0.008;
const CRANK_ANGLE = 0.9;

export class BikePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
  private turntable = new THREE.Group();
  private model: THREE.Group | null = null;
  private observer: ResizeObserver;
  private frame = 0;
  private last = 0;
  private dragging = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const environment = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = environment.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.75;
    environment.dispose();

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(1.5, 5, 2.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.radius = 7;
    sun.shadow.camera.left = sun.shadow.camera.bottom = -2.2;
    sun.shadow.camera.right = sun.shadow.camera.top = 2.2;
    this.scene.add(sun);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.2 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor, this.turntable);
    this.turntable.rotation.y = -0.55;
    this.camera.position.set(0, 1.2, 5.1);
    this.camera.lookAt(0, 0.72, 0);

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
    this.frame = requestAnimationFrame(this.loop);
  }

  show(bike: Bike): void {
    this.clear();
    const rider = dressedRider(bike);
    rider.pose(CRANK_ANGLE);
    rider.group.traverse((o) => (o.castShadow = true));
    // Le modèle est centré sur le plateau pour tourner autour de son milieu.
    const center = new THREE.Box3().setFromObject(rider.group).getCenter(new THREE.Vector3());
    rider.group.position.set(-center.x, 0, -center.z);
    this.model = rider.group;
    this.turntable.add(rider.group);
  }

  private clear(): void {
    if (!this.model) return;
    this.turntable.remove(this.model);
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
    });
    this.model = null;
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private onDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onMove = (e: PointerEvent): void => {
    if (this.dragging) this.turntable.rotation.y += e.movementX * DRAG_RAD_PER_PX;
  };

  private onUp = (): void => {
    this.dragging = false;
  };

  private loop = (now: number): void => {
    this.frame = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging) this.turntable.rotation.y += dt * TURN_RAD_PER_S;
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.clear();
    this.renderer.dispose();
    // Le jeu a besoin de son propre contexte WebGL : celui-ci est rendu tout de suite.
    this.renderer.forceContextLoss();
  }
}
