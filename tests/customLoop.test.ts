import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/app/game';
import type { Trainer, TrainerData } from '../src/hardware/types';
import { buildCustomRoute, LOOP_START_M, MAX_CLIMB_KM, WARMUP_KM } from '../src/sim/customRoute';
import { DEFAULT_SETUP } from '../src/sim/physicsEngine';
import type { World } from '../src/world/scene';

describe('parcours personnalisé en boucle', () => {
  it('monte jusqu\'à 100 km', () => {
    expect(MAX_CLIMB_KM).toBe(100);
    const { route } = buildCustomRoute({ climbKm: 100, gradePct: 4 });
    expect(route.data.climb.lengthKm).toBe(100);
    expect(route.lengthM).toBe((WARMUP_KM + 100) * 1000);
    expect(buildCustomRoute({ climbKm: 250, gradePct: 4 }).route.data.climb.lengthKm).toBe(100);
  });

  it('est une boucle qui repart du départ, sans jamais finir', () => {
    const { route } = buildCustomRoute({ climbKm: 20, gradePct: 5 });
    expect(route.data.loop).toEqual({ fromM: LOOP_START_M, toM: route.lengthM });
  });
});

describe('sortie sur le parcours personnalisé', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance', 'Date'] });
    vi.stubGlobal('window', { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a) });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("continue au-delà de l'arrivée au lieu de terminer la sortie", () => {
    const { route } = buildCustomRoute({ climbKm: 0.5, gradePct: 0 });
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
    const trainer = t as unknown as Trainer & { feed(d: TrainerData): void };
    const world = { events: [], onBiomeChange: () => {}, render: () => {} } as unknown as World;
    const game = new Game(route, world, trainer, DEFAULT_SETUP);
    let finished = false;
    game.onFinish = () => (finished = true);
    game.start();
    // 5,5 km à plus de 50 km/h : l'arrivée est franchie bien avant 600 s.
    for (let s = 0; s < 600; s++) {
      trainer.feed({ powerW: 500, cadenceRpm: 95 });
      vi.advanceTimersByTime(1000);
    }
    const snap = game.currentSnapshot();
    game.stop();
    expect(finished).toBe(false);
    expect(snap.lap).toBeGreaterThanOrEqual(2);
    expect(snap.totalM).toBeGreaterThan(route.lengthM);
  });
});
