// Tunnels et ponts d'un parcours, d'après OpenStreetMap (voir scripts/build-structures.mjs). Ils servent à poser
// les galeries et les parapets, et à régler le son : l'écho d'un tunnel, le torrent sous un pont.

export interface Span {
  fromM: number;
  toM: number;
  name?: string;
}

export interface Structures {
  tunnels: Span[];
  bridges: Span[];
}

export const NO_STRUCTURES: Structures = { tunnels: [], bridges: [] };

/** Vérifie ce qui vient d'un fichier : une liste de tronçons bien formés, sinon rien. */
export function sanitizeStructures(raw: unknown): Structures {
  const spans = (list: unknown): Span[] =>
    Array.isArray(list)
      ? list
          .filter((s): s is Span => !!s && typeof s.fromM === 'number' && typeof s.toM === 'number' && s.toM > s.fromM)
          .map((s) => ({ fromM: s.fromM, toM: s.toM, ...(typeof s.name === 'string' ? { name: s.name } : {}) }))
      : [];
  const r = (raw ?? {}) as Partial<Structures>;
  return { tunnels: spans(r.tunnels), bridges: spans(r.bridges) };
}

/**
 * À quel point on est « dans » une structure : 1 à l'intérieur, qui retombe à 0 sur `fadeM` mètres avant l'entrée et
 * après la sortie, pour que le son se fonde au lieu de sauter.
 */
export function structureLevel(spans: Span[], distM: number, fadeM: number): number {
  let level = 0;
  for (const s of spans) {
    const outside = distM < s.fromM ? s.fromM - distM : distM > s.toM ? distM - s.toM : 0;
    level = Math.max(level, Math.max(0, 1 - outside / fadeM));
  }
  return level;
}
