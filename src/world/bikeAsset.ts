// Vélos de route modélisés (fichiers glTF) : chargés une fois, puis clonés pour chaque cycliste.
// Le premier a ses roues, son plateau et ses pédales en os de squelette ; le second (Van Rysel RCR) n'a que
// des pièces séparées, que le jeu regroupe lui-même pour les faire tourner.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { loadPhotoPaint } from './bikePaint';
import { splitMeshBike } from './meshBike';
import { MESH_BIKES } from './meshBikeSpecs';
import { splitY1rsCrankset } from './y1rsSplit';

export const BIKE_ASSET_URL = `${import.meta.env.BASE_URL}models/scene.gltf`;
export const RCR_ASSET_URL = `${import.meta.env.BASE_URL}models/rcr/van-rysel-rcr-pro.glb`;
export const Y1RS_ASSET_URL = `${import.meta.env.BASE_URL}models/y1rs/colnago-y1rs.glb`;

let asset: THREE.Object3D | null = null;
let rcr: THREE.Object3D | null = null;
let y1rs: THREE.Object3D | null = null;
const meshBikes = new Map<string, THREE.Object3D>();
let loading: Promise<void> | null = null;
const meshLoads: Promise<void>[] = [];

const load = (url: string, prepare?: (scene: THREE.Object3D) => void): Promise<THREE.Object3D | null> =>
  new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(url)
    .then((gltf) => {
      prepare?.(gltf.scene);
      return gltf.scene;
    })
    .catch(() => null);

/** Lance le chargement ; en cas d'échec, le jeu garde son vélo dessiné par le code. */
export function preloadBikeAsset(): Promise<void> {
  loading ??= Promise.all([load(BIKE_ASSET_URL), load(RCR_ASSET_URL), load(Y1RS_ASSET_URL, splitY1rsCrankset)]).then(([bike, vanRysel, colnago]) => {
    asset = bike;
    rcr = vanRysel;
    y1rs = colnago;
    // Les vélos d'un seul maillage pèsent de 13 à 18 Mo : on les charge en arrière-plan, sans retarder le départ.
    for (const spec of Object.values(MESH_BIKES)) {
      // Un vélo sans couleur attend sa peinture (tirée d'une photo) ; si elle manque, il garde sa peinture calculée.
      const painted = spec.photo
        ? loadPhotoPaint(spec.photo, spec.hubY)
            .then((paint) => {
              spec.paint = paint;
            })
            .catch(() => undefined)
        : Promise.resolve();
      meshLoads.push(
        painted
          .then(() => load(spec.url, splitMeshBike(spec)))
          .then((model) => {
            if (model) meshBikes.set(spec.id, model);
          }),
      );
    }
  });
  return loading;
}

export const bikeAssetReady = (): boolean => asset !== null;
export const rcrAssetReady = (): boolean => rcr !== null;
export const y1rsAssetReady = (): boolean => y1rs !== null;
export const meshBikeReady = (id: string): boolean => meshBikes.has(id);

/** Tous les vélos modélisés sont chargés (ou ont échoué) : pour redessiner les miniatures du Garage. */
export const bikeModelsLoaded = (): Promise<void> => (loading ?? Promise.resolve()).then(() => Promise.all(meshLoads)).then(() => undefined);

/** Le modèle 3D propre à ce vélo est-il chargé ? */
export function bikeModelReady(asset: string): boolean {
  if (asset === 'rcr') return rcr !== null;
  if (asset === 'y1rs') return y1rs !== null;
  return meshBikes.has(asset);
}

/** Copie indépendante du vélo, avec son propre squelette. */
export function cloneBikeAsset(): THREE.Object3D {
  if (!asset) throw new Error('Le vélo modélisé n’est pas chargé.');
  return clone(asset);
}

export function cloneRcrAsset(): THREE.Object3D {
  if (!rcr) throw new Error('Le Van Rysel RCR modélisé n’est pas chargé.');
  return clone(rcr);
}

export function cloneY1rsAsset(): THREE.Object3D {
  if (!y1rs) throw new Error('Le Colnago Y1Rs modélisé n’est pas chargé.');
  return clone(y1rs);
}

export function cloneMeshBike(id: string): THREE.Object3D {
  const model = meshBikes.get(id);
  if (!model) throw new Error(`Le vélo ${id} n’est pas chargé.`);
  return clone(model);
}
