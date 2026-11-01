// Peloton simulé : des coéquipiers de niveaux différents qui roulent à puissance presque constante,
// avec la même physique que le joueur. Il y a toujours quelqu'un à rattraper, ou qui revient.

import { PhysicsEngine, type RiderSetup } from './physicsEngine';

/** Ce que le peloton a besoin de savoir du parcours. */
export interface PelotonRoute {
  readonly lengthM: number;
  readonly loop?: { fromM: number; toM: number };
  gradeAt(distM: number): number;
  eleAt(distM: number): number;
}

/** Niveau de chaque coéquipier, en proportion de la FTP du joueur, sa place sur la largeur de la route et son équipe. */
const LEVELS = [
  { name: 'Hugo', ratio: 0.72, lateralM: 0.2, teamId: 'ineos' },
  { name: 'Camille', ratio: 0.88, lateralM: 2.4, teamId: 'uae' },
  { name: 'Mathis', ratio: 1.0, lateralM: 0.9, teamId: 'visma' },
  { name: 'Léa', ratio: 1.12, lateralM: 2.9, teamId: 'bahrain' },
] as const;

/** Variation lente de l'effort, pour que le peloton respire. */
const SURGE_AMPLITUDE = 0.06;
const SURGE_PERIOD_S = 90;

export const PELOTON_SIZE = LEVELS.length;

export interface PelotonState {
  name: string;
  teamId: string;
  /** Position sur le tracé. */
  distM: number;
  lateralM: number;
  /** Distance parcourue depuis le départ, tours compris. */
  traveledM: number;
  speedKmh: number;
}

export interface PelotonGap {
  name: string;
  /** Positif : devant le joueur. */
  gapM: number;
}

interface Member {
  info: (typeof LEVELS)[number];
  physics: PhysicsEngine;
  traveledM: number;
}

export class Peloton {
  private members: Member[];
  private clockS = 0;

  /** `startM` : position de départ sur le tracé ; `startTraveledM` : distance parcourue que le joueur affiche à cet endroit. */
  constructor(
    private route: PelotonRoute,
    setup: RiderSetup,
    private ftp: number,
    startM: number,
    startTraveledM: number,
  ) {
    this.members = LEVELS.map((info) => {
      const physics = new PhysicsEngine({ ...setup });
      physics.distanceM = startM;
      return { info, physics, traveledM: startTraveledM };
    });
  }

  advance(dt: number): void {
    this.clockS += dt;
    const { route } = this;
    for (const m of this.members) {
      const from = m.physics.distanceM;
      const phase = m.info.lateralM * 7;
      const power = m.info.ratio * this.ftp * (1 + SURGE_AMPLITUDE * Math.sin((2 * Math.PI * this.clockS) / SURGE_PERIOD_S + phase));
      m.physics.advance(dt, { powerW: power, gradePct: route.gradeAt(from), altitudeM: route.eleAt(from) });
      m.traveledM += m.physics.distanceM - from;
      const loop = route.loop;
      if (loop && m.physics.distanceM >= loop.toM) {
        m.physics.distanceM -= loop.toM - loop.fromM;
      } else if (!loop && m.physics.distanceM >= route.lengthM) {
        // Arrivé : le coéquipier s'arrête sur la ligne.
        m.traveledM -= m.physics.distanceM - route.lengthM;
        m.physics.distanceM = route.lengthM;
        m.physics.speedMps = 0;
      }
    }
  }

  states(): PelotonState[] {
    return this.members.map((m) => ({
      name: m.info.name,
      teamId: m.info.teamId,
      distM: m.physics.distanceM,
      lateralM: m.info.lateralM,
      traveledM: m.traveledM,
      speedKmh: m.physics.speedMps * 3.6,
    }));
  }

  /** Le coéquipier le plus proche devant le joueur et le plus proche derrière lui, quand ils existent. */
  neighbours(userTraveledM: number): { ahead: PelotonGap | null; behind: PelotonGap | null } {
    let ahead: PelotonGap | null = null;
    let behind: PelotonGap | null = null;
    for (const m of this.members) {
      const gap = { name: m.info.name, gapM: m.traveledM - userTraveledM };
      if (gap.gapM > 0 && (ahead === null || gap.gapM < ahead.gapM)) ahead = gap;
      if (gap.gapM <= 0 && (behind === null || gap.gapM > behind.gapM)) behind = gap;
    }
    return { ahead, behind };
  }
}
