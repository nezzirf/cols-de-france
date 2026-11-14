// Appareils Bluetooth déjà autorisés : Chrome les retient (getDevices), on retient de notre côté à quoi ils servent pour
// les reconnecter seuls à l'ouverture du jeu, sans refaire la fenêtre de choix.

export type KnownKind = 'ble' | 'hr' | 'play';

const KEY = 'cols-de-france.bleDevices';

function load(): Record<string, KnownKind> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/** Note à quoi sert cet appareil, juste après que le joueur l'a choisi. */
export function rememberDevice(id: string, kind: KnownKind): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), [id]: kind }));
  } catch {
    // Stockage indisponible : l'appareil sera simplement à reconnecter à la main.
  }
}

/** Les appareils que le navigateur a retenus et dont on connaît l'usage. Vide si le navigateur ne sait pas les retrouver. */
export async function knownDevices(): Promise<{ device: BluetoothDevice; kind: KnownKind }[]> {
  if (!navigator.bluetooth?.getDevices) return [];
  const kinds = load();
  const devices = await navigator.bluetooth.getDevices();
  return devices.filter((d) => kinds[d.id]).map((device) => ({ device, kind: kinds[device.id] }));
}

/**
 * Attend que l'appareil se fasse entendre (il est allumé et à portée). Rend vrai aussi quand le navigateur ne sait pas
 * écouter : on tente alors la connexion directement.
 */
export async function waitUntilNearby(device: BluetoothDevice, timeoutMs: number): Promise<boolean> {
  if (typeof device.watchAdvertisements !== 'function') return true;
  const abort = new AbortController();
  try {
    await device.watchAdvertisements({ signal: abort.signal });
  } catch {
    return true;
  }
  return new Promise<boolean>((resolve) => {
    const done = (heard: boolean) => {
      clearTimeout(timer);
      device.removeEventListener('advertisementreceived', onAdvert);
      abort.abort();
      resolve(heard);
    };
    const onAdvert = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    device.addEventListener('advertisementreceived', onAdvert);
  });
}
