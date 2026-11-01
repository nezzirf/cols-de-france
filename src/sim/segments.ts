// Segments chronométrés : détection d'entrée/sortie, écart en direct avec le record
// personnel et position du ghost. Les temps de passage sont gardés tous les 25 m.

import type { SegmentDef } from './route';

export const CHECKPOINT_M = 25;

export interface PersonalRecord {
  timeS: number;
  dateIso: string;
  /** Temps écoulé depuis l'entrée du segment à chaque point de contrôle. */
  splits: number[];
}

export interface PrStore {
  load(segmentId: string): PersonalRecord | null;
  save(segmentId: string, record: PersonalRecord): void;
}

/**
 * Clé d'un record. v2 : tracé de l'Alpe corrigé, les anciens temps portaient sur une autre route.
 * Chaque type de vélo a ses records : un temps en contre-la-montre ne vaut pas pour un VTT.
 */
export function recordKey(segmentId: string, bikeShape: string): string {
  return bikeShape === 'route' ? `cols.pr.v2.${segmentId}` : `cols.pr.v2.${bikeShape}.${segmentId}`;
}

export class LocalPrStore implements PrStore {
  constructor(private bikeShape: string) {}

  private key(id: string): string {
    return recordKey(id, this.bikeShape);
  }

  load(segmentId: string): PersonalRecord | null {
    try {
      const raw = localStorage.getItem(this.key(segmentId));
      return raw ? (JSON.parse(raw) as PersonalRecord) : null;
    } catch {
      return null;
    }
  }

  save(segmentId: string, record: PersonalRecord): void {
    try {
      localStorage.setItem(this.key(segmentId), JSON.stringify(record));
    } catch {
      // Stockage indisponible (navigation privée) : le record vaut pour la séance seulement.
    }
  }
}

interface Attempt {
  def: SegmentDef;
  startTimeS: number;
  splits: number[];
  pr: PersonalRecord | null;
}

export interface SegmentStatus {
  def: SegmentDef;
  elapsedS: number;
  remainingM: number;
  prTimeS: number | null;
  /** Écart avec le record à cette position : négatif = en avance. */
  gapS: number | null;
}

export interface SegmentResult {
  def: SegmentDef;
  timeS: number;
  previousPrS: number | null;
  isNewPr: boolean;
}

function splitAt(splits: number[], offsetM: number): number | null {
  const f = offsetM / CHECKPOINT_M;
  const i = Math.floor(f);
  if (i + 1 >= splits.length) return null;
  return splits[i] + (splits[i + 1] - splits[i]) * (f - i);
}

/** Distance (m depuis l'entrée du segment) atteinte par le ghost après `elapsedS`. */
export function ghostOffset(record: PersonalRecord, elapsedS: number): number {
  const s = record.splits;
  if (elapsedS >= s[s.length - 1]) return (s.length - 1) * CHECKPOINT_M;
  let low = 0;
  let high = s.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (s[mid] <= elapsedS) low = mid;
    else high = mid;
  }
  const span = s[high] - s[low];
  return (low + (span > 0 ? (elapsedS - s[low]) / span : 0)) * CHECKPOINT_M;
}

export class SegmentTracker {
  private active: Attempt[] = [];
  private lastDist = 0;
  private lastTime = 0;
  /** Les segments déjà couru durant cette séance ne se relancent pas. */
  private done = new Set<string>();

  constructor(
    private defs: SegmentDef[],
    private store: PrStore,
  ) {}

  /** À appeler après chaque pas de simulation. Renvoie les segments terminés. */
  update(distM: number, timeS: number): SegmentResult[] {
    const finished: SegmentResult[] = [];
    const prev = this.lastDist;
    const dt = timeS - this.lastTime;
    const crossingTime = (m: number): number =>
      distM > prev ? this.lastTime + ((m - prev) / (distM - prev)) * dt : timeS;

    for (const def of this.defs) {
      if (this.done.has(def.id) || this.active.some((a) => a.def.id === def.id)) continue;
      if (prev <= def.startM && distM >= def.startM) {
        this.active.push({ def, startTimeS: crossingTime(def.startM), splits: [0], pr: this.store.load(def.id) });
      }
    }

    this.active = this.active.filter((a) => {
      const next = () => a.def.startM + a.splits.length * CHECKPOINT_M;
      while (next() <= Math.min(distM, a.def.endM)) {
        a.splits.push(crossingTime(next()) - a.startTimeS);
      }
      if (distM < a.def.endM) return true;
      const timeSeg = crossingTime(a.def.endM) - a.startTimeS;
      a.splits.push(timeSeg);
      const previousPrS = a.pr?.timeS ?? null;
      const isNewPr = previousPrS === null || timeSeg < previousPrS;
      if (isNewPr) {
        this.store.save(a.def.id, { timeS: timeSeg, dateIso: new Date().toISOString(), splits: a.splits });
      }
      this.done.add(a.def.id);
      finished.push({ def: a.def, timeS: timeSeg, previousPrS, isNewPr });
      return false;
    });

    this.lastDist = distM;
    this.lastTime = timeS;
    return finished;
  }

  /** Nouveau tour : les segments peuvent être courus de nouveau, à partir de cette position. */
  restartAt(distM: number, timeS: number): void {
    this.active = [];
    this.done.clear();
    this.lastDist = distM;
    this.lastTime = timeS;
  }

  /** Segments en cours, du plus court (le plus précis) au plus long. */
  status(distM: number, timeS: number): SegmentStatus[] {
    return this.active
      .map((a) => {
        const offset = distM - a.def.startM;
        const elapsedS = timeS - a.startTimeS;
        const prAtPoint = a.pr ? splitAt(a.pr.splits, offset) : null;
        return {
          def: a.def,
          elapsedS,
          remainingM: a.def.endM - distM,
          prTimeS: a.pr?.timeS ?? null,
          gapS: prAtPoint === null ? null : elapsedS - prAtPoint,
        };
      })
      .sort((a, b) => a.def.endM - a.def.startM - (b.def.endM - b.def.startM));
  }

  /** Position sur le parcours du ghost le plus pertinent, ou null si aucun record. */
  ghostDistance(timeS: number): number | null {
    const withPr = this.active
      .filter((a) => a.pr)
      .sort((a, b) => a.def.endM - a.def.startM - (b.def.endM - b.def.startM));
    const a = withPr[0];
    if (!a?.pr) return null;
    return a.def.startM + ghostOffset(a.pr, timeS - a.startTimeS);
  }
}
