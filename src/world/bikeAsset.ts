// Vélo de route modélisé (fichier glTF) : chargé une fois, puis cloné pour chaque cycliste.
// Les roues, le plateau et les pédales sont des os du squelette : le jeu les fait tourner.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const BIKE_ASSET_URL = `${import.meta.env.BASE_URL}models/scene.gltf`;

let asset: THREE.Object3D | null = null;
let loading: Promise<void> | null = null;

/** Lance le chargement ; en cas d'échec, le jeu garde son vélo dessiné par le code. */
export function preloadBikeAsset(): Promise<void> {
  loading ??= new GLTFLoader()
    .loadAsync(BIKE_ASSET_URL)
    .then((gltf) => {
      asset = gltf.scene;
    })
    .catch(() => {
      asset = null;
    });
  return loading;
}

export const bikeAssetReady = (): boolean => asset !== null;

/** Copie indépendante du vélo, avec son propre squelette. */
export function cloneBikeAsset(): THREE.Object3D {
  if (!asset) throw new Error('Le vélo modélisé n’est pas chargé.');
  return clone(asset);
}
