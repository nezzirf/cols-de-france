// Peloton simulé : des coureurs qui roulent à puissance presque constante, avec la même physique que
// le joueur. Il y a toujours quelqu'un à rattraper, ou qui revient.

import { PhysicsEngine, type RiderSetup } from './physicsEngine';

/** Ce que le peloton a besoin de savoir du parcours. */
export interface PelotonRoute {
  readonly lengthM: number;
  readonly loop?: { fromM: number; toM: number };
  gradeAt(distM: number): number;
  eleAt(distM: number): number;
}

/** Un coureur du peloton : son équipe, sa place sur la route, sa masse et la puissance qu'il développe. */
export interface PelotonRider {
  name: string;
  teamId: string;
  /** Place sur la largeur de la route. */
  lateralM: number;
  /** Masse du coureur ; celle du joueur quand elle n'est pas donnée. */
  massKg?: number;
  /** Avance (+) ou retard (−) au départ, par rapport au joueur. */
  startOffsetM?: number;
  /** Puissance (W) à l'instant `clockS`, en secondes depuis le départ du peloton. */
  powerAt(clockS: number): number;
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

/** Les quatre coéquipiers, à des niveaux proportionnels à la FTP du joueur. */
function teammates(ftp: number): PelotonRider[] {
  return LEVELS.map((info) => ({
    name: info.name,
    teamId: info.teamId,
    lateralM: info.lateralM,
    powerAt: (clockS) => info.ratio * ftp * (1 + SURGE_AMPLITUDE * Math.sin((2 * Math.PI * clockS) / SURGE_PERIOD_S + info.lateralM * 7)),
  }));
}

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

/** Position et vitesse du joueur. */
export interface PelotonUser {
  distM: number;
  traveledM: number;
  speedMps: number;
}

export interface PelotonGap {
  name: string;
  /** Positif : devant le joueur. */
  gapM: number;
}

interface Member {
  info: PelotonRider;
  physics: PhysicsEngine;
  traveledM: number;
}

export class Peloton {
  private members: Member[];
  private clock = 0;

  /**
   * `startM` : position de départ sur le tracé ; `startTraveledM` : distance parcourue que le joueur affiche à cet endroit.
   * Sans `riders`, ce sont les quatre coéquipiers, dont la puissance suit la FTP du joueur.
   */
  constructor(
    private route: PelotonRoute,
    setup: RiderSetup,
    ftp: number,
    startM: number,
    startTraveledM: number,
    riders: PelotonRider[] = teammates(ftp),
    /** Pendant ce temps (s) depuis le départ, le peloton reste avec le joueur, quelle que soit sa vitesse. */
    private escortS = 0,
  ) {
    this.members = riders.map((info) => {
      const offset = info.startOffsetM ?? 0;
      // Un coureur plus lourd est aussi un peu plus large : la surface frontale grandit moins vite que la masse.
      const mass = info.massKg ?? setup.riderKg;
      const physics = new PhysicsEngine({ ...setup, riderKg: mass, cda: setup.cda * Math.pow(mass / setup.riderKg, 0.35) });
      physics.distanceM = startM + offset;
      return { info, physics, traveledM: startTraveledM + offset };
    });
  }

  /** Temps écoulé depuis le départ du peloton (s). */
  get clockS(): number {
    return this.clock;
  }

  get size(): number {
    return this.members.length;
  }

  /** `user` : où est le joueur ; le peloton s'y accroche tant qu'il l'escorte. */
  advance(dt: number, user?: PelotonUser): void {
    this.clock += dt;
    const { route } = this;
    const escorting = user !== undefined && this.clock <= this.escortS;
    for (const m of this.members) {
      if (escorting) {
        // Échauffement : le coureur reste à sa place autour du joueur, à sa vitesse.
        const offset = m.info.startOffsetM ?? 0;
        m.physics.distanceM = user.distM + offset;
        m.physics.speedMps = user.speedMps;
        m.traveledM = user.traveledM + offset;
        continue;
      }
      const from = m.physics.distanceM;
      m.physics.advance(dt, { powerW: m.info.powerAt(this.clock), gradePct: route.gradeAt(from), altitudeM: route.eleAt(from) });
      m.traveledM += m.physics.distanceM - from;
      const loop = route.loop;
      if (loop && m.physics.distanceM >= loop.toM) {
        m.physics.distanceM -= loop.toM - loop.fromM;
      } else if (!loop && m.physics.distanceM >= route.lengthM) {
        // Arrivé : le coureur s'arrête sur la ligne.
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

  /** Le coureur le plus proche devant le joueur et le plus proche derrière lui, quand ils existent. */
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

  /** Combien de coureurs sont devant le joueur, et combien derrière. */
  counts(userTraveledM: number): { ahead: number; behind: number } {
    let ahead = 0;
    for (const m of this.members) if (m.traveledM > userTraveledM) ahead++;
    return { ahead, behind: this.members.length - ahead };
  }
}
