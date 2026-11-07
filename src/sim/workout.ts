// Séances par blocs : ce que le joueur assemble, et ce qu'en tire le home trainer seconde après
// seconde. Les puissances sont en % de FTP, pour rester valables si la FTP change.

export type BlockKind = 'echauffement' | 'stable' | 'rampe' | 'intervalles' | 'recuperation' | 'libre';

export interface WorkoutBlock {
  kind: BlockKind;
  /** Durée du bloc, ou d'un effort pour des intervalles. */
  durationS: number;
  fromPct: number;
  /** Fin d'une rampe, ou puissance de récupération des intervalles. */
  toPct: number;
  repeat: number;
  /** Durée de la récupération entre deux intervalles. */
  restS: number;
}

export interface Workout {
  id: string;
  name: string;
  blocks: WorkoutBlock[];
}

export interface WorkoutStep {
  /** Effort libre : le home trainer n'impose pas de watts, la résistance suit une pente fixe. */
  free?: boolean;
  block: number;
  startS: number;
  durationS: number;
  fromPct: number;
  toPct: number;
}

export const BLOCK_LABELS: Record<BlockKind, string> = {
  echauffement: 'Échauffement',
  stable: 'Stable',
  rampe: 'Rampe',
  intervalles: 'Intervalles',
  recuperation: 'Récupération',
  libre: 'Effort libre',
};

export function newBlock(kind: BlockKind): WorkoutBlock {
  const block = { kind, repeat: 1, restS: 0 };
  switch (kind) {
    case 'echauffement':
      return { ...block, durationS: 600, fromPct: 45, toPct: 75 };
    case 'recuperation':
      return { ...block, durationS: 300, fromPct: 60, toPct: 40 };
    case 'libre':
      return { ...block, durationS: 1200, fromPct: 100, toPct: 100 };
    case 'rampe':
      return { ...block, durationS: 300, fromPct: 70, toPct: 100 };
    case 'intervalles':
      return { ...block, durationS: 120, fromPct: 110, toPct: 50, repeat: 5, restS: 120 };
    default:
      return { ...block, durationS: 300, fromPct: 85, toPct: 85 };
  }
}

/** Déroule les blocs en étapes successives : un bloc d'intervalles en donne plusieurs. */
export function expandBlocks(blocks: WorkoutBlock[]): WorkoutStep[] {
  const steps: WorkoutStep[] = [];
  let t = 0;
  const push = (block: number, durationS: number, fromPct: number, toPct: number, free = false) => {
    if (durationS <= 0) return;
    steps.push(free ? { block, startS: t, durationS, fromPct, toPct, free } : { block, startS: t, durationS, fromPct, toPct });
    t += durationS;
  };
  blocks.forEach((b, i) => {
    if (b.kind === 'intervalles') {
      for (let k = 0; k < b.repeat; k++) {
        push(i, b.durationS, b.fromPct, b.fromPct);
        push(i, b.restS, b.toPct, b.toPct);
      }
    } else if (b.kind === 'libre') {
      push(i, b.durationS, b.fromPct, b.fromPct, true);
    } else if (b.kind === 'stable') {
      push(i, b.durationS, b.fromPct, b.fromPct);
    } else {
      push(i, b.durationS, b.fromPct, b.toPct);
    }
  });
  return steps;
}

export function totalDuration(steps: WorkoutStep[]): number {
  const last = steps[steps.length - 1];
  return last ? last.startS + last.durationS : 0;
}

export interface WorkoutState {
  targetPct: number;
  step: WorkoutStep;
  stepLeftS: number;
}

/** Étape en cours à un instant donné, ou null si la séance est finie. */
export function workoutStateAt(steps: WorkoutStep[], elapsedS: number): WorkoutState | null {
  for (const step of steps) {
    const inStep = elapsedS - step.startS;
    if (inStep < step.durationS) {
      const t = Math.max(0, inStep) / step.durationS;
      return { targetPct: step.fromPct + (step.toPct - step.fromPct) * t, step, stepLeftS: step.durationS - inStep };
    }
  }
  return null;
}

/** Charge d'entraînement (TSS) : 100 points pour une heure à FTP. */
export function trainingLoad(steps: WorkoutStep[]): number {
  let sum = 0;
  for (const s of steps) {
    // Intégration de la puissance à la 4e, comme la puissance normalisée.
    for (let i = 0; i < 8; i++) {
      const pct = s.fromPct + ((s.toPct - s.fromPct) * (i + 0.5)) / 8;
      sum += (s.durationS / 8) * (pct / 100) ** 4;
    }
  }
  const total = totalDuration(steps);
  if (total === 0) return 0;
  const intensity = (sum / total) ** 0.25;
  return (total / 3600) * intensity * intensity * 100;
}

/** Couleur de zone, avec les conventions des applications d'entraînement. */
export function zoneColor(pct: number): string {
  if (pct < 60) return '#9aa3ad';
  if (pct < 76) return '#3f8fe0';
  if (pct < 90) return '#3fb56b';
  if (pct < 105) return '#f4c430';
  if (pct < 119) return '#f28a2e';
  return '#e0453a';
}

export const WORKOUT_PRESETS: Workout[] = [
  {
    id: 'preset-endurance',
    name: 'Endurance 45 min',
    blocks: [
      { ...newBlock('echauffement'), durationS: 480 },
      { ...newBlock('stable'), durationS: 1920, fromPct: 68, toPct: 68 },
      newBlock('recuperation'),
    ],
  },
  {
    id: 'preset-sweetspot',
    name: 'Sweet spot 3 x 10',
    blocks: [
      newBlock('echauffement'),
      { ...newBlock('intervalles'), durationS: 600, fromPct: 90, toPct: 55, repeat: 3, restS: 300 },
      newBlock('recuperation'),
    ],
  },
  {
    id: 'preset-vo2',
    name: 'VO2max 5 x 3',
    blocks: [
      newBlock('echauffement'),
      { ...newBlock('intervalles'), durationS: 180, fromPct: 118, toPct: 50, repeat: 5, restS: 180 },
      newBlock('recuperation'),
    ],
  },
  {
    // Protocole classique des vingt minutes : la FTP vaut 95 % de la puissance tenue sur l'effort libre.
    id: 'preset-ftp',
    name: 'Test FTP 20 min',
    blocks: [
      { ...newBlock('echauffement'), durationS: 600, fromPct: 45, toPct: 75 },
      { ...newBlock('intervalles'), durationS: 60, fromPct: 110, toPct: 55, repeat: 3, restS: 60 },
      { ...newBlock('recuperation'), durationS: 300, fromPct: 60, toPct: 50 },
      { ...newBlock('stable'), durationS: 300, fromPct: 120, toPct: 120 },
      { ...newBlock('recuperation'), durationS: 600, fromPct: 55, toPct: 40 },
      newBlock('libre'),
      { ...newBlock('recuperation'), durationS: 300, fromPct: 50, toPct: 35 },
    ],
  },
  {
    id: 'preset-rampe',
    name: 'Test de rampe',
    blocks: [
      newBlock('echauffement'),
      { ...newBlock('rampe'), durationS: 900, fromPct: 60, toPct: 135 },
      newBlock('recuperation'),
    ],
  },
];

const STORE_KEY = 'cols.workouts';

export function loadWorkouts(): Workout[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Workout[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveWorkouts(list: Workout[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    // Sans stockage, la séance reste utilisable jusqu'à la fermeture du jeu.
  }
}
