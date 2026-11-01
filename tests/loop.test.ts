import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/app/game';
import type { Trainer, TrainerData } from '../src/hardware/types';
import { DEFAULT_SETUP } from '../src/sim/physicsEngine';
import { Route, type RouteData } from '../src/sim/route';
import type { World } from '../src/world/scene';

const FROM_M = 100;
const TO_M = 1100;

/** Une ligne droite et plate de 1 km entourée de 100 m de tracé, avec un segment sur tout le tour. */
function loopRoute(): Route {
  const n = 141;
  const data = {
    id: 'test-boucle',
    name: 'Boucle de test',
    stepM: 10,
    origin: { lat: 45, lon: 6 },
    x: Array.from({ length: n }, (_, i) => i * 10),
    z: new Array(n).fill(0),
    ele: new Array(n).fill(100),
    grade: new Array(n).fill(0),
    footM: FROM_M,
    endM: TO_M,
    loop: { fromM: FROM_M, toM: TO_M },
    segments: [{ id: 'test:tour', name: 'Tour', startM: FROM_M, endM: TO_M }],
  } as unknown as RouteData;
  return new Route(data);
}

function fakeTrainer(): Trainer & { feed(d: TrainerData): void } {
  const trainer = {
    label: 'test',
    protocol: 'test',
    state: 'connected',
    connect: async () => {},
    disconnect: async () => {},
    setSimulation: async () => {},
    setTargetPower: async () => {},
    onData: (_: TrainerData) => {},
    onState: () => {},
    feed(d: TrainerData) {
      trainer.onData(d);
    },
  };
  return trainer as unknown as Trainer & { feed(d: TrainerData): void };
}

describe('parcours en boucle', () => {
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

  function ride(seconds: number) {
    const trainer = fakeTrainer();
    const world = { events: [], onBiomeChange: () => {}, render: () => {} } as unknown as World;
    const game = new Game(loopRoute(), world, trainer, DEFAULT_SETUP);
    const results: string[] = [];
    let finished = false;
    game.onSegmentDone = (r) => results.push(r.def.id);
    game.onFinish = () => (finished = true);
    game.start();
    for (let s = 0; s < seconds; s++) {
      trainer.feed({ powerW: 320, cadenceRpm: 90 });
      vi.advanceTimersByTime(1000);
    }
    const snap = (game as unknown as { snapshot(d: number): { lap: number; totalM: number; distanceM: number } }).snapshot(game.distanceM);
    game.stop();
    return { game, snap, results, finished };
  }

  it('démarre au départ du tour, pas au début du tracé', () => {
    const { snap } = ride(0);
    expect(snap.distanceM).toBeGreaterThanOrEqual(FROM_M);
    expect(snap.distanceM).toBeLessThan(FROM_M + 5);
    expect(snap.lap).toBe(1);
  });
  it('repart du départ à la fin du tour, sans jamais finir', () => {
    const { snap, results, finished } = ride(160);
    expect(snap.lap).toBeGreaterThanOrEqual(2);
    expect(snap.distanceM).toBeGreaterThanOrEqual(FROM_M);
    expect(snap.distanceM).toBeLessThan(TO_M);
    expect(snap.totalM).toBeGreaterThan(1000);
    expect(finished).toBe(false);
    expect(results).toContain('test:tour');
  });
  it('compte les distances de tous les tours', () => {
    const { snap } = ride(400);
    expect(snap.lap).toBeGreaterThanOrEqual(3);
    expect(snap.totalM).toBeGreaterThan((snap.lap - 1) * 1000);
    expect(snap.totalM).toBeLessThan(snap.lap * 1000 + 5);
  });
  it('chronomètre chaque tour comme un segment à part', () => {
    const { results } = ride(400);
    expect(results.filter((id) => id === 'test:tour').length).toBeGreaterThanOrEqual(2);
  });
});
