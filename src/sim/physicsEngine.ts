// Moteur physique : équation du mouvement longitudinal d'un cycliste.
//
//   m_eff · dv/dt = F_motrice - F_gravité - F_roulement - F_aéro - F_paliers
//
// La masse effective inclut l'inertie de rotation des roues, la densité de l'air suit
// l'atmosphère standard (donc l'altitude) et la gravité varie avec latitude et altitude.

export interface RiderSetup {
  riderKg: number;
  bikeKg: number;
  /** Surface frontale × coefficient de traînée (m²). 0,32 : mains sur les cocottes. */
  cda: number;
  /** Coefficient de roulement. 0,0040 : pneus route sur bon bitume. */
  crr: number;
  /** Rendement de la transmission (Martin et al. 1998 : ≈ 0,976). */
  drivetrainEfficiency: number;
  /** Moment d'inertie cumulé des deux roues (kg·m²). */
  wheelInertia: number;
  wheelRadiusM: number;
  /** Vent de face positif (m/s). */
  headwindMps: number;
  /** Température au niveau de la mer (°C). */
  temperatureC: number;
  latitudeDeg: number;
}

export const DEFAULT_SETUP: RiderSetup = {
  riderKg: 75,
  bikeKg: 8.5,
  cda: 0.32,
  crr: 0.004,
  drivetrainEfficiency: 0.976,
  wheelInertia: 0.28,
  wheelRadiusM: 0.335,
  headwindMps: 0,
  temperatureC: 15,
  latitudeDeg: 45,
};

const LAPSE_RATE = 0.0065; // K/m
const SEA_PRESSURE = 101325; // Pa
const GAS_CONSTANT_AIR = 287.05; // J/(kg·K)
const BAROMETRIC_EXPONENT = 5.25588;
const BEARING_DRAG_N = 0.09; // paliers et moyeux
const TRACTION_MU = 0.6;

/** Densité de l'air (kg/m³) en atmosphère standard. */
export function airDensity(altitudeM: number, temperatureC = 15): number {
  const t0 = temperatureC + 273.15;
  const t = t0 - LAPSE_RATE * altitudeM;
  const pressure = SEA_PRESSURE * Math.pow(1 - (LAPSE_RATE * altitudeM) / t0, BAROMETRIC_EXPONENT);
  return pressure / (GAS_CONSTANT_AIR * t);
}

/** Pesanteur (m/s²) : formule de Somigliana avec correction à l'air libre. */
export function gravity(latitudeDeg: number, altitudeM: number): number {
  const s = Math.sin((latitudeDeg * Math.PI) / 180) ** 2;
  const g0 = (9.7803253359 * (1 + 0.00193185265 * s)) / Math.sqrt(1 - 0.00669437999 * s);
  return g0 - 3.086e-6 * altitudeM;
}

export function totalMass(setup: RiderSetup): number {
  return setup.riderKg + setup.bikeKg;
}

export function effectiveMass(setup: RiderSetup): number {
  return totalMass(setup) + setup.wheelInertia / setup.wheelRadiusM ** 2;
}

export interface Forces {
  gravity: number;
  rolling: number;
  aero: number;
  bearings: number;
  total: number;
}

/** Forces résistantes (N) à la vitesse donnée. La gravité est négative en descente. */
export function resistiveForces(speedMps: number, gradePct: number, altitudeM: number, setup: RiderSetup): Forces {
  const theta = Math.atan(gradePct / 100);
  const weight = totalMass(setup) * gravity(setup.latitudeDeg, altitudeM);
  const air = speedMps + setup.headwindMps;
  const fGravity = weight * Math.sin(theta);
  const fRolling = speedMps > 0 ? weight * Math.cos(theta) * setup.crr : 0;
  const fAero = 0.5 * airDensity(altitudeM, setup.temperatureC) * setup.cda * air * Math.abs(air);
  const fBearings = speedMps > 0 ? BEARING_DRAG_N : 0;
  return {
    gravity: fGravity,
    rolling: fRolling,
    aero: fAero,
    bearings: fBearings,
    total: fGravity + fRolling + fAero + fBearings,
  };
}

/** Puissance nécessaire (W, au pédalier) pour tenir une vitesse constante. */
export function steadyPower(speedMps: number, gradePct: number, altitudeM: number, setup: RiderSetup): number {
  return (resistiveForces(speedMps, gradePct, altitudeM, setup).total * speedMps) / setup.drivetrainEfficiency;
}

/** Vitesse d'équilibre (m/s) pour une puissance et une pente données, par dichotomie. */
export function steadySpeed(powerW: number, gradePct: number, altitudeM: number, setup: RiderSetup): number {
  let low = 0;
  let high = 40;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (steadyPower(mid, gradePct, altitudeM, setup) > powerW) high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

export interface PhysicsInput {
  powerW: number;
  gradePct: number;
  altitudeM: number;
}

export const PHYSICS_STEP_S = 0.01;

export class PhysicsEngine {
  speedMps = 0;
  distanceM = 0;

  constructor(public setup: RiderSetup) {}

  private acceleration(speed: number, input: PhysicsInput): number {
    const s = this.setup;
    const theta = Math.atan(input.gradePct / 100);
    const normal = totalMass(s) * gravity(s.latitudeDeg, input.altitudeM) * Math.cos(theta);
    // À très basse vitesse P/v diverge : la force est plafonnée par l'adhérence du pneu.
    const drive = Math.min((input.powerW * s.drivetrainEfficiency) / Math.max(speed, 0.1), TRACTION_MU * normal);
    return (drive - resistiveForces(speed, input.gradePct, input.altitudeM, s).total) / effectiveMass(s);
  }

  /** Avance la simulation de `dt` secondes par pas fixes de 10 ms (intégration RK4). */
  advance(dt: number, input: PhysicsInput): void {
    const steps = Math.max(1, Math.round(dt / PHYSICS_STEP_S));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const v = this.speedMps;
      const k1 = this.acceleration(v, input);
      const k2 = this.acceleration(Math.max(0, v + (h / 2) * k1), input);
      const k3 = this.acceleration(Math.max(0, v + (h / 2) * k2), input);
      const k4 = this.acceleration(Math.max(0, v + h * k3), input);
      const next = v + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
      // Un vélo ne recule pas : à l'arrêt en côte, le cycliste pose le pied.
      this.speedMps = Math.max(0, next);
      this.distanceM += ((v + this.speedMps) / 2) * h;
    }
  }
}

export interface TrainerCommand {
  gradePct: number;
  crr: number;
  /** Coefficient aérodynamique envoyé au frein : ρ·CdA (kg/m), donc dépendant de l'altitude. */
  cwKgPerM: number;
  windMps: number;
}

/**
 * Traduit l'état de la route en consigne pour le home trainer.
 * `difficulty` (0..1) atténue la pente ressentie sans changer la simulation de vitesse ;
 * seule la montée est atténuée quand on la réduit, la descente suit le même facteur.
 */
export function trainerCommand(gradePct: number, altitudeM: number, setup: RiderSetup, difficulty: number): TrainerCommand {
  return {
    gradePct: Math.max(-20, Math.min(20, gradePct * difficulty)),
    crr: setup.crr,
    cwKgPerM: airDensity(altitudeM, setup.temperatureC) * setup.cda,
    windMps: setup.headwindMps,
  };
}
