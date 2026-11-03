import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/app/game';
import type { Trainer, TrainerData } from '../src/hardware/types';
import { DEFAULT_SETUP } from '../src/sim/physicsEngine';
import { Route, type RouteData } from '../src/sim/route';
import { expandBlocks, newBlock, type WorkoutBlock } from '../src/sim/workout';
import type { World } from '../src/world/scene';

const FTP = 200;

function flatRoute(): Route {
  const n = 600;
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

describe('mode ERG', () => {
  let targets: number[];
  let simulations: number;
  let failNext: boolean;
  let trainer: Trainer & { feed(d: TrainerData): void };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('window', { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a) });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    targets = [];
    simulations = 0;
    failNext = false;
    const t = {
      label: 'test',
      protocol: 'test',
      state: 'connected',
      connect: async () => {},
      disconnect: async () => {},
      setSimulation: async () => {
        simulations++;
      },
      setTargetPower: async (w: number) => {
        if (failNext) {
          failNext = false;
          throw new Error('perdu');
        }
        targets.push(w);
      },
      onData: (_: TrainerData) => {},
      onState: () => {},
      feed(d: TrainerData) {
        t.onData(d);
      },
    };
    trainer = t as unknown as Trainer & { feed(d: TrainerData): void };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function session(blocks: WorkoutBlock[]) {
    const world = { events: [], onBiomeChange: () => {}, render: () => {} } as unknown as World;
    const game = new Game(flatRoute(), world, trainer, DEFAULT_SETUP, 'route', expandBlocks(blocks), FTP);
    let finished = false;
    game.onFinish = () => (finished = true);
    game.start();
    const pedal = async (seconds: number, powerW = 150) => {
      for (let s = 0; s < seconds; s++) {
        trainer.feed({ powerW, cadenceRpm: 90 });
        await vi.advanceTimersByTimeAsync(1000);
      }
    };
    return { game, pedal, isFinished: () => finished };
  }

  const stable = (durationS: number, pct: number): WorkoutBlock => ({ ...newBlock('stable'), durationS, fromPct: pct, toPct: pct });

  it('impose la puissance cible en watts dès le départ, sans jamais passer en simulation', async () => {
    const { game, pedal } = session([stable(120, 75)]);
    await pedal(3);
    game.stop();
    expect(targets[0]).toBe(150);
    expect(simulations).toBe(0);
  });

  it('change la cible à chaque palier', async () => {
    const { game, pedal } = session([stable(30, 50), stable(30, 100)]);
    await pedal(45);
    game.stop();
    expect(targets).toContain(100);
    expect(targets[targets.length - 1]).toBe(200);
  });

  it('suit une rampe watt après watt', async () => {
    const { game, pedal } = session([{ ...newBlock('rampe'), durationS: 60, fromPct: 50, toPct: 100 }]);
    await pedal(40);
    game.stop();
    const steps = targets.slice(1).map((w, i) => w - targets[i]);
    expect(targets[0]).toBeGreaterThanOrEqual(100);
    expect(targets[0]).toBeLessThanOrEqual(105);
    expect(targets.length).toBeGreaterThan(20);
    expect(steps.every((d) => d >= 0)).toBe(true);
    expect(targets[targets.length - 1]).toBeGreaterThan(150);
  });

  it('renvoie la cible de temps en temps, pour retrouver la bonne puissance après une coupure', async () => {
    const { game, pedal } = session([stable(120, 75)]);
    await pedal(35);
    game.stop();
    expect(targets.length).toBeGreaterThanOrEqual(3);
    expect(new Set(targets)).toEqual(new Set([150]));
  });

  it("réessaie quand une commande est perdue, sans attendre le prochain palier", async () => {
    failNext = true;
    const { game, pedal } = session([stable(120, 75)]);
    const errors: string[] = [];
    game.onTrainerError = (m) => errors.push(m);
    await pedal(4);
    game.stop();
    expect(errors).toHaveLength(1);
    expect(targets[0]).toBe(150);
  });

  it('garde le chrono à l’arrêt tant que le cycliste ne pédale pas, puis finit à la fin de la séance', async () => {
    const { game, pedal, isFinished } = session([stable(20, 60)]);
    await pedal(5, 0);
    expect(game.state().elapsedS).toBe(0);
    await pedal(25, 120);
    expect(isFinished()).toBe(true);
  });
});
