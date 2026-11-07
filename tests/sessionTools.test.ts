import { describe, expect, it } from 'vitest';
import { loadInProgress, saveInProgress, clearInProgress, type SavedRide, MAX_AGE_MS } from '../src/app/rideAutosave';
import { addRide, deleteRide, KEPT_SAMPLES, loadHistory, loadSamples, personalBests, referenceRide, weekTotals } from '../src/app/rideHistory';
import { summaryFromSamples } from '../src/app/rideSummary';
import { AUTO_PAUSE_AFTER_S, AutoPause } from '../src/sim/autoPause';
import { EffortAlerts } from '../src/sim/effortAlerts';
import { DEFAULT_SETUP } from '../src/sim/physicsEngine';
import { Peloton, type PelotonRoute } from '../src/sim/peloton';
import { bestPower, estimateFtp, powerBests, type RideSample, rangeStats, rideStats } from '../src/sim/rideStats';
import { packSamples, unpackSamples } from '../src/sim/samplesPack';
import { powerZone, timeInZones } from '../src/sim/zones';
import { ambianceLook, MOMENTS, WEATHERS } from '../src/world/ambiance';

/** Un stockage en mémoire, comme localStorage. */
class MemoryStore {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  keys(): string[] {
    return [...this.data.keys()];
  }
}

function ride(seconds: number, power: (t: number) => number = () => 200, hr: number | null = 140): RideSample[] {
  return Array.from({ length: seconds }, (_, i) => ({
    t: i + 1,
    distanceM: (i + 1) * 5,
    powerW: power(i),
    cadenceRpm: 85,
    heartRateBpm: hr,
    altitudeM: 100 + i * 0.4,
    speedKmh: 18,
  }));
}

describe('pause automatique', () => {
  it('se déclenche après quelques secondes à l’arrêt, et repart au premier coup de pédale', () => {
    const pause = new AutoPause();
    expect(pause.update(1, false, false)).toBeNull();
    expect(pause.update(1, false, false)).toBeNull();
    expect(pause.update(1, false, false)).toBe('pause');
    expect(AUTO_PAUSE_AFTER_S).toBe(3);
    expect(pause.update(1, false, false)).toBeNull();
    expect(pause.update(1, true, false)).toBe('resume');
    expect(pause.paused).toBe(false);
  });
  it('ne s’arrête pas quand le vélo roule encore, en descente par exemple', () => {
    const pause = new AutoPause();
    for (let i = 0; i < 30; i++) expect(pause.update(1, false, true)).toBeNull();
    expect(pause.paused).toBe(false);
  });
  it('repart de zéro après un coup de pédale', () => {
    const pause = new AutoPause();
    pause.update(2, false, false);
    pause.update(1, true, false);
    expect(pause.update(2, false, false)).toBeNull();
  });
});

describe('zones de puissance', () => {
  it('classe la puissance selon la FTP', () => {
    expect(powerZone(100, 250)).toBe(1);
    expect(powerZone(160, 250)).toBe(2);
    expect(powerZone(200, 250)).toBe(3);
    expect(powerZone(250, 250)).toBe(4);
    expect(powerZone(290, 250)).toBe(5);
    expect(powerZone(350, 250)).toBe(6);
    expect(powerZone(500, 250)).toBe(7);
    expect(powerZone(200, 0)).toBe(0);
  });
  it('compte le temps passé dans chaque zone', () => {
    const seconds = timeInZones([100, 100, 250, 600], 250);
    expect(seconds).toEqual([2, 0, 0, 1, 0, 0, 1]);
  });
});

describe('alertes d’effort', () => {
  it('prévient quand la puissance dépasse la FTP pendant deux minutes, puis se tait un moment', () => {
    const alerts = new EffortAlerts();
    const messages: string[] = [];
    for (let t = 0; t < 130; t++) {
      const m = alerts.update({ powerW: 300, cadenceRpm: 90 }, 250, false);
      if (m) messages.push(m);
    }
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('FTP');
    for (let t = 0; t < 100; t++) expect(alerts.update({ powerW: 300, cadenceRpm: 90 }, 250, false)).toBeNull();
  });
  it('ne gronde pas pendant une séance guidée', () => {
    const alerts = new EffortAlerts();
    for (let t = 0; t < 200; t++) expect(alerts.update({ powerW: 400, cadenceRpm: 90 }, 250, true)).toBeNull();
  });
  it('signale une cadence trop basse tenue plusieurs secondes', () => {
    const alerts = new EffortAlerts();
    let message: string | null = null;
    for (let t = 0; t < 25; t++) message = alerts.update({ powerW: 200, cadenceRpm: 50 }, 250, false) ?? message;
    expect(message).toContain('Cadence');
  });
  it('ignore une cadence nulle : on ne pédale pas', () => {
    const alerts = new EffortAlerts();
    for (let t = 0; t < 60; t++) expect(alerts.update({ powerW: 0, cadenceRpm: 0 }, 250, false)).toBeNull();
  });
});

describe('meilleures puissances', () => {
  it('trouve le meilleur effort sur chaque durée', () => {
    const samples = ride(600, (t) => (t >= 100 && t < 400 ? 300 : 150));
    expect(bestPower(samples, 60)).toBeCloseTo(300);
    expect(bestPower(samples, 300)).toBeCloseTo(300);
    expect(bestPower(samples, 1200)).toBeNull();
    expect(powerBests(samples)).toEqual({ 5: 300, 60: 300, 300: 300 });
  });
  it('estime la FTP à 95 % du meilleur effort de 20 minutes', () => {
    expect(estimateFtp(300)).toBe(285);
    expect(estimateFtp(undefined)).toBeNull();
  });
  it('résume une portion de la sortie', () => {
    const samples = ride(100, (t) => (t < 50 ? 100 : 300));
    const part = rangeStats(samples, 51, 100)!;
    expect(part.avgPowerW).toBeCloseTo(300);
    expect(part.durationS).toBe(49);
    expect(part.distanceKm).toBeCloseTo(0.245);
    expect(rangeStats(samples, 5, 5)).toBeNull();
  });
});

describe('points compacts', () => {
  it('rendent les mêmes points après aller-retour, à l’arrondi près', () => {
    const samples = ride(5, (t) => 200 + t, null);
    samples[2].heartRateBpm = 151;
    const back = unpackSamples(packSamples(samples));
    expect(back).toHaveLength(5);
    expect(back[2].heartRateBpm).toBe(151);
    expect(back[0].heartRateBpm).toBeNull();
    expect(back[4].powerW).toBe(204);
    expect(back[4].t).toBe(5);
  });
});

describe('historique des sorties', () => {
  const log = (startedAt: number, samples: RideSample[], routeId: string | null = 'ventoux') => ({
    name: 'Ventoux',
    routeId,
    startedAt,
    elapsedS: samples.length,
    distanceKm: samples[samples.length - 1].distanceM / 1000,
    samples,
    stats: rideStats(samples, 250),
  });

  it('range les sorties de la plus récente à la plus ancienne et garde leurs points', () => {
    const store = new MemoryStore();
    addRide(log(1000, ride(120)), store);
    addRide(log(5000, ride(180)), store);
    const list = loadHistory(store);
    expect(list.map((e) => e.id)).toEqual([5000, 1000]);
    expect(loadSamples(5000, store)).toHaveLength(180);
  });
  it('n’ajoute pas deux fois la même sortie et refuse les sorties trop courtes', () => {
    const store = new MemoryStore();
    expect(addRide(log(1000, ride(30)), store)).toBeNull();
    addRide(log(1000, ride(120)), store);
    addRide(log(1000, ride(120)), store);
    expect(loadHistory(store)).toHaveLength(1);
  });
  it('ne garde les points que des sorties les plus récentes', () => {
    const store = new MemoryStore();
    for (let i = 0; i < KEPT_SAMPLES + 3; i++) addRide(log(1000 + i, ride(90)), store);
    const list = loadHistory(store);
    expect(list).toHaveLength(KEPT_SAMPLES + 3);
    expect(list.filter((e) => e.detailed)).toHaveLength(KEPT_SAMPLES);
    expect(loadSamples(1000, store)).toBeNull();
    expect(loadSamples(1000 + KEPT_SAMPLES + 2, store)).not.toBeNull();
  });
  it('supprime une sortie et ses points', () => {
    const store = new MemoryStore();
    addRide(log(1000, ride(120)), store);
    deleteRide(1000, store);
    expect(loadHistory(store)).toEqual([]);
    expect(loadSamples(1000, store)).toBeNull();
  });
  it('garde la meilleure puissance de chaque durée sur toutes les sorties', () => {
    const store = new MemoryStore();
    addRide(log(1000, ride(400, () => 200)), store);
    addRide(log(2000, ride(400, () => 260)), store);
    const history = loadHistory(store);
    expect(personalBests(history)[300]).toBe(260);
    expect(personalBests(history, 2000)[300]).toBe(200);
  });
  it('cumule la semaine', () => {
    const store = new MemoryStore();
    const now = 10 * 24 * 3600 * 1000;
    addRide(log(now - 2 * 24 * 3600 * 1000, ride(120)), store);
    addRide(log(now - 9 * 24 * 3600 * 1000, ride(120)), store);
    const week = weekTotals(loadHistory(store), now);
    expect(week.rides).toBe(1);
    expect(week.elapsedS).toBe(120);
  });
  it('choisit comme référence la sortie la plus rapide du même parcours', () => {
    const store = new MemoryStore();
    addRide(log(1000, ride(300)), store);
    const fast = ride(300).map((s) => ({ ...s, distanceM: s.t * 8 }));
    addRide(log(2000, fast), store);
    addRide(log(3000, ride(300), 'tourmalet'), store);
    expect(referenceRide('ventoux', 1, store)![299].distanceM).toBe(2400);
    expect(referenceRide('izoard', 1, store)).toBeNull();
  });
  it('reconstruit un récap à partir des points', () => {
    const summary = summaryFromSamples(ride(100), 250, 42);
    expect(summary.elapsedS).toBe(100);
    expect(summary.distanceKm).toBeCloseTo(0.5);
    expect(summary.stats.avgPowerW).toBeCloseTo(200);
    expect(summary.startedAt).toBe(42);
  });
});

describe('reprise d’une sortie interrompue', () => {
  const saved = (elapsedS: number, savedAt: number): SavedRide => ({
    routeId: 'ventoux',
    name: 'Ventoux',
    workout: null,
    state: { elapsedS, energyJ: 1000, maxPowerW: 300, distanceM: 2500, laps: 0, startedAt: 7 },
    samples: ride(Math.floor(elapsedS)),
    savedAt,
  });

  it('retrouve la sortie sauvegardée', () => {
    const store = new MemoryStore();
    saveInProgress(saved(120, 1000), store);
    const back = loadInProgress(2000, store)!;
    expect(back.state.distanceM).toBe(2500);
    expect(back.samples).toHaveLength(120);
    expect(back.routeId).toBe('ventoux');
  });
  it('n’en propose pas une trop courte ou trop ancienne', () => {
    const store = new MemoryStore();
    saveInProgress(saved(30, 1000), store);
    expect(loadInProgress(2000, store)).toBeNull();
    saveInProgress(saved(300, 1000), store);
    expect(loadInProgress(1000 + MAX_AGE_MS + 1, store)).toBeNull();
  });
  it('l’oublie quand on l’efface', () => {
    const store = new MemoryStore();
    saveInProgress(saved(300, 1000), store);
    clearInProgress(store);
    expect(loadInProgress(2000, store)).toBeNull();
    expect(store.keys()).toEqual([]);
  });
});

describe('peloton', () => {
  const flat: PelotonRoute = { lengthM: 50000, gradeAt: () => 0, eleAt: () => 100 };

  it('fait rouler chaque coéquipier à son niveau', () => {
    const peloton = new Peloton(flat, DEFAULT_SETUP, 250, 12, 12);
    for (let i = 0; i < 600; i++) peloton.advance(0.5);
    const [hugo, camille, mathis, lea] = peloton.states();
    expect(hugo.traveledM).toBeLessThan(camille.traveledM);
    expect(camille.traveledM).toBeLessThan(mathis.traveledM);
    expect(mathis.traveledM).toBeLessThan(lea.traveledM);
    expect(lea.speedKmh).toBeGreaterThan(25);
  });
  it('donne le coéquipier devant et celui derrière', () => {
    const peloton = new Peloton(flat, DEFAULT_SETUP, 250, 12, 12);
    for (let i = 0; i < 600; i++) peloton.advance(0.5);
    const states = peloton.states();
    const user = (states[1].traveledM + states[2].traveledM) / 2;
    const { ahead, behind } = peloton.neighbours(user);
    expect(ahead?.name).toBe('Mathis');
    expect(behind?.name).toBe('Camille');
    expect(ahead!.gapM).toBeGreaterThan(0);
    expect(behind!.gapM).toBeLessThanOrEqual(0);
  });
  it('arrête les coéquipiers sur la ligne d’arrivée', () => {
    const short: PelotonRoute = { lengthM: 200, gradeAt: () => 0, eleAt: () => 100 };
    const peloton = new Peloton(short, DEFAULT_SETUP, 250, 12, 12);
    for (let i = 0; i < 200; i++) peloton.advance(0.5);
    for (const s of peloton.states()) {
      expect(s.distM).toBe(200);
      expect(s.traveledM).toBeCloseTo(200);
    }
  });
  it('reboucle sur un parcours en boucle', () => {
    const loop: PelotonRoute = { lengthM: 3000, loop: { fromM: 100, toM: 1100 }, gradeAt: () => 0, eleAt: () => 0 };
    const peloton = new Peloton(loop, DEFAULT_SETUP, 250, 100, 0);
    for (let i = 0; i < 400; i++) peloton.advance(0.5);
    for (const s of peloton.states()) {
      expect(s.distM).toBeGreaterThanOrEqual(100);
      expect(s.distM).toBeLessThan(1100);
      expect(s.traveledM).toBeGreaterThan(1000);
    }
  });
});

describe('ambiance', () => {
  it('assombrit et épaissit la brume quand le temps se couvre', () => {
    const clear = ambianceLook({ weather: 'degage', moment: 'jour' });
    const fog = ambianceLook({ weather: 'brouillard', moment: 'jour' });
    const rain = ambianceLook({ weather: 'pluie', moment: 'jour' });
    expect(fog.fogMultiplier).toBeGreaterThan(clear.fogMultiplier);
    expect(rain.sunIntensity).toBeLessThan(clear.sunIntensity);
    expect(rain.rain).toBe(1);
    expect(clear.rain).toBe(0);
  });
  it('baisse le soleil le soir', () => {
    const noon = ambianceLook({ weather: 'degage', moment: 'jour' });
    const dusk = ambianceLook({ weather: 'degage', moment: 'soir' });
    expect(dusk.sunDirection[1]).toBeLessThan(noon.sunDirection[1]);
    expect(dusk.sunIntensity).toBeLessThan(noon.sunIntensity);
  });
  it('décrit chaque choix du menu', () => {
    expect(WEATHERS.map((w) => w.id)).toEqual(['degage', 'nuageux', 'brouillard', 'pluie', 'variable']);
    expect(MOMENTS.map((m) => m.id)).toEqual(['matin', 'jour', 'soir', 'nuit', 'reel']);
  });
});
