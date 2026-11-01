import type { TrainerCommand } from '../sim/physicsEngine';

export interface TrainerData {
  powerW?: number;
  cadenceRpm?: number;
  /** Vitesse rapportée par le home trainer : affichée nulle part, utile au diagnostic. */
  trainerSpeedMps?: number;
  heartRateBpm?: number;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface Trainer {
  readonly label: string;
  /** Nom du protocole réellement négocié, par exemple « FTMS ». */
  protocol: string;
  state: ConnectionState;
  /** Doit être appelé depuis un geste utilisateur : le navigateur l'exige. */
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setSimulation(command: TrainerCommand): Promise<void>;
  /** Mode ERG : impose la puissance, quelle que soit la cadence. */
  setTargetPower(watts: number): Promise<void>;
  onData: (data: TrainerData) => void;
  onState: (state: ConnectionState) => void;
}

export interface HeartRateSensor {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onBpm: (bpm: number) => void;
}

/** Consigne seulement si le dernier envoi date ou si la valeur a assez changé. */
export function commandChanged(a: TrainerCommand | null, b: TrainerCommand): boolean {
  if (!a) return true;
  return (
    Math.abs(a.gradePct - b.gradePct) >= 0.05 ||
    Math.abs(a.cwKgPerM - b.cwKgPerM) >= 0.005 ||
    Math.abs(a.windMps - b.windMps) >= 0.05 ||
    a.crr !== b.crr
  );
}
