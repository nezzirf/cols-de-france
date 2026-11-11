// Vitesses virtuelles pour un home trainer équipé d'un pignon fixe (Zwift Cog) : la chaîne ne
// bouge pas, c'est la résistance qui reproduit le développement choisi.

/** Plateau unique de 46 dents. */
export const CHAINRING_TEETH = 46;
/** Pignons, du plus petit (rapport le plus long) au plus grand (le plus court). */
export const COG_TEETH = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 23, 25, 28, 31, 34, 38, 42, 46, 50, 54, 58, 62, 65];

export const GEAR_COUNT = COG_TEETH.length;
export const DEFAULT_GEAR = 12;

/** Plateau de 42 dents sur le Cog de 14 : sert si le home trainer ne donne pas sa vitesse. */
const CHAIN_RATIO = 3;
const MIN_CADENCE_RPM = 20;
const MAX_GRADE_PCT = 20;
const GRAVITY = 9.81;

export function gearRatio(gear: number): number {
  // La vitesse 1 est la plus facile : le plus grand pignon.
  const index = GEAR_COUNT - Math.max(1, Math.min(GEAR_COUNT, gear));
  return CHAINRING_TEETH / COG_TEETH[index];
}

export interface ShiftInput {
  gradePct: number;
  gear: number;
  cadenceRpm: number;
  /** Vitesse rapportée par le home trainer, si elle est connue. */
  trainerSpeedMps: number | null;
  totalKg: number;
  crr: number;
  cwKgPerM: number;
  wheelRadiusM: number;
}

/**
 * Pente à envoyer pour qu'à la même cadence, la force ressentie soit celle du rapport choisi.
 * Le frein tourne à la vitesse imposée par le pignon fixe. Le rapport virtuel donnerait une autre
 * vitesse de route, donc une autre force à la pédale : on cherche la pente qui l'égale.
 */
export function shiftedGrade(s: ShiftInput): number {
  if (s.cadenceRpm < MIN_CADENCE_RPM) return s.gradePct;
  const wheelTurnsPerS = (s.cadenceRpm / 60) * 2 * Math.PI * s.wheelRadiusM;
  const virtualSpeed = wheelTurnsPerS * gearRatio(s.gear);
  const brakeSpeed = s.trainerSpeedMps && s.trainerSpeedMps > 0 ? s.trainerSpeedMps : wheelTurnsPerS * CHAIN_RATIO;
  const weight = s.totalKg * GRAVITY;
  const force = (speed: number, gradePct: number) => weight * (gradePct / 100 + s.crr) + 0.5 * s.cwKgPerM * speed * speed;
  const wanted = force(virtualSpeed, s.gradePct) * (virtualSpeed / brakeSpeed);
  const grade = ((wanted - 0.5 * s.cwKgPerM * brakeSpeed * brakeSpeed) / weight - s.crr) * 100;
  return Math.max(-MAX_GRADE_PCT, Math.min(MAX_GRADE_PCT, grade));
}
