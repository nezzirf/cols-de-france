// ANT+ FE-C via une clé USB ANT (Garmin/Dynastream) et WebUSB.
// Sous Windows la clé doit utiliser le pilote WinUSB (voir README).

import type { TrainerCommand } from '../sim/physicsEngine';
import {
  ANT_PLUS_NETWORK_KEY,
  ANT_RF_FREQUENCY,
  AntDecoder,
  antFrame,
  AntMsg,
  FEC_DEVICE_TYPE,
  FEC_PERIOD,
  fecTargetPower,
  fecTrackResistance,
  fecUserConfig,
  fecWindResistance,
  HRM_DEVICE_TYPE,
  HRM_PERIOD,
  parseFecPage,
} from './antProtocol';
import type { ConnectionState, Trainer, TrainerData } from './types';

const ANT_VENDOR = 0x0fcf;
const FEC_CHANNEL = 0;
const HRM_CHANNEL = 1;

export class KickrAnt implements Trainer {
  readonly label = 'Wahoo KICKR Core (ANT+ FE-C)';
  protocol = 'ANT+ FE-C';
  state: ConnectionState = 'disconnected';
  onData: (data: TrainerData) => void = () => {};
  onState: (state: ConnectionState) => void = () => {};

  private device: USBDevice | null = null;
  private epIn = 0;
  private epOut = 0;
  private running = false;
  private tick = 0;
  private decoder = new AntDecoder();

  constructor(private profile: () => { riderKg: number; bikeKg: number; wheelRadiusM: number }) {}

  private setState(state: ConnectionState): void {
    this.state = state;
    this.onState(state);
  }

  async connect(): Promise<void> {
    if (!navigator.usb) throw new Error("Ce navigateur n'a pas WebUSB : utilise Chrome ou Edge.");
    this.setState('connecting');
    try {
      this.device = await navigator.usb.requestDevice({ filters: [{ vendorId: ANT_VENDOR }] });
      await this.device.open();
      if (!this.device.configuration) await this.device.selectConfiguration(1);
      const iface = this.device.configuration!.interfaces[0];
      await this.device.claimInterface(iface.interfaceNumber);
      for (const ep of iface.alternate.endpoints) {
        if (ep.direction === 'in') this.epIn = ep.endpointNumber;
        else this.epOut = ep.endpointNumber;
      }
      this.running = true;
      void this.readLoop();
      await this.configure();
      this.setState('connected');
    } catch (err) {
      this.running = false;
      this.setState('disconnected');
      if (err instanceof DOMException && err.name === 'SecurityError') {
        throw new Error('Windows réserve la clé ANT+ : installe le pilote WinUSB avec Zadig (voir README).');
      }
      throw err;
    }
  }

  private async send(id: number, payload: number[]): Promise<void> {
    await this.device!.transferOut(this.epOut, antFrame(id, payload));
  }

  private async openChannel(channel: number, deviceType: number, period: number): Promise<void> {
    await this.send(AntMsg.AssignChannel, [channel, 0x00, 0x00]);
    await this.send(AntMsg.SetChannelId, [channel, 0, 0, deviceType, 0]);
    await this.send(AntMsg.SetRfFrequency, [channel, ANT_RF_FREQUENCY]);
    await this.send(AntMsg.SetChannelPeriod, [channel, period & 0xff, period >> 8]);
    await this.send(AntMsg.SetSearchTimeout, [channel, 255]);
    await this.send(AntMsg.OpenChannel, [channel]);
  }

  private async configure(): Promise<void> {
    await this.send(AntMsg.Reset, [0]);
    await new Promise((r) => setTimeout(r, 600));
    await this.send(AntMsg.SetNetworkKey, [0, ...ANT_PLUS_NETWORK_KEY]);
    await this.openChannel(FEC_CHANNEL, FEC_DEVICE_TYPE, FEC_PERIOD);
    await this.openChannel(HRM_CHANNEL, HRM_DEVICE_TYPE, HRM_PERIOD);
  }

  private async readLoop(): Promise<void> {
    while (this.running && this.device) {
      try {
        const res = await this.device.transferIn(this.epIn, 64);
        if (!res.data) continue;
        const chunk = new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
        for (const msg of this.decoder.push(chunk)) this.handle(msg.id, msg.data);
      } catch {
        if (this.running) {
          this.running = false;
          this.onData({ powerW: 0, cadenceRpm: 0 });
          this.setState('disconnected');
        }
      }
    }
  }

  private handle(id: number, data: Uint8Array): void {
    if (id !== AntMsg.BroadcastData && id !== AntMsg.AcknowledgedData) return;
    const page = data.subarray(1, 9);
    if (data[0] === FEC_CHANNEL) {
      const out = parseFecPage(page);
      if (out) this.onData(out);
    } else if (data[0] === HRM_CHANNEL) {
      this.onData({ heartRateBpm: page[7] });
    }
  }

  async setSimulation(cmd: TrainerCommand): Promise<void> {
    if (!this.device || !this.running) return;
    // Le canal ANT n'accepte qu'un message par période : les pages sont envoyées à tour de rôle.
    const t = this.tick++;
    let page = fecTrackResistance(cmd.gradePct, cmd.crr);
    if (t % 8 === 1) page = fecWindResistance(cmd);
    if (t % 16 === 3) {
      const p = this.profile();
      page = fecUserConfig(p.riderKg, p.bikeKg, p.wheelRadiusM * 2);
    }
    await this.send(AntMsg.AcknowledgedData, [FEC_CHANNEL, ...page]);
  }

  async setTargetPower(watts: number): Promise<void> {
    if (!this.device || !this.running) return;
    await this.send(AntMsg.AcknowledgedData, [FEC_CHANNEL, ...fecTargetPower(watts)]);
  }

  async disconnect(): Promise<void> {
    this.running = false;
    await this.device?.close().catch(() => {});
    this.setState('disconnected');
  }
}
