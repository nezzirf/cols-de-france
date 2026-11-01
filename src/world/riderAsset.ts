// Cycliste modélisé : le personnage fabriqué en code et sa combinaison, assemblés une fois, puis clonés pour
// chaque coureur.

import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildRig } from './riderRig';
import { loadSuit } from './riderSuit';

let asset: THREE.Object3D | null = null;
let loading: Promise<void> | null = null;

/** Lance le chargement ; en cas d'échec, le jeu garde son cycliste entièrement dessiné par le code. */
export function preloadRiderAsset(): Promise<void> {
  loading ??= loadSuit()
    .then((suit) => {
      asset = buildRig(suit).group;
    })
    .catch(() => {
      asset = null;
    });
  return loading;
}

export const riderAssetReady = (): boolean => asset !== null;

/** Copie indépendante du personnage, avec son propre squelette. */
export function cloneRiderAsset(): THREE.Object3D {
  if (!asset) throw new Error('Le personnage modélisé n’est pas chargé.');
  return clone(asset);
}
