// Boucle de jeu : relie le matériel, la physique, les segments, le monde 3D et le HUD.

import type { Trainer, TrainerData } from '../hardware/types';
import { commandChanged } from '../hardware/types';
import { PhysicsEngine, type RiderSetup, trainerCommand, type TrainerCommand } from '../sim/physicsEngine';
import type { Route } from '../sim/route';
import { AutoPause, STOPPED_SPEED_MPS } from '../sim/autoPause';
import { EffortAlerts } from '../sim/effortAlerts';
import { DEFAULT_GEAR, GEAR_COUNT, shiftedGrade } from '../sim/gears';
import { GROUP_WARMUP_S, type GroupOptions, groupRiders } from '../sim/group';
import { botRiders } from '../sim/bots';
import { Peloton, type PelotonGap, type PelotonState } from '../sim/peloton';
import { type RideSample, rideStats, type RideStats } from '../sim/rideStats';
import { powerZone } from '../sim/zones';
import type { GameState } from './rideAutosave';
import { LocalPrStore, type SegmentResult, type SegmentStatus, SegmentTracker } from '../sim/segments';
import { totalDuration, type WorkoutStep, workoutStateAt } from '../sim/workout';
import type { RouteEvent } from '../world/landmarks';

const SIM_INTERVAL_MS = 50;
const START_OFFSET_M = 12;
const MAX_CATCH_UP_S = 2;
/** Fenêtre de la puissance affichée : 3 s, comme les compteurs Garmin. */
const POWER_AVG_MS = 3000;
const STALE_DATA_MS = 3000;
const TRAINER_PERIOD_MS = 1000;
const FORCE_RESEND_MS = 10000;
/** Écart maximal réglable aux boutons ± sur une consigne ERG. */
const ERG_BIAS_MAX_W = 300;
/** Le cycliste sent la pente sous la roue avant : on anticipe d'un demi-empattement. */
const GRADE_LOOKAHEAD_M = 0.5;
/** Pente simulée pendant un effort libre : assez raide pour qu'il faille vraiment appuyer. */
const FREE_EFFORT_GRADE_PCT = 4;
/** Intervalle entre deux points de reprise de la sortie. */
const CHECKPOINT_EVERY_S = 30;
/** Plafond de la puissance verrouillée. */
const LOCK_MAX_W = 2000;

/** Ce que la boucle de jeu demande à l'affichage : un décor 3D, ou rien quand on roule devant un écran. */
export interface GameWorld {
  readonly events: RouteEvent[];
  onBiomeChange: (label: string) => void;
  render(distM: number, cadenceRpm: number, ghostDistM: number | null, dt: number, now: number, peloton?: PelotonState[]): void;
}

/** Les coéquipiers qui encadrent le joueur, avec l'écart en mètres. */
export interface PelotonSnapshot {
  ahead: PelotonGap | null;
  behind: PelotonGap | null;
  /** Sortie en groupe : niveau, effectif, coureurs devant et derrière, et temps d'échauffement restant. */
  group: { wkg: number; riders: number; countAhead: number; countBehind: number; warmupLeftS: number } | null;
}

export interface RideSnapshot {
  elapsedS: number;
  distanceM: number;
  speedKmh: number;
  avgSpeedKmh: number;
  powerW: number;
  avgPowerW: number;
  cadenceRpm: number;
  heartRateBpm: number | null;
  gradePct: number;
  altitudeM: number;
  segments: SegmentStatus[];
  paused: boolean;
  sentGradePct: number;
  workout: WorkoutSnapshot | null;
  /** Vitesse virtuelle engagée, ou null si elles ne sont pas utilisées. */
  gear: number | null;
  /** Tour en cours sur un parcours en boucle, 1 sur les autres. */
  lap: number;
  /** Distance parcourue depuis le départ, tours compris. */
  totalM: number;
  /** Le chrono est arrêté parce que le cycliste ne pédale plus. */
  autoPaused: boolean;
  /** Zone de puissance (1 à 7), ou 0 sans FTP. */
  zone: number;
  peloton: PelotonSnapshot | null;
  /** Puissance verrouillée (mode ERG hors séance), ou null quand la résistance suit la pente. */
  lockedW: number | null;
}

export interface WorkoutSnapshot {
  /** Effort libre en cours : pas de consigne de puissance. */
  free: boolean;
  targetW: number;
  stepLeftS: number;
  elapsedS: number;
  totalS: number;
}

export interface RideSummary {
  elapsedS: number;
  distanceKm: number;
  avgSpeedKmh: number;
  avgPowerW: number;
  maxPowerW: number;
  results: SegmentResult[];
  /** Un point par seconde, pour le récap et l'enregistrement. */
  samples: RideSample[];
  stats: RideStats;
  /** Instant du premier coup de pédale, en millisecondes. */
  startedAt: number;
}

export class Game {
  readonly physics: PhysicsEngine;
  private tracker: SegmentTracker;
  private elapsedS = 0;
  private energyJ = 0;
  private maxPower = 0;
  private paused = false;
  private running = false;
  private finished = false;
  private lastSim = 0;
  private lastFrame = 0;
  private lastData = 0;
  private lastSend = 0;
  private lastSent: TrainerCommand | null = null;
  private lastSentAt = 0;
  private released = false;
  private lastTargetW: number | null = null;
  private freeAnnounced = false;
  private laps = 0;
  private gear = DEFAULT_GEAR;
  private gearsOn = false;
  private trainerSpeedMps: number | null = null;
  private simTimer = 0;
  private rafId = 0;
  private results: SegmentResult[] = [];
  /** Puissance des trois dernières secondes, comme sur un compteur : c'est elle qu'on affiche (la physique et l'enregistrement gardent l'instantanée). */
  private powerWindow: { t: number; w: number }[] = [];
  private shownPowerW = 0;
  private data: Required<Pick<TrainerData, 'powerW' | 'cadenceRpm'>> & { bpm: number | null } = { powerW: 0, cadenceRpm: 0, bpm: null };
  private eventIndex = 0;
  /** Exploration : les sauts fausseraient les temps, les segments sont donc coupés. */
  private exploring = false;
  private frozen = false;
  private samples: RideSample[] = [];
  private nextSampleS = 1;
  private startedAt = 0;
  private autoPause = new AutoPause();
  private alerts = new EffortAlerts();
  /** Réglages du joueur : les alertes d'effort et la pause automatique se coupent dans les options. */
  alertsOn = true;
  autoPauseOn = true;
  private peloton: Peloton | null = null;
  private groupOptions: GroupOptions | null = null;
  /** Les fantômes choisis avant la sortie, qui tiennent chacun leur niveau. */
  private bots: Peloton | null = null;
  /** Puissance imposée au home trainer, hors séance : la résistance ne suit plus la pente. */
  private lockedW: number | null = null;
  /** Décalage réglé aux boutons ± sur les paliers ERG de la séance. */
  private ergBiasW = 0;
  private sending = false;
  private sendAgain = false;
  /** Distance parcourue par seconde de la sortie de référence, pour courir contre soi-même. */
  private reference: number[] | null = null;
  /** Facteur 0..1 appliqué à la pente envoyée au frein. */
  difficulty = 1;

  onFrame: (s: RideSnapshot) => void = () => {};
  /** Appelé toutes les 30 secondes de sortie : de quoi reprendre la sortie après une coupure. */
  onCheckpoint: (state: GameState, samples: RideSample[]) => void = () => {};
  onToast: (text: string) => void = () => {};
  onSegmentDone: (r: SegmentResult) => void = () => {};
  onFinish: (s: RideSummary) => void = () => {};
  onTrainerError: (message: string) => void = () => {};

  constructor(
    private route: Route,
    private world: GameWorld,
    private trainer: Trainer,
    setup: RiderSetup,
    bikeShape = 'route',
    private workout: WorkoutStep[] | null = null,
    private ftp = 250,
  ) {
    this.physics = new PhysicsEngine({ ...setup, latitudeDeg: route.data.origin.lat });
    // La route commence au premier point du tracé : il faut de l'asphalte derrière la caméra.
    this.physics.distanceM = route.data.loop ? route.data.loop.fromM : START_OFFSET_M;
    this.tracker = new SegmentTracker(route.data.segments, new LocalPrStore(bikeShape));
    this.trainer.onData = (d) => this.receive(d);
    this.world.onBiomeChange = (label) => this.onToast(label);
  }

  /** Reçoit aussi les données d'un capteur cardio séparé. */
  receive(d: TrainerData): void {
    this.lastData = performance.now();
    if (d.powerW !== undefined) this.data.powerW = Math.max(0, d.powerW);
    if (d.cadenceRpm !== undefined) this.data.cadenceRpm = d.cadenceRpm;
    if (d.trainerSpeedMps !== undefined) this.trainerSpeedMps = d.trainerSpeedMps;
    if (d.heartRateBpm !== undefined) this.data.bpm = d.heartRateBpm;
  }

  receiveHeartRate(bpm: number): void {
    this.data.bpm = bpm;
  }

  start(): void {
    this.running = true;
    this.lastSim = performance.now();
    this.lastFrame = this.lastSim;
    // setInterval plutôt que requestAnimationFrame : la simulation doit continuer
    // si la fenêtre passe en arrière-plan pendant la sortie.
    this.simTimer = window.setInterval(() => this.simulate(), SIM_INTERVAL_MS);
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  /** Fait rouler quatre coéquipiers de niveaux différents, à partir de la position actuelle. */
  enablePeloton(): void {
    const { route } = this;
    const start = this.physics.distanceM;
    this.peloton = new Peloton(
      { lengthM: route.lengthM, loop: route.data.loop, gradeAt: (d) => route.gradeAt(d), eleAt: (d) => route.eleAt(d) },
      this.physics.setup,
      this.ftp,
      start,
      this.traveledM(start),
    );
  }

  /** Fait rouler un groupe de dix ou quinze coureurs aux watts par kilo choisis, à partir de la position actuelle. */
  enableGroup(options: GroupOptions): void {
    const { route } = this;
    const start = this.physics.distanceM;
    this.groupOptions = options;
    this.peloton = new Peloton(
      { lengthM: route.lengthM, loop: route.data.loop, gradeAt: (d) => route.gradeAt(d), eleAt: (d) => route.eleAt(d) },
      this.physics.setup,
      this.ftp,
      start,
      this.traveledM(start),
      groupRiders(options),
      GROUP_WARMUP_S,
    );
  }

  /** Fait rouler des fantômes (leurs niveaux en W/kg) à partir de la position actuelle, avec le vélo et le poids du joueur. */
  enableBots(wkgs: number[]): void {
    if (wkgs.length === 0) return;
    const { route } = this;
    const start = this.physics.distanceM;
    this.bots = new Peloton(
      { lengthM: route.lengthM, loop: route.data.loop, gradeAt: (d) => route.gradeAt(d), eleAt: (d) => route.eleAt(d) },
      this.physics.setup,
      this.ftp,
      start,
      this.traveledM(start),
      botRiders(wkgs, this.physics.setup.riderKg),
    );
  }

  /** Une sortie passée sur ce parcours : un fantôme la rejoue, tant qu'aucun record de segment ne prend le relais. */
  setReference(samples: RideSample[] | null): void {
    this.reference = samples && samples.length > 1 ? samples.map((s) => s.distanceM) : null;
  }

  private referenceDistance(timeS: number): number | null {
    const ref = this.reference;
    if (!ref || timeS <= 0) return null;
    const last = ref.length - 1;
    if (timeS >= last + 1) return null;
    if (timeS < 1) return START_OFFSET_M + (ref[0] - START_OFFSET_M) * timeS;
    const i = Math.floor(timeS) - 1;
    return ref[i] + (ref[Math.min(last, i + 1)] - ref[i]) * (timeS - Math.floor(timeS));
  }

  /** Sauvegarde tout de suite, par exemple quand on quitte la sortie avant la fin. */
  saveNow(): void {
    if (!this.finished && this.elapsedS > 0) this.onCheckpoint(this.state(), this.samples);
  }

  /** État à sauvegarder pour reprendre la sortie plus tard. */
  state(): GameState {
    return {
      elapsedS: this.elapsedS,
      energyJ: this.energyJ,
      maxPowerW: this.maxPower,
      distanceM: this.physics.distanceM,
      laps: this.laps,
      startedAt: this.startedAt,
    };
  }

  /** Reprend une sortie interrompue : le chrono, les points et la position repartent d'où ils étaient. */
  restore(state: GameState, samples: RideSample[]): void {
    this.elapsedS = state.elapsedS;
    this.energyJ = state.energyJ;
    this.maxPower = state.maxPowerW;
    this.laps = state.laps;
    this.startedAt = state.startedAt;
    this.samples = samples;
    this.nextSampleS = samples.length + 1;
    this.physics.distanceM = state.distanceM;
    this.physics.speedMps = 0;
    this.tracker.restartAt(state.distanceM, state.elapsedS);
    const ev = this.world.events;
    this.eventIndex = ev.findIndex((e) => e.distM > state.distanceM);
    if (this.eventIndex < 0) this.eventIndex = ev.length;
    // Le chrono repart au premier coup de pédale.
    this.autoPause.paused = true;
    this.onToast('Sortie reprise : pédale pour repartir');
  }

  togglePause(): boolean {
    this.paused = !this.paused;
    this.lastSim = performance.now();
    return this.paused;
  }

  /** Pignon fixe : la résistance suit désormais la vitesse virtuelle. */
  enableGears(): void {
    this.gearsOn = true;
  }

  /** Puissance verrouillée, ou null. */
  get lockedPowerW(): number | null {
    return this.lockedW;
  }

  /**
   * Verrouille les watts à ceux du moment, ou les libère : le home trainer passe en ERG à cette puissance, puis revient à
   * la résistance de la pente. Sans effet pendant une séance, qui impose déjà sa puissance.
   */
  toggleLock(): void {
    if (this.workout && !this.inFreeStep()) return;
    if (this.lockedW !== null) {
      this.lockedW = null;
      this.lastSent = null;
      this.lastSentAt = 0;
      this.flush();
      this.onToast('Watts libérés : la résistance suit de nouveau la pente');
      return;
    }
    const watts = Math.round(this.data.powerW);
    if (watts < 1) {
      this.onToast('Pédale d’abord : les watts se verrouillent à ceux du moment');
      return;
    }
    this.setLock(watts);
    this.onToast(`Watts verrouillés à ${watts} W`);
  }

  /** Monte ou descend la puissance verrouillée (1 W par pas). */
  adjustLock(deltaW: number): void {
    // Pendant un palier ERG, les boutons montent ou descendent la consigne de la séance.
    if (this.workout && !this.inFreeStep()) {
      this.adjustErgBias(deltaW);
      return;
    }
    if (this.lockedW === null) {
      this.onToast('Verrouille d’abord les watts (touche L, ou bouton Y de la manette de droite)');
      return;
    }
    this.setLock(Math.max(1, Math.min(LOCK_MAX_W, this.lockedW + deltaW)));
  }

  private setLock(watts: number): void {
    this.lockedW = watts;
    this.lastTargetW = null;
    this.flush();
  }

  /** Vrai quand les boutons ± règlent une puissance : le verrou, ou la consigne d'un palier ERG. */
  get powerAdjustable(): boolean {
    return this.lockedW !== null || (this.workout !== null && !this.inFreeStep());
  }

  /** Décale d'un watt par appui la consigne de tous les paliers ERG de la séance. */
  private adjustErgBias(deltaW: number): void {
    this.ergBiasW = Math.max(-ERG_BIAS_MAX_W, Math.min(ERG_BIAS_MAX_W, this.ergBiasW + deltaW));
    this.lastTargetW = null;
    const state = this.workout ? workoutStateAt(this.workout, this.elapsedS) : null;
    const sign = this.ergBiasW > 0 ? '+' : '';
    this.onToast(`Consigne ${state ? this.ergTargetW(state.targetPct) : '--'} W (${sign}${this.ergBiasW} W)`);
    this.flush();
  }

  private ergTargetW(targetPct: number): number {
    const base = Math.round((targetPct / 100) * this.ftp);
    return base > 0 ? Math.max(1, base + this.ergBiasW) : base;
  }

  /** Une séance est en cours et son palier actuel est un effort libre. */
  private inFreeStep(): boolean {
    return this.workout !== null && workoutStateAt(this.workout, this.elapsedS)?.step.free === true;
  }

  shift(delta: number): void {
    // Les vitesses n'existent qu'hors séance, ou pendant un effort libre : un palier ERG impose déjà la puissance.
    if (this.workout && !this.inFreeStep()) return;
    this.enableGears();
    this.gear = Math.max(1, Math.min(GEAR_COUNT, this.gear + delta));
    this.flush();
  }

  /**
   * Envoie tout de suite la consigne au home trainer, sans attendre le prochain envoi périodique. Si une écriture est
   * encore en cours, la suivante part dès qu'elle est finie, avec la valeur la plus récente : les appuis rapides ne
   * s'empilent pas.
   */
  private flush(): void {
    if (this.sending) {
      this.sendAgain = true;
      return;
    }
    this.sending = true;
    const now = performance.now();
    this.lastSend = now;
    void this.sendToTrainer(Math.min(this.physics.distanceM, this.route.lengthM), now).finally(() => {
      this.sending = false;
      if (this.sendAgain) {
        this.sendAgain = false;
        this.flush();
      }
    });
  }

  private startExploring(): void {
    if (this.exploring) return;
    this.exploring = true;
    this.onToast('Exploration : temps de segment et records désactivés pour cette sortie');
  }

  /** Fige la simulation pendant que la caméra libre se promène. */
  setFrozen(frozen: boolean): void {
    if (frozen) this.startExploring();
    this.frozen = frozen;
    this.lastSim = performance.now();
  }

  jumpTo(distM: number): void {
    this.startExploring();
    const d = Math.max(0, Math.min(this.route.lengthM, distM));
    this.physics.distanceM = d;
    this.physics.speedMps = 0;
    const ev = this.world.events;
    this.eventIndex = ev.findIndex((e) => e.distM > d);
    if (this.eventIndex < 0) this.eventIndex = ev.length;
  }

  get distanceM(): number {
    return Math.min(this.physics.distanceM, this.route.lengthM);
  }

  private simulate(): void {
    const now = performance.now();
    const dt = Math.min(MAX_CATCH_UP_S, (now - this.lastSim) / 1000);
    this.lastSim = now;
    if (this.paused || this.finished || this.frozen) return;

    if (now - this.lastData > STALE_DATA_MS) {
      this.data.powerW = 0;
      this.data.cadenceRpm = 0;
    }
    const d = this.physics.distanceM;
    const power = this.data.powerW;
    this.powerWindow.push({ t: now, w: power });
    while (this.powerWindow.length > 1 && now - this.powerWindow[0].t > POWER_AVG_MS) this.powerWindow.shift();
    this.shownPowerW = this.powerWindow.reduce((sum, p) => sum + p.w, 0) / this.powerWindow.length;
    this.physics.advance(dt, { powerW: power, gradePct: this.route.gradeAt(d), altitudeM: this.route.eleAt(d) });

    // Le chrono part au premier coup de pédale, et s'arrête quand on s'arrête vraiment.
    if (this.elapsedS > 0 || power > 0 || this.physics.speedMps > 0) {
      const pedalling = power > 0 || this.data.cadenceRpm > 0;
      const change = this.autoPauseOn ? this.autoPause.update(dt, pedalling, this.physics.speedMps > STOPPED_SPEED_MPS) : null;
      if (change === 'pause') this.onToast('Pause automatique : le chrono repart quand tu pédales');
      else if (change === 'resume') this.onToast('C’est reparti');
      if (!this.autoPause.paused) {
        if (this.startedAt === 0) this.startedAt = Date.now();
        this.elapsedS += dt;
        this.energyJ += power * dt;
        this.maxPower = Math.max(this.maxPower, power);
      }
      this.peloton?.advance(dt, { distM: this.physics.distanceM, traveledM: this.traveledM(this.physics.distanceM), speedMps: this.physics.speedMps });
      this.bots?.advance(dt);
    }

    const dist = Math.min(this.physics.distanceM, this.route.lengthM);
    this.record(dist);
    if (!this.exploring) {
      for (const r of this.tracker.update(dist, this.elapsedS)) {
        this.results.push(r);
        this.onSegmentDone(r);
      }
    }
    this.fireEvents(dist);
    if (now - this.lastSend >= TRAINER_PERIOD_MS) this.flush();
    if (this.workout && this.elapsedS >= totalDuration(this.workout)) {
      this.finish();
      return;
    }
    if (dist >= this.route.lengthM) {
      if (this.route.data.loop) this.wrapLap();
      else if (this.exploring) this.jumpTo(this.route.lengthM);
      else this.finish();
    }
  }

  /** Garde un point par seconde de sortie. */
  private record(dist: number): void {
    while (this.elapsedS >= this.nextSampleS) {
      this.samples.push({
        t: this.nextSampleS,
        distanceM: this.traveledM(dist),
        powerW: this.data.powerW,
        cadenceRpm: this.data.cadenceRpm,
        heartRateBpm: this.data.bpm,
        altitudeM: this.route.eleAt(dist),
        speedKmh: this.physics.speedMps * 3.6,
      });
      const alert = this.alertsOn ? this.alerts.update({ powerW: this.data.powerW, cadenceRpm: this.data.cadenceRpm }, this.ftp, this.workout !== null) : null;
      if (alert) this.onToast(alert);
      if (this.nextSampleS % CHECKPOINT_EVERY_S === 0) this.onCheckpoint(this.state(), this.samples);
      this.nextSampleS++;
    }
  }

  /** Termine la sortie à la demande du cycliste : le récap s'affiche comme à l'arrivée. */
  end(): void {
    if (!this.finished) this.finish();
  }

  /** Fin du tour : le cycliste reprend au départ, là où la route se raccorde exactement à son arrivée. */
  private wrapLap(): void {
    const loop = this.route.data.loop!;
    this.laps++;
    this.physics.distanceM -= loop.toM - loop.fromM;
    this.tracker.restartAt(loop.fromM, this.elapsedS);
    const ev = this.world.events;
    this.eventIndex = ev.findIndex((e) => e.distM > this.physics.distanceM);
    if (this.eventIndex < 0) this.eventIndex = ev.length;
  }

  /** Distance parcourue depuis le départ, tours compris. */
  private traveledM(dist: number): number {
    const loop = this.route.data.loop;
    return loop ? this.laps * (loop.toM - loop.fromM) + dist - loop.fromM : dist;
  }

  private fireEvents(dist: number): void {
    const ev = this.world.events;
    while (this.eventIndex < ev.length && ev[this.eventIndex].distM <= dist) {
      this.onToast(ev[this.eventIndex].text);
      this.eventIndex++;
    }
  }

  private async sendToTrainer(dist: number, now: number): Promise<void> {
    if (this.workout) {
      const state = workoutStateAt(this.workout, this.elapsedS);
      if (!state?.step.free) {
        this.freeAnnounced = false;
        // Fin de l'effort libre : le verrou tombe et l'ERG reprend normalement.
        if (this.lockedW !== null) {
          this.lockedW = null;
          this.lastTargetW = null;
        }
        await this.sendWorkoutTarget();
        return;
      }
      // Effort libre : le home trainer suit une pente fixe (c'est la cadence et la vitesse qui règlent l'effort),
      // ou une puissance verrouillée.
      if (!this.freeAnnounced) {
        this.freeAnnounced = true;
        this.lastTargetW = null;
        this.onToast('Effort libre : tiens la puissance la plus haute possible jusqu’au bout');
      }
      if (this.lockedW !== null) {
        await this.sendTarget(this.lockedW);
        return;
      }
      await this.sendFreeGrade(now);
      return;
    }
    if (this.lockedW !== null) {
      await this.sendTarget(this.lockedW);
      return;
    }
    const road = trainerCommand(
      this.route.gradeAt(dist + GRADE_LOOKAHEAD_M),
      this.route.eleAt(dist),
      this.physics.setup,
      this.difficulty,
    );
    const cmd = this.gearsOn ? { ...road, gradePct: this.gearedGrade(road) } : road;
    if (!commandChanged(this.lastSent, cmd) && now - this.lastSentAt < FORCE_RESEND_MS) return;
    this.lastSent = cmd;
    this.lastSentAt = now;
    try {
      await this.trainer.setSimulation(cmd);
    } catch (err) {
      this.onTrainerError(err instanceof Error ? err.message : String(err));
    }
  }

  private async sendFreeGrade(now: number): Promise<void> {
    const road = trainerCommand(FREE_EFFORT_GRADE_PCT, this.route.eleAt(this.distanceM), this.physics.setup, this.difficulty);
    const cmd = this.gearsOn ? { ...road, gradePct: this.gearedGrade(road) } : road;
    if (!commandChanged(this.lastSent, cmd) && now - this.lastSentAt < FORCE_RESEND_MS) return;
    this.lastSent = cmd;
    this.lastSentAt = now;
    try {
      await this.trainer.setSimulation(cmd);
    } catch (err) {
      this.onTrainerError(err instanceof Error ? err.message : String(err));
    }
  }

  private gearedGrade(road: TrainerCommand): number {
    const { riderKg, bikeKg, wheelRadiusM } = this.physics.setup;
    return shiftedGrade({
      gradePct: road.gradePct,
      gear: this.gear,
      cadenceRpm: this.data.cadenceRpm,
      trainerSpeedMps: this.trainerSpeedMps,
      totalKg: riderKg + bikeKg,
      crr: road.crr,
      cwKgPerM: road.cwKgPerM,
      wheelRadiusM,
    });
  }

  private async sendWorkoutTarget(): Promise<void> {
    const state = workoutStateAt(this.workout!, this.elapsedS);
    if (!state) return;
    await this.sendTarget(this.ergTargetW(state.targetPct));
  }

  /** Impose une puissance au home trainer (mode ERG). */
  private async sendTarget(watts: number): Promise<void> {
    // Comme en simulation, la cible est renvoyée de temps en temps : après une coupure Bluetooth ou une
    // commande perdue, le home trainer reprend la bonne puissance au lieu de rester sur l'ancienne.
    const now = performance.now();
    if (watts === this.lastTargetW && now - this.lastSentAt < FORCE_RESEND_MS) return;
    this.lastTargetW = watts;
    this.lastSentAt = now;
    try {
      await this.trainer.setTargetPower(watts);
    } catch (err) {
      this.lastTargetW = null;
      this.onTrainerError(err instanceof Error ? err.message : String(err));
    }
  }

  private workoutSnapshot(): WorkoutSnapshot | null {
    if (!this.workout) return null;
    const state = workoutStateAt(this.workout, this.elapsedS);
    const free = state?.step.free === true;
    return {
      free,
      targetW: state && !free ? this.ergTargetW(state.targetPct) : 0,
      stepLeftS: state ? state.stepLeftS : 0,
      elapsedS: this.elapsedS,
      totalS: totalDuration(this.workout),
    };
  }

  private finish(): void {
    this.finished = true;
    this.stop();
    const covered = this.traveledM(this.distanceM);
    const summary: RideSummary = {
      elapsedS: this.elapsedS,
      distanceKm: covered / 1000,
      avgSpeedKmh: this.elapsedS > 0 ? (covered / this.elapsedS) * 3.6 : 0,
      avgPowerW: this.elapsedS > 0 ? this.energyJ / this.elapsedS : 0,
      maxPowerW: this.maxPower,
      results: this.results,
      samples: this.samples,
      stats: rideStats(this.samples, this.ftp),
      startedAt: this.startedAt || Date.now(),
    };
    this.onFinish(summary);
  }

  private frame(time: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    const dist = Math.min(this.physics.distanceM, this.route.lengthM);
    const ghost = this.exploring ? null : (this.tracker.ghostDistance(this.elapsedS) ?? this.referenceDistance(this.elapsedS));
    this.world.render(dist, this.paused ? 0 : this.data.cadenceRpm, ghost, dt, time, [...(this.peloton?.states() ?? []), ...(this.bots?.states() ?? [])]);
    this.onFrame(this.snapshot(dist));
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  private snapshot(dist: number): RideSnapshot {
    const e = this.elapsedS;
    return {
      elapsedS: e,
      distanceM: dist,
      speedKmh: this.physics.speedMps * 3.6,
      avgSpeedKmh: e > 1 && !this.exploring ? (this.traveledM(dist) / e) * 3.6 : 0,
      powerW: this.shownPowerW,
      avgPowerW: e > 1 ? this.energyJ / e : 0,
      cadenceRpm: this.data.cadenceRpm,
      heartRateBpm: this.data.bpm,
      gradePct: this.route.gradeAt(dist),
      altitudeM: this.route.eleAt(dist),
      segments: this.exploring ? [] : this.tracker.status(dist, e),
      paused: this.paused,
      sentGradePct: this.lastSent?.gradePct ?? 0,
      workout: this.workoutSnapshot(),
      gear: this.gearsOn && (!this.workout || this.inFreeStep()) ? this.gear : null,
      lap: this.laps + 1,
      totalM: this.traveledM(dist),
      autoPaused: this.autoPause.paused,
      zone: powerZone(this.shownPowerW, this.ftp),
      peloton: this.peloton || this.bots ? this.pelotonSnapshot(this.traveledM(dist)) : null,
      lockedW: this.lockedW,
    };
  }

  /** Le coéquipier ou le fantôme le plus proche devant, et le plus proche derrière. */
  private pelotonSnapshot(traveledM: number): PelotonSnapshot {
    const group = this.groupOptions;
    const peloton = this.peloton;
    const a = peloton?.neighbours(traveledM);
    const b = this.bots?.neighbours(traveledM);
    const nearest = (x: PelotonGap | null | undefined, y: PelotonGap | null | undefined, sign: 1 | -1): PelotonGap | null => {
      if (!x) return y ?? null;
      if (!y) return x;
      return sign * x.gapM <= sign * y.gapM ? x : y;
    };
    return {
      ahead: nearest(a?.ahead, b?.ahead, 1),
      behind: nearest(a?.behind, b?.behind, -1),
      group:
        group && peloton
          ? { wkg: group.wkg, riders: group.riders, warmupLeftS: Math.max(0, GROUP_WARMUP_S - peloton.clockS), countAhead: peloton.counts(traveledM).ahead, countBehind: peloton.counts(traveledM).behind }
          : null,
    };
  }

  /** État actuel de la sortie, pour un affichage qui ne dépend pas du rythme de l'écran. */
  currentSnapshot(): RideSnapshot {
    return this.snapshot(Math.min(this.physics.distanceM, this.route.lengthM));
  }

  stop(): void {
    this.running = false;
    clearInterval(this.simTimer);
    cancelAnimationFrame(this.rafId);
    // Une séance laisse le frein sur sa dernière puissance imposée : on le rend libre, pour finir en roue libre
    // au lieu de pédaler contre un effort que la séance n'ordonne plus.
    if ((this.workout || this.lockedW !== null) && !this.released) {
      this.released = true;
      const free = trainerCommand(0, 0, this.physics.setup, 1);
      void this.trainer.setSimulation(free).catch(() => {});
    }
  }
}
