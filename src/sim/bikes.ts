// Catalogue des vélos. Les équipes et les modèles sont ceux de la saison 2026 du WorldTour
// masculin (Tour Magazin, janvier 2026, recoupé avec Escape Collective et Domestique).
// Les constructeurs ne publient pas de données comparables : poids, CdA et résistance au
// roulement sont donc des valeurs typiques par catégorie, pas des mesures de chaque modèle.

import { designFor, type FrameDesign } from './bikeDesigns';
import { DEFAULT_SETUP, type RiderSetup } from './physicsEngine';

export type BikeKind = 'aero' | 'grimpeur' | 'polyvalent' | 'clm' | 'endurance' | 'gravel' | 'vtt-xc' | 'vtt-enduro' | 'ville';
export type BikeShape = 'route' | 'clm' | 'gravel' | 'vtt' | 'ville';

export interface BikeSpec {
  label: string;
  kg: number;
  /** CdA de l'ensemble cycliste + vélo, dans la position propre à ce vélo. */
  cda: number;
  crr: number;
  wheelRadiusM: number;
  wheelInertia: number;
  shape: BikeShape;
  tyreM: number;
}

export const BIKE_KINDS: Record<BikeKind, BikeSpec> = {
  aero: { label: 'Route aéro', kg: 7.5, cda: 0.31, crr: 0.004, wheelRadiusM: 0.335, wheelInertia: 0.3, shape: 'route', tyreM: 0.015 },
  grimpeur: { label: 'Route grimpeur', kg: 6.9, cda: 0.322, crr: 0.004, wheelRadiusM: 0.335, wheelInertia: 0.24, shape: 'route', tyreM: 0.015 },
  polyvalent: { label: 'Route polyvalent', kg: 7.1, cda: 0.316, crr: 0.004, wheelRadiusM: 0.335, wheelInertia: 0.27, shape: 'route', tyreM: 0.015 },
  clm: { label: 'Contre-la-montre', kg: 8.6, cda: 0.235, crr: 0.0037, wheelRadiusM: 0.335, wheelInertia: 0.34, shape: 'clm', tyreM: 0.014 },
  endurance: { label: 'Route endurance', kg: 8.6, cda: 0.345, crr: 0.0044, wheelRadiusM: 0.34, wheelInertia: 0.3, shape: 'route', tyreM: 0.017 },
  gravel: { label: 'Gravel', kg: 9.2, cda: 0.36, crr: 0.0058, wheelRadiusM: 0.35, wheelInertia: 0.36, shape: 'gravel', tyreM: 0.022 },
  'vtt-xc': { label: 'VTT cross-country', kg: 10.8, cda: 0.43, crr: 0.0078, wheelRadiusM: 0.37, wheelInertia: 0.5, shape: 'vtt', tyreM: 0.03 },
  'vtt-enduro': { label: 'VTT tout-suspendu', kg: 14.5, cda: 0.47, crr: 0.0098, wheelRadiusM: 0.37, wheelInertia: 0.62, shape: 'vtt', tyreM: 0.036 },
  ville: { label: 'Vélo de ville', kg: 15, cda: 0.53, crr: 0.0066, wheelRadiusM: 0.345, wheelInertia: 0.45, shape: 'ville', tyreM: 0.022 },
};

export interface Team {
  id: string;
  name: string;
  brand: string;
  /** Couleurs indicatives de la tenue et du cadre, sans logo. */
  jersey: number;
  accent: number;
  frame: number;
  models: { name: string; kind: BikeKind }[];
}

export const TEAMS: Team[] = [
  {
    id: 'alpecin', name: 'Alpecin-Premier Tech', brand: 'Canyon', jersey: 0x0d2f6e, accent: 0xe8362e, frame: 0x13294f,
    models: [{ name: 'Aeroad CFR', kind: 'aero' }, { name: 'Ultimate CFR', kind: 'grimpeur' }, { name: 'Speedmax CFR', kind: 'clm' }],
  },
  {
    id: 'bahrain', name: 'Bahrain Victorious', brand: 'Bianchi', jersey: 0xc8102e, accent: 0x12284c, frame: 0x7fcfc4,
    models: [{ name: 'Oltre RC', kind: 'aero' }, { name: 'Specialissima RC', kind: 'grimpeur' }, { name: 'Aquila RC', kind: 'clm' }],
  },
  {
    id: 'decathlon', name: 'Decathlon CMA CGM', brand: 'Van Rysel', jersey: 0x0a4ea2, accent: 0xffffff, frame: 0x0b2f5e,
    models: [{ name: 'RCR-F', kind: 'aero' }, { name: 'RCR-R', kind: 'grimpeur' }, { name: 'RCR-X', kind: 'clm' }],
  },
  {
    id: 'ef', name: 'EF Education-EasyPost', brand: 'Cannondale', jersey: 0xe8348b, accent: 0x1e2a78, frame: 0xe8348b,
    models: [{ name: 'SuperSix Evo', kind: 'polyvalent' }, { name: 'SuperSlice', kind: 'clm' }],
  },
  {
    id: 'groupama', name: 'Groupama-FDJ United', brand: 'Wilier', jersey: 0x1c4fa1, accent: 0xe30613, frame: 0x16335f,
    models: [{ name: 'Filante SLR ID2', kind: 'aero' }, { name: 'Verticale SLR', kind: 'grimpeur' }, { name: 'Supersonica', kind: 'clm' }],
  },
  {
    id: 'ineos', name: 'INEOS Grenadiers', brand: 'Pinarello', jersey: 0x10243f, accent: 0xd7263d, frame: 0x14161a,
    models: [{ name: 'Dogma F', kind: 'polyvalent' }, { name: 'Bolide F', kind: 'clm' }],
  },
  {
    id: 'lidl', name: 'Lidl-Trek', brand: 'Trek', jersey: 0xc8102e, accent: 0x0a3a8c, frame: 0xc8102e,
    models: [{ name: 'Madone SLR', kind: 'aero' }, { name: 'Speed Concept SLR', kind: 'clm' }],
  },
  {
    id: 'lotto', name: 'Lotto Intermarché', brand: 'Orbea', jersey: 0xd1121f, accent: 0xffffff, frame: 0x17191d,
    models: [{ name: 'Orca Aero', kind: 'aero' }, { name: 'Orca', kind: 'grimpeur' }, { name: 'Ordu', kind: 'clm' }],
  },
  {
    id: 'movistar', name: 'Movistar Team', brand: 'Canyon', jersey: 0x0a3d9c, accent: 0x7ed957, frame: 0x0e2a66,
    models: [{ name: 'Aeroad CFR', kind: 'aero' }, { name: 'Ultimate CFR', kind: 'grimpeur' }, { name: 'Speedmax CFR', kind: 'clm' }],
  },
  {
    id: 'nsn', name: 'NSN Cycling Team', brand: 'Scott', jersey: 0x14202f, accent: 0x31c1d9, frame: 0x14202f,
    models: [{ name: 'Foil RC', kind: 'aero' }, { name: 'Addict RC', kind: 'grimpeur' }, { name: 'Plasma RC', kind: 'clm' }],
  },
  {
    id: 'redbull', name: 'Red Bull-Bora-hansgrohe', brand: 'Specialized', jersey: 0x0d2a57, accent: 0xe1062c, frame: 0x101b33,
    models: [{ name: 'S-Works Tarmac SL8', kind: 'polyvalent' }, { name: 'S-Works Shiv', kind: 'clm' }],
  },
  {
    id: 'soudal', name: 'Soudal Quick-Step', brand: 'Specialized', jersey: 0x0a3f9e, accent: 0xffffff, frame: 0x0b2f6b,
    models: [{ name: 'S-Works Tarmac SL8', kind: 'polyvalent' }, { name: 'S-Works Shiv', kind: 'clm' }],
  },
  {
    id: 'jayco', name: 'Team Jayco AlUla', brand: 'Giant', jersey: 0x0f6d7a, accent: 0xf28c28, frame: 0x123a4a,
    models: [{ name: 'Propel Advanced SL', kind: 'aero' }, { name: 'TCR Advanced SL', kind: 'grimpeur' }, { name: 'Trinity SL', kind: 'clm' }],
  },
  {
    id: 'picnic', name: 'Team Picnic PostNL', brand: 'Lapierre', jersey: 0xf26522, accent: 0xffffff, frame: 0xe0561a,
    models: [{ name: 'Xelius DRS', kind: 'polyvalent' }, { name: 'Aerostorm DRS', kind: 'clm' }],
  },
  {
    id: 'visma', name: 'Team Visma | Lease a Bike', brand: 'Cervélo', jersey: 0xf6d31f, accent: 0x111316, frame: 0xf6d31f,
    models: [{ name: 'S5', kind: 'aero' }, { name: 'R5', kind: 'grimpeur' }, { name: 'P5', kind: 'clm' }],
  },
  {
    id: 'uae', name: 'UAE Team Emirates-XRG', brand: 'Colnago', jersey: 0xf2f2f2, accent: 0xc8102e, frame: 0x18191c,
    models: [{ name: 'Y1Rs', kind: 'aero' }, { name: 'V5Rs', kind: 'grimpeur' }, { name: 'TT1', kind: 'clm' }],
  },
  {
    id: 'unox', name: 'Uno-X Mobility', brand: 'Ridley', jersey: 0xe2231a, accent: 0xf6c21a, frame: 0xc41d16,
    models: [{ name: 'Noah Fast 3.0', kind: 'aero' }, { name: 'Falcn RS', kind: 'polyvalent' }, { name: 'Dean Fast', kind: 'clm' }],
  },
  {
    id: 'xds', name: 'XDS Astana Team', brand: 'X-Lab', jersey: 0x2fb7c9, accent: 0xf2c200, frame: 0x12414b,
    models: [{ name: 'AD9', kind: 'polyvalent' }, { name: 'DB01', kind: 'clm' }],
  },
];

export interface Bike extends BikeSpec {
  id: string;
  name: string;
  team: Team | null;
  brand: string | null;
  design: FrameDesign;
  jersey: number;
  accent: number;
  frame: number;
}

/** Vélos sans équipe, habillés d'une tenue neutre. */
const GENERIC: { kind: BikeKind; name: string; frame: number }[] = [
  { kind: 'polyvalent', name: 'Route polyvalent', frame: 0x8f1d24 },
  { kind: 'endurance', name: 'Route endurance', frame: 0x2d4f73 },
  { kind: 'clm', name: 'Contre-la-montre', frame: 0x1b1d21 },
  { kind: 'gravel', name: 'Gravel', frame: 0x6f7a4f },
  { kind: 'vtt-xc', name: 'VTT cross-country', frame: 0xcf6a1e },
  { kind: 'vtt-enduro', name: 'VTT tout-suspendu', frame: 0x3a6f4a },
  { kind: 'ville', name: 'Vélo de ville', frame: 0xc9b98f },
];

const genericBikes: Bike[] = GENERIC.map((g) => ({
  ...BIKE_KINDS[g.kind],
  id: `generique:${g.kind}`,
  name: g.name,
  team: null,
  brand: null,
  design: designFor(g.name, g.kind),
  jersey: 0xd8232a,
  accent: 0x16181c,
  frame: g.frame,
}));

const teamBikes: Bike[] = TEAMS.flatMap((team) =>
  team.models.map((m) => ({
    ...BIKE_KINDS[m.kind],
    id: `${team.id}:${m.name}`,
    name: `${team.brand} ${m.name}`,
    team,
    brand: team.brand,
    design: designFor(m.name, m.kind),
    jersey: team.jersey,
    accent: team.accent,
    frame: team.frame,
  })),
);

export const GENERIC_BIKES = genericBikes;
export const ALL_BIKES: Bike[] = [...genericBikes, ...teamBikes];
export const DEFAULT_BIKE_ID = 'generique:polyvalent';

export function findBike(id: string): Bike {
  return ALL_BIKES.find((b) => b.id === id) ?? ALL_BIKES.find((b) => b.id === DEFAULT_BIKE_ID)!;
}

export interface Jersey {
  id: string;
  name: string;
  color: number;
  accent: number;
  team: boolean;
}

/** Garde la tenue liée au vélo choisi. */
export const BIKE_JERSEY = 'velo';

const PLAIN_JERSEYS: [string, string, number, number][] = [
  ['blanc', 'Blanc', 0xf2f3f5, 0x1d2329],
  ['noir', 'Noir', 0x17191d, 0xff6a1a],
  ['rouge', 'Rouge', 0xd8232a, 0xf2f3f5],
  ['bleu', 'Bleu', 0x1c4fa1, 0xf2f3f5],
  ['vert', 'Vert', 0x1f8a4d, 0xf2f3f5],
  ['jaune', 'Jaune', 0xf6d31f, 0x1d2329],
  ['orange', 'Orange', 0xf26522, 0x1d2329],
  ['rose', 'Rose', 0xe8348b, 0xf2f3f5],
  ['noir-rouge', 'Noir et rouge', 0x17191d, 0xc8102e],
];

/** Maillots dont la couleur d'accent colore aussi le casque. */
const RED_HELMET = new Set(['noir-rouge']);

export const JERSEYS: Jersey[] = [
  ...PLAIN_JERSEYS.map(([id, name, color, accent]) => ({ id, name, color, accent, team: false })),
  ...TEAMS.map((t) => ({ id: t.id, name: t.name, color: t.jersey, accent: t.accent, team: true })),
];

export function findJersey(id: string): Jersey | null {
  return JERSEYS.find((j) => j.id === id) ?? null;
}

/** Le vélo avec le maillot choisi : le cadre et ses couleurs ne changent pas. */
export function wearing(bike: Bike, jerseyId: string): Bike {
  const jersey = findJersey(jerseyId);
  if (!jersey) return bike;
  return RED_HELMET.has(jersey.id) ? { ...bike, jersey: jersey.color, accent: jersey.accent } : { ...bike, jersey: jersey.color };
}

export function setupFor(bike: Bike, riderKg: number): RiderSetup {
  return {
    ...DEFAULT_SETUP,
    riderKg,
    bikeKg: bike.kg,
    cda: bike.cda,
    crr: bike.crr,
    wheelRadiusM: bike.wheelRadiusM,
    wheelInertia: bike.wheelInertia,
  };
}
