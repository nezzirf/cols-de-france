import { describe, expect, it } from 'vitest';
import { expandBlocks, totalDuration, workoutStateAt, WORKOUT_PRESETS } from '../src/sim/workout';

describe('test FTP 20 minutes', () => {
  const preset = WORKOUT_PRESETS.find((w) => w.id === 'preset-ftp')!;
  const steps = expandBlocks(preset.blocks);

  it('fait partie des séances proposées', () => {
    expect(preset.name).toContain('FTP');
  });

  it('contient un seul effort libre de vingt minutes', () => {
    const free = steps.filter((s) => s.free);
    expect(free).toHaveLength(1);
    expect(free[0].durationS).toBe(1200);
  });

  it('impose des watts avant et après l\'effort libre, pas pendant', () => {
    const free = steps.find((s) => s.free)!;
    expect(workoutStateAt(steps, free.startS - 1)!.step.free).toBeUndefined();
    expect(workoutStateAt(steps, free.startS + 10)!.step.free).toBe(true);
    expect(workoutStateAt(steps, free.startS + free.durationS + 1)!.step.free).toBeUndefined();
  });

  it('dure environ une heure dix', () => {
    expect(totalDuration(steps)).toBeGreaterThan(3600);
    expect(totalDuration(steps)).toBeLessThan(5400);
  });
});
