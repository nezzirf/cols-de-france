// Boucle de jeu : relie le matériel, la physique, les segments, le monde 3D et le HUD.

import type { Trainer, TrainerData } from '../hardware/types';
import { commandChanged } from '../hardware/types';
import { PhysicsEngine, type RiderSetup, trainerCommand, type TrainerCommand } from '../sim/physicsEngine';
import type { Route } from '../sim/route';
import { LocalPrStore, type SegmentResult, type SegmentStatus, SegmentTracker } from '../sim/segments';
import type { World } from '../world/scene';

const SIM_INTERVAL_MS = 50;
const START_OFFSET_M = 12;
const MAX_CATCH_UP_S = 2;
const STALE_DATA_MS = 3000;
const TRAINER_PERIOD_MS = 1000;
const FORCE_RESEND_MS = 10000;
/** Le cycliste sent la pente sous la roue avant : on anticipe d'un demi-empattement. */
const GRADE_LOOKAHEAD_M = 0.5;

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
}

export interface RideSummary {
  elapsedS: number;
  distanceKm: number;
  avgSpeedKmh: number;
  avgPowerW: number;
  maxPowerW: number;
  results: SegmentResult[];
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
  private simTimer = 0;
  private rafId = 0;
  private results: SegmentResult[] = [];
  private data: Required<Pick<TrainerData, 'powerW' | 'cadenceRpm'>> & { bpm: number | null } = { powerW: 0, cadenceRpm: 0, bpm: null };
  private eventIndex = 0;
  /** Exploration : les sauts fausseraient les temps, les segments sont donc coupés. */
  private exploring = false;
  private frozen = false;
  /** Facteur 0..1 appliqué à la pente envoyée au frein. */
  difficulty = 1;

  onFrame: (s: RideSnapshot) => void = () => {};
  onToast: (text: string) => void = () => {};
  onSegmentDone: (r: SegmentResult) => void = () => {};
  onFinish: (s: RideSummary) => void = () => {};
  onTrainerError: (message: string) => void = () => {};

  constructor(
    private route: Route,
    private world: World,
    private trainer: Trainer,
    setup: RiderSetup,
    bikeShape = 'route',
  ) {
    this.physics = new PhysicsEngine({ ...setup, latitudeDeg: route.data.origin.lat });
    // La route commence au premier point du tracé : il faut de l'asphalte derrière la caméra.
    this.physics.distanceM = START_OFFSET_M;
    this.tracker = new SegmentTracker(route.data.segments, new LocalPrStore(bikeShape));
    this.trainer.onData = (d) => this.receive(d);
    this.world.onBiomeChange = (label) => this.onToast(label);
  }

  /** Reçoit aussi les données d'un capteur cardio séparé. */
  receive(d: TrainerData): void {
    this.lastData = performance.now();
    if (d.powerW !== undefined) this.data.powerW = Math.max(0, d.powerW);
    if (d.cadenceRpm !== undefined) this.data.cadenceRpm = d.cadenceRpm;
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

  togglePause(): boolean {
    this.paused = !this.paused;
    this.lastSim = performance.now();
    return this.paused;
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

    // Le chrono part au premier coup de pédale.
    if (this.elapsedS > 0 || power > 0 || this.physics.speedMps > 0) {
      this.elapsedS += dt;
      this.energyJ += power * dt;
      this.maxPower = Math.max(this.maxPower, power);
    }

    const dist = Math.min(this.physics.distanceM, this.route.lengthM);
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
    if (dist >= this.route.lengthM) {
      if (this.exploring) this.jumpTo(this.route.lengthM);
      else this.finish();
    }
  }

  private fireEvents(dist: number): void {
    const ev = this.world.events;
    while (this.eventIndex < ev.length && ev[this.eventIndex].distM <= dist) {
      this.onToast(ev[this.eventIndex].text);
      this.eventIndex++;
    }
  }

  private async sendToTrainer(dist: number, now: number): Promise<void> {
    const cmd = trainerCommand(
      this.route.gradeAt(dist + GRADE_LOOKAHEAD_M),
      this.route.eleAt(dist),
      this.physics.setup,
      this.difficulty,
    );
    if (!commandChanged(this.lastSent, cmd) && now - this.lastSentAt < FORCE_RESEND_MS) return;
    this.lastSent = cmd;
    this.lastSentAt = now;
    try {
      await this.trainer.setSimulation(cmd);
    } catch (err) {
      this.onTrainerError(err instanceof Error ? err.message : String(err));
    }
  }

  private finish(): void {
    this.finished = true;
    this.stop();
    const summary: RideSummary = {
      elapsedS: this.elapsedS,
      distanceKm: this.route.lengthM / 1000,
      avgSpeedKmh: (this.route.lengthM / this.elapsedS) * 3.6,
      avgPowerW: this.energyJ / this.elapsedS,
      maxPowerW: this.maxPower,
      results: this.results,
    };
    this.onFinish(summary);
  }

  private frame(time: number): void {
    if (!this.running) return;
    const dt = Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    const dist = Math.min(this.physics.distanceM, this.route.lengthM);
    const ghost = this.exploring ? null : this.tracker.ghostDistance(this.elapsedS);
    this.world.render(dist, this.paused ? 0 : this.data.cadenceRpm, ghost, dt, time);
    this.onFrame(this.snapshot(dist));
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  private snapshot(dist: number): RideSnapshot {
    const e = this.elapsedS;
    return {
      elapsedS: e,
      distanceM: dist,
      speedKmh: this.physics.speedMps * 3.6,
      avgSpeedKmh: e > 1 && !this.exploring ? (dist / e) * 3.6 : 0,
      powerW: this.data.powerW,
      avgPowerW: e > 1 ? this.energyJ / e : 0,
      cadenceRpm: this.data.cadenceRpm,
      heartRateBpm: this.data.bpm,
      gradePct: this.route.gradeAt(dist),
      altitudeM: this.route.eleAt(dist),
      segments: this.exploring ? [] : this.tracker.status(dist, e),
      paused: this.paused,
      sentGradePct: this.lastSent?.gradePct ?? 0,
    };
  }

  stop(): void {
    this.running = false;
    clearInterval(this.simTimer);
    cancelAnimationFrame(this.rafId);
  }
}
