// Vélos de route modélisés (fichiers glTF) : chargés une fois, puis clonés pour chaque cycliste.
// Le premier a ses roues, son plateau et ses pédales en os de squelette ; le second (Van Rysel RCR) n'a que
// des pièces séparées, que le jeu regroupe lui-même pour les faire tourner.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

export const BIKE_ASSET_URL = `${import.meta.env.BASE_URL}models/scene.gltf`;
export const RCR_ASSET_URL = `${import.meta.env.BASE_URL}models/rcr/van-rysel-rcr-pro.glb`;

let asset: THREE.Object3D | null = null;
let rcr: THREE.Object3D | null = null;
let loading: Promise<void> | null = null;

const load = (url: string): Promise<THREE.Object3D | null> =>
  new GLTFLoader()
    .loadAsync(url)
    .then((gltf) => gltf.scene)
    .catch(() => null);

/** Lance le chargement ; en cas d'échec, le jeu garde son vélo dessiné par le code. */
export function preloadBikeAsset(): Promise<void> {
  loading ??= Promise.all([load(BIKE_ASSET_URL), load(RCR_ASSET_URL)]).then(([bike, vanRysel]) => {
    asset = bike;
    rcr = vanRysel;
  });
  return loading;
}

export const bikeAssetReady = (): boolean => asset !== null;
export const rcrAssetReady = (): boolean => rcr !== null;

/** Copie indépendante du vélo, avec son propre squelette. */
export function cloneBikeAsset(): THREE.Object3D {
  if (!asset) throw new Error('Le vélo modélisé n’est pas chargé.');
  return clone(asset);
}

export function cloneRcrAsset(): THREE.Object3D {
  if (!rcr) throw new Error('Le Van Rysel RCR modélisé n’est pas chargé.');
  return clone(rcr);
}
