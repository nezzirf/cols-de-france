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

function fakeTrainer(log: { targets: number[]; simulations: number }): Trainer & { feed(d: TrainerData): void } {
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

describe('verrouillage des watts', () => {
  const log = { targets: [] as number[], simulations: 0 };
  let trainer: Trainer & { feed(d: TrainerData): void };
  let game: Game;
  let toasts: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('window', { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a) });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    log.targets = [];
    log.simulations = 0;
    toasts = [];
    trainer = fakeTrainer(log);
    const world = { events: [], onBiomeChange: () => {}, render: () => {} } as unknown as World;
    game = new Game(flatRoute(), world, trainer, DEFAULT_SETUP);
    game.onToast = (text) => toasts.push(text);
    game.start();
  });
  afterEach(() => {
    game.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pedal = (seconds: number, powerW = 230) => {
    for (let s = 0; s < seconds; s++) {
      trainer.feed({ powerW, cadenceRpm: 88 });
      vi.advanceTimersByTime(1000);
    }
  };

  it('impose les watts du moment au home trainer', () => {
    pedal(3);
    game.toggleLock();
    pedal(2);
    expect(game.lockedPowerW).toBe(230);
    expect(log.targets.at(-1)).toBe(230);
  });

  it('ne se verrouille pas sans pédaler', () => {
    pedal(1, 0);
    game.toggleLock();
    expect(game.lockedPowerW).toBeNull();
    expect(toasts.at(-1)).toMatch(/Pédale/);
  });

  it("monte et descend les watts d'un watt à la fois", () => {
    pedal(3);
    game.toggleLock();
    game.adjustLock(1);
    game.adjustLock(1);
    expect(game.lockedPowerW).toBe(232);
    game.adjustLock(-1);
    pedal(2);
    expect(game.lockedPowerW).toBe(231);
    expect(log.targets.at(-1)).toBe(231);
  });

  it("refuse de régler les watts tant qu'ils ne sont pas verrouillés", () => {
    pedal(3);
    game.adjustLock(1);
    expect(game.lockedPowerW).toBeNull();
    expect(log.targets).toHaveLength(0);
  });

  it('se libère au second appui et reprend la résistance de la pente', () => {
    pedal(3);
    game.toggleLock();
    pedal(2);
    const before = log.simulations;
    game.toggleLock();
    pedal(2);
    expect(game.lockedPowerW).toBeNull();
    expect(log.simulations).toBeGreaterThan(before);
  });

  it("annonce la puissance verrouillée dans l'état de la sortie", () => {
    pedal(3);
    game.toggleLock();
    expect(game.currentSnapshot().lockedW).toBe(230);
    game.toggleLock();
    expect(game.currentSnapshot().lockedW).toBeNull();
  });
});

describe('séance guidée', () => {
  it("ne permet pas de verrouiller : la séance impose déjà sa puissance", () => {
    vi.stubGlobal('window', { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a) });
    const trainer = fakeTrainer({ targets: [], simulations: 0 });
    const world = { events: [], onBiomeChange: () => {}, render: () => {} } as unknown as World;
    const steps = [{ durationS: 600, startPct: 80, endPct: 80 }] as never;
    const game = new Game(flatRoute(), world, trainer, DEFAULT_SETUP, 'route', steps, 200);
    game.toggleLock();
    expect(game.lockedPowerW).toBeNull();
    vi.unstubAllGlobals();
  });
});
