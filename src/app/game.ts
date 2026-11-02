// Boucle de jeu : relie le matériel, la physique, les segments, le monde 3D et le HUD.

import type { Trainer, TrainerData } from '../hardware/types';
import { commandChanged } from '../hardware/types';
import { PhysicsEngine, type RiderSetup, trainerCommand, type TrainerCommand } from '../sim/physicsEngine';
import type { Route } from '../sim/route';
import { AutoPause, STOPPED_SPEED_MPS } from '../sim/autoPause';
import { EffortAlerts } from '../sim/effortAlerts';
import { DEFAULT_GEAR, GEAR_COUNT, shiftedGrade } from '../sim/gears';
import { GROUP_WARMUP_S, type GroupOptions, groupRiders } from '../sim/group';
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
const STALE_DATA_MS = 3000;
const TRAINER_PERIOD_MS = 1000;
const FORCE_RESEND_MS = 10000;
/** Le cycliste sent la pente sous la roue avant : on anticipe d'un demi-empattement. */
const GRADE_LOOKAHEAD_M = 0.5;
/** Intervalle entre deux points de reprise de la sortie. */
const CHECKPOINT_EVERY_S = 30;

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
}

export interface WorkoutSnapshot {
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
  private lastTargetW: number | null = null;
  private laps = 0;
  private gear = DEFAULT_GEAR;
  private gearsOn = false;
  private trainerSpeedMps: number | null = null;
  private simTimer = 0;
  private rafId = 0;
  private results: SegmentResult[] = [];
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
  private peloton: Peloton | null = null;
  private groupOptions: GroupOptions | null = null;
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

  shift(delta: number): void {
    if (this.workout) return;
    this.enableGears();
    this.gear = Math.max(1, Math.min(GEAR_COUNT, this.gear + delta));
    this.lastSend = 0;
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
    this.physics.advance(dt, { powerW: power, gradePct: this.route.gradeAt(d), altitudeM: this.route.eleAt(d) });

    // Le chrono part au premier coup de pédale, et s'arrête quand on s'arrête vraiment.
    if (this.elapsedS > 0 || power > 0 || this.physics.speedMps > 0) {
      const pedalling = power > 0 || this.data.cadenceRpm > 0;
      const change = this.autoPause.update(dt, pedalling, this.physics.speedMps > STOPPED_SPEED_MPS);
      if (change === 'pause') this.onToast('Pause automatique : le chrono repart quand tu pédales');
      else if (change === 'resume') this.onToast('C’est reparti');
      if (!this.autoPause.paused) {
        if (this.startedAt === 0) this.startedAt = Date.now();
        this.elapsedS += dt;
        this.energyJ += power * dt;
        this.maxPower = Math.max(this.maxPower, power);
      }
      this.peloton?.advance(dt);
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
    if (now - this.lastSend >= TRAINER_PERIOD_MS) {
      this.lastSend = now;
      void this.sendToTrainer(dist, now);
    }
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
      const alert = this.alerts.update({ powerW: this.data.powerW, cadenceRpm: this.data.cadenceRpm }, this.ftp, this.workout !== null);
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
      await this.sendWorkoutTarget();
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
    const watts = Math.round((state.targetPct / 100) * this.ftp);
    if (watts === this.lastTargetW) return;
    this.lastTargetW = watts;
    try {
      await this.trainer.setTargetPower(watts);
    } catch (err) {
      this.onTrainerError(err instanceof Error ? err.message : String(err));
    }
  }

  private workoutSnapshot(): WorkoutSnapshot | null {
    if (!this.workout) return null;
    const state = workoutStateAt(this.workout, this.elapsedS);
    return {
      targetW: state ? Math.round((state.targetPct / 100) * this.ftp) : 0,
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
    this.world.render(dist, this.paused ? 0 : this.data.cadenceRpm, ghost, dt, time, this.peloton?.states());
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
      powerW: this.data.powerW,
      avgPowerW: e > 1 ? this.energyJ / e : 0,
      cadenceRpm: this.data.cadenceRpm,
      heartRateBpm: this.data.bpm,
      gradePct: this.route.gradeAt(dist),
      altitudeM: this.route.eleAt(dist),
      segments: this.exploring ? [] : this.tracker.status(dist, e),
      paused: this.paused,
      sentGradePct: this.lastSent?.gradePct ?? 0,
      workout: this.workoutSnapshot(),
      gear: this.gearsOn && !this.workout ? this.gear : null,
      lap: this.laps + 1,
      totalM: this.traveledM(dist),
      autoPaused: this.autoPause.paused,
      zone: powerZone(this.data.powerW, this.ftp),
      peloton: this.peloton ? this.pelotonSnapshot(this.peloton, this.traveledM(dist)) : null,
    };
  }

  private pelotonSnapshot(peloton: Peloton, traveledM: number): PelotonSnapshot {
    const group = this.groupOptions;
    return {
      ...peloton.neighbours(traveledM),
      group: group
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
  }
}
