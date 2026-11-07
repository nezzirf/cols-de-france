// Repères des vélos modélisés d'un seul maillage (voir meshBike), lus sur une vue de profil de chaque fichier.

import type { MeshBikeSpec } from './meshBike';

export const MESH_BIKES: Record<'ef' | 'sl9', MeshBikeSpec> = {
  ef: {
    id: 'ef',
    url: `${import.meta.env.BASE_URL}models/ef/cannondale-supersix.glb`,
    tyreR: 0.199,
    hubY: -0.0959,
    frontHubZ: -0.2905,
    rearHubZ: 0.2905,
    groundY: -0.2949,
    bbZ: 0.045,
    bbY: -0.139,
    saddle: { z: 0.2, top: 0.293 },
    hood: { z: -0.29, y: 0.245, side: 0.06 },
  },
  sl9: {
    id: 'sl9',
    url: `${import.meta.env.BASE_URL}models/sl9/specialized-sl9.glb`,
    tyreR: 0.2,
    hubY: -0.0955,
    frontHubZ: -0.2897,
    rearHubZ: 0.2897,
    groundY: -0.2955,
    bbZ: 0.05,
    bbY: -0.1365,
    saddle: { z: 0.18, top: 0.2978 },
    hood: { z: -0.29, y: 0.243, side: 0.05 },
    dropShadows: true,
  },
};
