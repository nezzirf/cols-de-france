// Connexion Web Bluetooth au Wahoo KICKR Core.
// Priorité au standard FTMS ; repli sur l'extension Wahoo du service Cycling Power
// pour les firmwares qui n'exposent pas FTMS.

import type { TrainerCommand } from '../sim/physicsEngine';
import {
  CrankCadence,
  CYCLING_POWER_MEASUREMENT,
  CYCLING_POWER_SERVICE,
  encodeSimulation,
  encodeWahooGrade,
  encodeWahooSimMode,
  FTMS_CONTROL_POINT,
  FTMS_INDOOR_BIKE_DATA,
  FTMS_SERVICE,
  FtmsOp,
  FtmsResult,
  parseControlResponse,
  parseCyclingPower,
  parseIndoorBikeData,
  WAHOO_CONTROL_POINT,
  WAHOO_UNLOCK,
} from './ftmsProtocol';
import type { ConnectionState, Trainer, TrainerData } from './types';

const INDICATION_TIMEOUT_MS = 2500;
const RECONNECT_ATTEMPTS = 5;

interface Control {
  send(cmd: TrainerCommand): Promise<void>;
}

export class KickrBluetooth implements Trainer {
  readonly label = 'Wahoo KICKR Core (Bluetooth)';
  protocol = '';
  state: ConnectionState = 'disconnected';
  onData: (data: TrainerData) => void = () => {};
  onState: (state: ConnectionState) => void = () => {};

  private device: BluetoothDevice | null = null;
  private control: Control | null = null;
  private pending: ((view: DataView) => void) | null = null;
  private lastCommand: TrainerCommand | null = null;
  private userDisconnected = false;
  private writing: Promise<unknown> = Promise.resolve();

  /** Masse totale pour le mode Wahoo : FTMS ne transporte pas le poids. */
  constructor(private totalKg: () => number) {}

  private setState(state: ConnectionState): void {
    this.state = state;
    this.onState(state);
  }

  async connect(): Promise<void> {
    this.userDisconnected = false;
    if (!navigator.bluetooth) {
      throw new Error("Ce navigateur n'a pas Web Bluetooth : utilise Chrome ou Edge sur http://localhost.");
    }
    this.setState('connecting');
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [FTMS_SERVICE] }, { namePrefix: 'KICKR' }, { namePrefix: 'Wahoo' }],
        optionalServices: [FTMS_SERVICE, CYCLING_POWER_SERVICE, WAHOO_CONTROL_POINT],
      });
      this.device.addEventListener('gattserverdisconnected', () => void this.handleDisconnect());
      await this.openGatt();
      this.setState('connected');
    } catch (err) {
      this.setState('disconnected');
      throw err;
    }
  }

  private async openGatt(): Promise<void> {
    const server = await this.device!.gatt!.connect();
    const services = await server.getPrimaryServices();
    const hasFtms = services.some((s) => s.uuid.startsWith('00001826'));
    if (hasFtms) await this.setupFtms(server);
    else await this.setupWahoo(server);
  }

  private async setupFtms(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(FTMS_SERVICE);
    const data = await service.getCharacteristic(FTMS_INDOOR_BIKE_DATA);
    const point = await service.getCharacteristic(FTMS_CONTROL_POINT);

    point.addEventListener('characteristicvaluechanged', (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.pending?.(value);
    });
    await point.startNotifications();

    data.addEventListener('characteristicvaluechanged', (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.onData(parseIndoorBikeData(value));
    });
    await data.startNotifications();

    await this.writeFtms(point, new Uint8Array([FtmsOp.RequestControl]));
    await this.writeFtms(point, new Uint8Array([FtmsOp.Start]));
    this.protocol = 'FTMS';
    this.control = { send: (cmd) => this.writeFtms(point, encodeSimulation(cmd)) };
  }

  /** Écrit sur le point de contrôle FTMS et attend l'indication de réponse. */
  private writeFtms(point: BluetoothRemoteGATTCharacteristic, payload: Uint8Array): Promise<void> {
    const job = this.writing.then(
      () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.pending = null;
            reject(new Error('Le home trainer ne répond pas au point de contrôle FTMS'));
          }, INDICATION_TIMEOUT_MS);
          this.pending = (view) => {
            const res = parseControlResponse(view);
            if (!res || res.requestOp !== payload[0]) return;
            clearTimeout(timer);
            this.pending = null;
            if (res.result === FtmsResult.Success) resolve();
            else reject(new Error(`Commande FTMS 0x${payload[0].toString(16)} refusée (code ${res.result})`));
          };
          point.writeValueWithResponse(payload).catch((err) => {
            clearTimeout(timer);
            this.pending = null;
            reject(err);
          });
        }),
    );
    this.writing = job.catch(() => {});
    return job;
  }

  private async setupWahoo(server: BluetoothRemoteGATTServer): Promise<void> {
    const service = await server.getPrimaryService(CYCLING_POWER_SERVICE);
    const measure = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT);
    const point = await service.getCharacteristic(WAHOO_CONTROL_POINT);
    const crank = new CrankCadence();

    measure.addEventListener('characteristicvaluechanged', (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.onData(parseCyclingPower(value, crank));
    });
    await measure.startNotifications();
    await point.startNotifications();
    await point.writeValueWithResponse(WAHOO_UNLOCK);

    this.protocol = 'Wahoo';
    let modeSet = false;
    this.control = {
      send: async (cmd) => {
        if (!modeSet) {
          await point.writeValueWithResponse(encodeWahooSimMode(this.totalKg(), cmd.crr, cmd.cwKgPerM));
          modeSet = true;
        }
        await point.writeValueWithResponse(encodeWahooGrade(cmd.gradePct));
      },
    };
  }

  private async handleDisconnect(): Promise<void> {
    this.control = null;
    if (this.userDisconnected) {
      this.setState('disconnected');
      return;
    }
    this.onData({ powerW: 0, cadenceRpm: 0 });
    this.setState('reconnecting');
    for (let attempt = 1; attempt <= RECONNECT_ATTEMPTS; attempt++) {
      try {
        await this.openGatt();
        if (this.lastCommand) await this.setSimulation(this.lastCommand);
        this.setState('connected');
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    this.setState('disconnected');
  }

  async setSimulation(command: TrainerCommand): Promise<void> {
    this.lastCommand = command;
    await this.control?.send(command);
  }

  async disconnect(): Promise<void> {
    this.userDisconnected = true;
    this.device?.gatt?.disconnect();
    this.setState('disconnected');
  }
}
