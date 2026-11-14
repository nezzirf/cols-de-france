// Ceinture cardio Bluetooth (service standard Heart Rate).

import { HEART_RATE_MEASUREMENT, HEART_RATE_SERVICE, parseHeartRate } from './ftmsProtocol';
import { rememberDevice } from './rememberedDevices';
import type { HeartRateSensor } from './types';

export class BluetoothHeartRate implements HeartRateSensor {
  onBpm: (bpm: number) => void = () => {};
  private device: BluetoothDevice | null = null;

  async connect(): Promise<void> {
    if (!navigator.bluetooth) throw new Error("Ce navigateur n'a pas Web Bluetooth.");
    const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HEART_RATE_SERVICE] }] });
    rememberDevice(device.id, 'hr');
    await this.attach(device);
  }

  /** Reprend une ceinture déjà autorisée, sans fenêtre de choix : à l'ouverture du jeu. */
  async connectKnown(device: BluetoothDevice): Promise<void> {
    await this.attach(device);
  }

  private async attach(device: BluetoothDevice): Promise<void> {
    this.device = device;
    const server = await device.gatt!.connect();
    const service = await server.getPrimaryService(HEART_RATE_SERVICE);
    const measure = await service.getCharacteristic(HEART_RATE_MEASUREMENT);
    measure.addEventListener('characteristicvaluechanged', (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.onBpm(parseHeartRate(value));
    });
    await measure.startNotifications();
  }

  async disconnect(): Promise<void> {
    this.device?.gatt?.disconnect();
  }
}
