// Silhouette de chaque vélo. Les fabricants ne publient pas de modèles 3D : ces valeurs décrivent
// les traits reconnaissables de chaque cadre, relevés d'après son allure, pas des cotes réelles.

import type { BikeKind } from './bikes';

export interface FrameDesign {
  /** Profondeur des tubes dans le sens de la marche : fine sur un cadre classique, grande en aéro. */
  tubeDepth: number;
  tubeWidth: number;
  /** Hauteur du tube horizontal à l'arrière : basse sur un cadre plongeant. */
  topTubeRearY: number;
  /** Position des haubans sur le tube de selle : 0 en haut, 0,6 très bas. */
  stayDrop: number;
  /** Hauteur des jantes. */
  rimDepth: number;
  stem: 'classique' | 'integree' | 'v';
  /** Passage ouvert en haut du tube de selle (IsoFlow du Madone). */
  splitSeatTube?: boolean;
  /** Peinture à deux tons. */
  twoTone?: 'arriere' | 'avant';
}

const CLASSIQUE: FrameDesign = { tubeDepth: 0.044, tubeWidth: 0.038, topTubeRearY: 0.8, stayDrop: 0.25, rimDepth: 0.05, stem: 'integree' };
const POLYVALENT: FrameDesign = { tubeDepth: 0.058, tubeWidth: 0.034, topTubeRearY: 0.79, stayDrop: 0.45, rimDepth: 0.055, stem: 'integree' };
const AERO: FrameDesign = { tubeDepth: 0.078, tubeWidth: 0.03, topTubeRearY: 0.78, stayDrop: 0.55, rimDepth: 0.062, stem: 'integree' };
const CLM: FrameDesign = { tubeDepth: 0.105, tubeWidth: 0.028, topTubeRearY: 0.82, stayDrop: 0.6, rimDepth: 0.085, stem: 'integree' };

const BY_KIND: Record<BikeKind, FrameDesign> = {
  aero: AERO,
  grimpeur: CLASSIQUE,
  polyvalent: POLYVALENT,
  clm: CLM,
  endurance: { ...CLASSIQUE, topTubeRearY: 0.77, stayDrop: 0.35, rimDepth: 0.03, stem: 'classique' },
  gravel: { ...CLASSIQUE, topTubeRearY: 0.74, stayDrop: 0.45, rimDepth: 0.025, stem: 'classique' },
  'vtt-xc': { tubeDepth: 0.06, tubeWidth: 0.052, topTubeRearY: 0.72, stayDrop: 0.3, rimDepth: 0.02, stem: 'classique' },
  'vtt-enduro': { tubeDepth: 0.075, tubeWidth: 0.062, topTubeRearY: 0.68, stayDrop: 0.45, rimDepth: 0.02, stem: 'classique' },
  ville: { tubeDepth: 0.036, tubeWidth: 0.036, topTubeRearY: 0.6, stayDrop: 0.1, rimDepth: 0.018, stem: 'classique' },
};

/** Écarts à la silhouette de sa catégorie, modèle par modèle. */
const BY_MODEL: Record<string, Partial<FrameDesign>> = {
  'Aeroad CFR': { tubeDepth: 0.082, twoTone: 'avant' },
  'Ultimate CFR': { tubeDepth: 0.04, topTubeRearY: 0.81 },
  'Oltre RC': { tubeDepth: 0.09, rimDepth: 0.065, twoTone: 'avant' },
  'Specialissima RC': { tubeDepth: 0.038, tubeWidth: 0.034, topTubeRearY: 0.82 },
  'RCR-F': { twoTone: 'arriere' },
  'RCR-R': { topTubeRearY: 0.78 },
  'SuperSix Evo': { stayDrop: 0.55, tubeDepth: 0.062 },
  'Filante SLR ID2': { tubeDepth: 0.074, twoTone: 'arriere' },
  'Verticale SLR': { topTubeRearY: 0.76, stayDrop: 0.4 },
  'Dogma F': { tubeDepth: 0.066, stayDrop: 0.4, twoTone: 'avant' },
  'Madone SLR': { tubeDepth: 0.09, splitSeatTube: true, topTubeRearY: 0.8, stayDrop: 0.6 },
  'Orca Aero': { tubeDepth: 0.086, topTubeRearY: 0.77 },
  Orca: { topTubeRearY: 0.79, stayDrop: 0.35 },
  'Foil RC': { tubeDepth: 0.086, tubeWidth: 0.034, topTubeRearY: 0.8 },
  'Addict RC': { topTubeRearY: 0.77, stayDrop: 0.4 },
  'S-Works Tarmac SL9': { stayDrop: 0.55, tubeDepth: 0.066, twoTone: 'avant' },
  'Propel Advanced SL': { topTubeRearY: 0.74, tubeDepth: 0.074 },
  'TCR Advanced SL': { topTubeRearY: 0.71, stayDrop: 0.3 },
  'Xelius DRS': { stayDrop: 0.6, topTubeRearY: 0.75, twoTone: 'arriere' },
  S5: { stem: 'v', tubeDepth: 0.084, topTubeRearY: 0.79 },
  R5: { tubeDepth: 0.042, topTubeRearY: 0.8 },
  Y1Rs: { topTubeRearY: 0.7, stayDrop: 0.68, tubeDepth: 0.088, twoTone: 'avant' },
  V5Rs: { topTubeRearY: 0.75, stayDrop: 0.35 },
  'Noah Fast 3.0': { tubeDepth: 0.08, stem: 'integree' },
  'Falcn RS': { topTubeRearY: 0.78, stayDrop: 0.5 },
  AD9: { tubeDepth: 0.07, stayDrop: 0.5 },
};

export function designFor(modelName: string, kind: BikeKind): FrameDesign {
  return { ...BY_KIND[kind], ...BY_MODEL[modelName] };
}

/** Modèles ayant des traits propres, pour vérifier que le tableau suit le catalogue. */
export const DESIGNED_MODELS = Object.keys(BY_MODEL);
