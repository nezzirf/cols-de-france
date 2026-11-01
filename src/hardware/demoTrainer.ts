// Home trainer virtuel piloté au clavier : permet de rouler sans matériel.

import type { TrainerCommand } from '../sim/physicsEngine';
import type { ConnectionState, Trainer, TrainerData } from './types';

const REST_BPM = 62;
const MAX_BPM = 188;
const SUSTAINED_W = 340; // puissance qui amène le pouls à la FC max

export class DemoTrainer implements Trainer {
  readonly label = 'Mode démo (clavier)';
  protocol = 'Démo';
  state: ConnectionState = 'disconnected';
  onData: (data: TrainerData) => void = () => {};
  onState: (state: ConnectionState) => void = () => {};

  targetPowerW = 200;
  lastCommand: TrainerCommand | null = null;
  private timer = 0;
  private power = 0;
  private bpm = REST_BPM;

  async connect(): Promise<void> {
    this.state = 'connected';
    this.onState('connected');
    this.timer = window.setInterval(() => this.emit(), 250);
  }

  private emit(): void {
    this.power += (this.targetPowerW - this.power) * 0.35;
    const target = REST_BPM + (MAX_BPM - REST_BPM) * Math.min(1, this.power / SUSTAINED_W);
    this.bpm += (target - this.bpm) * 0.01;
    this.onData({
      powerW: Math.round(this.power),
      cadenceRpm: this.power < 5 ? 0 : Math.round(72 + this.power / 25),
      heartRateBpm: Math.round(this.bpm),
    });
  }

  adjust(deltaW: number): void {
    this.targetPowerW = Math.max(0, Math.min(1200, this.targetPowerW + deltaW));
  }

  async setSimulation(command: TrainerCommand): Promise<void> {
    this.lastCommand = command;
  }

  async disconnect(): Promise<void> {
    clearInterval(this.timer);
    this.state = 'disconnected';
    this.onState('disconnected');
  }
}
