import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/app/game';
import { BOT_TINTS, botRiders, MAX_BOTS, sanitizeBots } from '../src/sim/bots';
import type { Trainer, TrainerData } from '../src/hardware/types';
import { DEFAULT_SETUP } from '../src/sim/physicsEngine';
import { Route, type RouteData } from '../src/sim/route';
import type { PelotonState } from '../src/sim/peloton';
import type { World } from '../src/world/scene';

describe('fantômes', () => {
  it('garde cinq niveaux valides au plus', () => {
    expect(sanitizeBots([2, 3, 4, 5, 6, 3, 3])).toHaveLength(MAX_BOTS);
    expect(sanitizeBots('x')).toEqual([]);
    expect(sanitizeBots([0, 99, NaN, 'a', 3.14])).toEqual([1, 6.5, 3.1]);
  });

  it('fait tenir à chacun son niveau, au poids du joueur', () => {
    const riders = botRiders([2.5, 4], 70);
    expect(riders.map((r) => r.powerAt(0))).toEqual([175, 280]);
    expect(riders.map((r) => r.powerAt(1234))).toEqual([175, 280]);
    expect(riders.every((r) => r.massKg === undefined)).toBe(true);
    expect(riders.map((r) => r.name)).toEqual(['Fantôme 1', 'Fantôme 2']);
    expect(riders.map((r) => r.ghostTint)).toEqual([BOT_TINTS[0], BOT_TINTS[1]]);
  });

  it("place les cinq fantômes sans qu'ils se superposent au départ", () => {
    const riders = botRiders([3, 3, 3, 3, 3], 75);
    const spots = new Set(riders.map((r) => `${r.lateralM}/${r.startOffsetM}`));
    expect(spots.size).toBe(5);
  });
});

function flatRoute(): Route {
  const n = 3000;
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

describe('fantômes en sortie', () => {
  let frames: PelotonState[][];
  let trainer: Trainer & { feed(d: TrainerData): void };
  let game: Game;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('window', { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a) });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    frames = [];
    const t = {
      label: 't',
      protocol: 't',
      state: 'connected',
      connect: async () => {},
      disconnect: async () => {},
      setSimulation: async () => {},
      setTargetPower: async () => {},
      onData: (_: TrainerData) => {},
      onState: () => {},
      feed(d: TrainerData) {
        t.onData(d);
      },
    };
    trainer = t as unknown as Trainer & { feed(d: TrainerData): void };
    const world = {
      events: [],
      onBiomeChange: () => {},
      render: (_d: number, _c: number, _g: number | null, _dt: number, _n: number, peloton: PelotonState[] = []) => frames.push(peloton),
    } as unknown as World;
    game = new Game(flatRoute(), world, trainer, DEFAULT_SETUP);
  });
  afterEach(() => {
    game.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const pedal = (seconds: number, powerW: number) => {
    for (let s = 0; s < seconds; s++) {
      trainer.feed({ powerW, cadenceRpm: 90 });
      vi.advanceTimersByTime(1000);
    }
  };

  it('les fantômes les plus forts partent devant, les plus faibles se laissent rattraper', () => {
    game.enableBots([1.2, 5]);
    game.start();
    pedal(120, 200);
    const snap = game.currentSnapshot();
    expect(snap.peloton).not.toBeNull();
    // Le fantôme à 5 W/kg (375 W) est devant, celui à 1,2 W/kg (90 W) derrière.
    expect(snap.peloton!.ahead?.name).toBe('Fantôme 2');
    expect(snap.peloton!.behind?.name).toBe('Fantôme 1');
    expect(snap.peloton!.group).toBeNull();
  });

  it("n'ajoute aucun coureur quand aucun fantôme n'est choisi", () => {
    game.enableBots([]);
    game.start();
    pedal(5, 200);
    expect(game.currentSnapshot().peloton).toBeNull();
  });
});
