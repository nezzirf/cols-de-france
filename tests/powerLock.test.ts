import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/app/game';
import type { Trainer, TrainerData } from '../src/hardware/types';
import { DEFAULT_SETUP } from '../src/sim/physicsEngine';
import { Route, type RouteData } from '../src/sim/route';
import type { World } from '../src/world/scene';

function flatRoute(): Route {
  const n = 2000;
  const data = {
    id: 'test-plat',
    name: 'Plat',
    stepM: 10,
    origin: { lat: 45, lon: 6 },
    x: Array.from({ length: n }, (_, i) => i * 10),
    z: new Array(n).fill(0),
    ele: new Array(n).fill(100),
    grade: new Array(n).fill(0),
    footM: 0,
    endM: (n - 1) * 10,
    segments: [],
  } as unknown as RouteData;
  return new Route(data);
}

interface Log {
  targets: number[];
  simulations: number;
}

function fakeTrainer(log: Log): Trainer & { feed(d: TrainerData): void } {
  const t = {
    label: 'test',
    protocol: 'test',
    state: 'connected',
    connect: async () => {},
    disconnect: async () => {},
    setSimulation: async () => {
      log.simulations++;
    },
    setTargetPower: async (w: number) => {
      log.targets.push(w);
    },
    onData: (_: TrainerData) => {},
    onState: () => {},
    feed(d: TrainerData) {
      t.onData(d);
    },
  };
  return t as unknown as Trainer & { feed(d: TrainerData): void };
}

function setupTimers(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
  vi.stubGlobal('window', { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a) });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
}

const world = { events: [], onBiomeChange: () => {}, render: () => {} } as unknown as World;

describe('verrouillage des watts', () => {
  const log: Log = { targets: [], simulations: 0 };
  let trainer: Trainer & { feed(d: TrainerData): void };
  let game: Game;
  let toasts: string[];

  beforeEach(() => {
    setupTimers();
    log.targets = [];
    log.simulations = 0;
    toasts = [];
    trainer = fakeTrainer(log);
    game = new Game(flatRoute(), world, trainer, DEFAULT_SETUP);
    game.onToast = (text) => toasts.push(text);
    game.start();
  });
  afterEach(() => {
    game.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pedal = async (seconds: number, powerW = 230) => {
    for (let s = 0; s < seconds; s++) {
      trainer.feed({ powerW, cadenceRpm: 88 });
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  it('impose les watts du moment au home trainer', async () => {
    await pedal(3);
    game.toggleLock();
    await pedal(2);
    expect(game.lockedPowerW).toBe(230);
    expect(log.targets.at(-1)).toBe(230);
  });

  it('ne se verrouille pas sans pédaler', async () => {
    await pedal(1, 0);
    game.toggleLock();
    expect(game.lockedPowerW).toBeNull();
    expect(toasts.at(-1)).toMatch(/Pédale/);
  });

  it("monte et descend les watts d'un watt à la fois", async () => {
    await pedal(3);
    game.toggleLock();
    game.adjustLock(1);
    game.adjustLock(1);
    expect(game.lockedPowerW).toBe(232);
    game.adjustLock(-1);
    await pedal(2);
    expect(game.lockedPowerW).toBe(231);
    expect(log.targets.at(-1)).toBe(231);
  });

  it("refuse de régler les watts tant qu'ils ne sont pas verrouillés", async () => {
    await pedal(3);
    game.adjustLock(1);
    expect(game.lockedPowerW).toBeNull();
    expect(log.targets).toHaveLength(0);
  });

  it('se libère au second appui et reprend la résistance de la pente', async () => {
    await pedal(3);
    game.toggleLock();
    await pedal(2);
    const before = log.simulations;
    game.toggleLock();
    await pedal(2);
    expect(game.lockedPowerW).toBeNull();
    expect(log.simulations).toBeGreaterThan(before);
  });

  it("annonce la puissance verrouillée dans l'état de la sortie", async () => {
    await pedal(3);
    game.toggleLock();
    expect(game.currentSnapshot().lockedW).toBe(230);
    game.toggleLock();
    expect(game.currentSnapshot().lockedW).toBeNull();
  });

  it('envoie le changement de vitesse tout de suite, sans attendre le prochain envoi', async () => {
    await pedal(3);
    game.shift(1);
    await vi.advanceTimersByTimeAsync(1);
    const before = log.simulations;
    game.shift(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(log.simulations).toBeGreaterThan(before);
  });
});

describe('séance guidée', () => {
  const log: Log = { targets: [], simulations: 0 };
  let trainer: Trainer & { feed(d: TrainerData): void };
  let game: Game;

  // Palier ERG à 80 % de la FTP (160 W), puis 60 s d'effort libre, puis de nouveau l'ERG.
  const steps = [
    { block: 0, startS: 0, durationS: 60, fromPct: 80, toPct: 80 },
    { block: 1, startS: 60, durationS: 60, fromPct: 0, toPct: 0, free: true },
    { block: 2, startS: 120, durationS: 600, fromPct: 80, toPct: 80 },
  ] as never;

  beforeEach(() => {
    setupTimers();
    log.targets = [];
    log.simulations = 0;
    trainer = fakeTrainer(log);
    game = new Game(flatRoute(), world, trainer, DEFAULT_SETUP, 'route', steps, 200);
    game.onToast = () => {};
    game.start();
  });
  afterEach(() => {
    game.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pedal = async (seconds: number, powerW = 230) => {
    for (let s = 0; s < seconds; s++) {
      trainer.feed({ powerW, cadenceRpm: 88 });
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  it('ne permet pas de verrouiller ni de changer de vitesse pendant un palier ERG', async () => {
    await pedal(5);
    game.toggleLock();
    game.shift(1);
    expect(game.lockedPowerW).toBeNull();
    expect(game.currentSnapshot().gear).toBeNull();
  });

  it("monte et descend la consigne d'un watt pendant un palier ERG", async () => {
    await pedal(5);
    game.adjustLock(1);
    game.adjustLock(1);
    await pedal(2);
    expect(log.targets.at(-1)).toBe(162);
    expect(game.currentSnapshot().workout?.targetW).toBe(162);
    game.adjustLock(-1);
    await pedal(2);
    expect(log.targets.at(-1)).toBe(161);
  });

  it("permet les vitesses et le verrouillage pendant l'effort libre, puis reprend l'ERG", async () => {
    await pedal(65);
    expect(game.currentSnapshot().workout?.free).toBe(true);

    const before = log.simulations;
    game.shift(-8);
    expect(game.currentSnapshot().gear).not.toBeNull();
    await pedal(2);
    expect(log.simulations).toBeGreaterThan(before);

    game.toggleLock();
    expect(game.lockedPowerW).toBe(230);
    await pedal(2);
    expect(log.targets.at(-1)).toBe(230);
    game.adjustLock(1);
    await pedal(1);
    expect(log.targets.at(-1)).toBe(231);

    // Fin de l'effort libre : le verrou tombe, l'ERG reprend à la consigne de la séance.
    await pedal(60);
    expect(game.currentSnapshot().workout?.free).toBe(false);
    expect(game.lockedPowerW).toBeNull();
    expect(log.targets.at(-1)).toBe(160);

    game.adjustLock(1);
    await pedal(1);
    expect(log.targets.at(-1)).toBe(161);
  });
});
