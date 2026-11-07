// Maisons et immeuble modélisés, allégés : une maison jaune à toit de tuiles, une maison blanche à toit gris, un immeuble à balcons.
// Chaque modèle a sa longueur sur l'axe Z et sa largeur sur l'axe X ; il est posé sur le sol (y = 0 au pied).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type HouseVariant = 'maisonA' | 'maisonB' | 'immeuble';

export interface HouseModel {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  /** Largeur (X), hauteur (Y) et longueur (Z) du modèle d'origine. */
  width: number;
  height: number;
  length: number;
}

const URLS: Record<HouseVariant, string> = {
  maisonA: `${import.meta.env.BASE_URL}models/maisons/maison-a.glb`,
  maisonB: `${import.meta.env.BASE_URL}models/maisons/maison-b.glb`,
  immeuble: `${import.meta.env.BASE_URL}models/maisons/immeuble.glb`,
};

let loading: Promise<Record<HouseVariant, HouseModel> | null> | null = null;

async function loadOne(url: string): Promise<HouseModel> {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let found: HouseModel | null = null;
  gltf.scene.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || found) return;
    const material = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    // Centré sur X et Z, pied à y = 0.
    geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    const map = material.map ?? null;
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace;
      map.anisotropy = 4;
    }
    found = { geometry, map, width: box.max.x - box.min.x, height: box.max.y - box.min.y, length: box.max.z - box.min.z };
  });
  if (!found) throw new Error(`Aucun maillage dans ${url}`);
  return found;
}

/** Charge les trois modèles une seule fois. Renvoie null s'ils ne peuvent pas l'être : le jeu garde alors les bâtiments dessinés. */
export function loadHouses(): Promise<Record<HouseVariant, HouseModel> | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  loading ??= Promise.all((Object.keys(URLS) as HouseVariant[]).map(async (k) => [k, await loadOne(URLS[k])] as const))
    .then((entries) => Object.fromEntries(entries) as Record<HouseVariant, HouseModel>)
    .catch(() => null);
  return loading;
}
