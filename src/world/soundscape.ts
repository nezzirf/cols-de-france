// Ambiance sonore : des sons de paysage fabriqués en direct avec Web Audio, sans aucun fichier. Chaque milieu a son
// dosage (vagues et mouettes à la plage, oiseaux et feuilles en forêt, vent et sifflements en montagne...) ; en passant
// d'un milieu à l'autre, les sons se fondent. Le vent dans les oreilles suit la vitesse, la pluie suit la météo.

import type { Moment, Weather } from './ambiance';
import { bleatVoice, mooVoice } from './animalVoices';
import type { NearHerd } from './herds';
import { loadBleatSample, playBleatSample } from './sampleBleat';

export type Habitat = 'plage' | 'prairie' | 'foret' | 'montagne' | 'canyon' | 'desert' | 'vallee' | 'alpage' | 'haute-montagne';

export type LayerName = 'wind' | 'whistle' | 'surf' | 'gulls' | 'birds' | 'leaves' | 'crickets' | 'bells' | 'rain';
export type Levels = Record<LayerName, number>;

const SILENCE: Levels = { wind: 0, whistle: 0, surf: 0, gulls: 0, birds: 0, leaves: 0, crickets: 0, bells: 0, rain: 0 };

/** Dosage de chaque milieu, de 0 (absent) à 1 (plein). */
const PROFILE: Record<Habitat, Partial<Levels>> = {
  plage: { wind: 0.3, surf: 1, gulls: 0.8 },
  prairie: { wind: 0.25, birds: 0.55, crickets: 0.45, leaves: 0.1 },
  foret: { wind: 0.3, birds: 1, leaves: 0.8 },
  montagne: { wind: 0.75, whistle: 0.4, birds: 0.08 },
  canyon: { wind: 0.55, whistle: 0.8, birds: 0.08 },
  desert: { wind: 0.65, whistle: 0.35, crickets: 0.2 },
  vallee: { wind: 0.22, birds: 0.6, crickets: 0.3, leaves: 0.15, bells: 0.15 },
  alpage: { wind: 0.45, bells: 0.7, birds: 0.25, whistle: 0.2 },
  'haute-montagne': { wind: 1, whistle: 0.6 },
};

/** Force de chaque couche à pleine intensité : de quoi que rien ne couvre le reste ni ne sature. */
const LAYER_GAIN: Levels = { wind: 0.165, whistle: 0.09, surf: 0.34, gulls: 0.12, birds: 0.24, leaves: 0.14, crickets: 0.022, bells: 0.09, rain: 0.2 };

/** Nom d'un milieu du monde d'entraînement ou d'un col, pour l'oreille. */
export function habitatOfBiome(name: string): Habitat {
  switch (name) {
    case 'vallée':
      return 'vallee';
    case 'forêt':
      return 'foret';
    case 'haute montagne':
      return 'haute-montagne';
    default:
      return name as Habitat;
  }
}

/** Le dosage d'un endroit : les milieux pondérés par leur poids, puis modulé par le moment et la météo. */
export function habitatMix(habitats: { habitat: Habitat; weight: number }[], moment: Moment, weather: Weather): Levels {
  const mix: Levels = { ...SILENCE };
  let total = 0;
  for (const h of habitats) total += h.weight;
  if (total <= 0) return mix;
  for (const { habitat, weight } of habitats) {
    const profile = PROFILE[habitat];
    if (!profile) continue;
    for (const name of Object.keys(profile) as LayerName[]) mix[name] += ((profile[name] ?? 0) * weight) / total;
  }
  // Au petit matin les oiseaux chantent plus fort ; le soir, ce sont les grillons.
  if (moment === 'matin') mix.birds *= 1.3;
  if (moment === 'soir') {
    mix.birds *= 0.5;
    mix.crickets *= 2;
  }
  if (weather === 'pluie') {
    mix.rain = 1;
    mix.birds *= 0.15;
    mix.crickets *= 0.1;
    mix.gulls *= 0.3;
    mix.wind *= 1.2;
  } else if (weather === 'brouillard') {
    mix.birds *= 0.6;
  } else if (weather === 'nuageux') {
    mix.crickets *= 0.6;
  }
  for (const name of Object.keys(mix) as LayerName[]) mix[name] = Math.min(1, mix[name]);
  return mix;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
/** Vitesse (m/s) à partir de laquelle le vent dans les oreilles est à son maximum. */
const FULL_RUSH_MPS = 18;
const FADE_S = 1.4;

export class Soundscape {
  private ctx: AudioContext;
  private master: GainNode;
  private layers = {} as Record<LayerName, GainNode>;
  private rush: GainNode;
  /** Les rafales modulent un peu le souffle de la vitesse. */
  private rushGust: GainNode;
  private analyser: AnalyserNode;
  private noiseBuffer: AudioBuffer;
  private stops: (() => void)[] = [];
  private moment: Moment = 'jour';
  private weather: Weather = 'degage';
  private habitats: { habitat: Habitat; weight: number }[] = [];
  private levels: Levels = { ...SILENCE };
  private muted = false;
  private paused = false;
  private volume = 0.7;
  private disposed = false;
  private herd: NearHerd | null = null;
  /** Le bêlement enregistré, dès qu'il est chargé ; jusque-là, la voix synthétique. */
  private bleat: Awaited<ReturnType<typeof loadBleatSample>> = null;
  private bleatUntil = 0;

  constructor(options: { moment?: Moment; weather?: Weather; volume?: number } = {}) {
    this.moment = options.moment ?? 'jour';
    this.weather = options.weather ?? 'degage';
    this.volume = options.volume ?? 0.7;
    this.ctx = new AudioContext();
    const compressor = this.ctx.createDynamicsCompressor();
    this.master = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master.connect(compressor).connect(this.analyser).connect(this.ctx.destination);
    for (const name of Object.keys(SILENCE) as LayerName[]) {
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.master);
      this.layers[name] = gain;
    }
    this.rush = this.ctx.createGain();
    this.rush.gain.value = 0;
    this.rush.connect(this.master);
    this.rushGust = this.ctx.createGain();
    this.rushGust.gain.value = 0.55;
    this.rushGust.connect(this.rush);
    this.noiseBuffer = this.makeNoise();
    this.master.gain.value = this.volume;
    this.buildWind();
    this.buildSurf();
    this.buildLeaves();
    this.buildRain();
    this.buildCrickets();
    this.buildRush();
    this.scheduleBirds();
    this.scheduleGulls();
    this.scheduleBells();
    this.scheduleHerd();
    void loadBleatSample(this.ctx).then((sample) => (this.bleat = sample));
    void this.ctx.resume().catch(() => {});
  }

  /** Bruit rose de quelques secondes, rejoué en boucle. */
  private makeNoise(): AudioBuffer {
    const length = this.ctx.sampleRate * 4;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    }
    return buffer;
  }

  private noise(): AudioBufferSourceNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    source.start(0, Math.random() * 3);
    return source;
  }

  private filter(type: BiquadFilterType, frequency: number, q = 0.7): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    return f;
  }

  /** Appelle `step` à intervalles aléatoires (en secondes) tant que le son tourne. */
  private every(step: () => void, interval: () => number): void {
    let timer = 0;
    const run = (): void => {
      if (this.disposed) return;
      step();
      timer = window.setTimeout(run, interval() * 1000);
    };
    timer = window.setTimeout(run, rand(0.5, 2) * 1000);
    this.stops.push(() => clearTimeout(timer));
  }

  /**
   * Vent : presque calme, avec des rafales légères. Une rafale monte en une ou deux secondes, se tient un instant puis
   * retombe plus doucement, toutes les sept à seize secondes ; le sifflement des roches ne vient qu'avec elle, et le
   * souffle de la vitesse en prend un peu.
   */
  private buildWind(): void {
    const calm = 0.12;
    const gust = this.ctx.createGain();
    gust.gain.value = calm;
    this.noise().connect(this.filter('lowpass', 520)).connect(gust).connect(this.layers.wind);

    const whistle = this.filter('bandpass', 420, 10);
    const whistleGust = this.ctx.createGain();
    whistleGust.gain.value = 0;
    const whistleGain = this.ctx.createGain();
    whistleGain.gain.value = 0.7;
    this.noise().connect(whistle).connect(whistleGust).connect(whistleGain).connect(this.layers.whistle);
    this.every(() => whistle.frequency.setTargetAtTime(rand(300, 720), this.ctx.currentTime, 1.6), () => rand(2, 5));

    const swell = (param: AudioParam, base: number, peak: number, up: number, hold: number, down: number): void => {
      const t = this.ctx.currentTime;
      param.cancelScheduledValues(t);
      param.setValueAtTime(param.value, t);
      param.linearRampToValueAtTime(peak, t + up);
      param.linearRampToValueAtTime(peak * 0.9, t + up + hold);
      param.linearRampToValueAtTime(base, t + up + hold + down);
    };
    this.every(
      () => {
        const strength = rand(0.5, 0.9);
        const up = rand(1.2, 2.4);
        const hold = rand(0.8, 2.2);
        const down = rand(2.5, 4.5);
        swell(gust.gain, calm, strength, up, hold, down);
        swell(whistleGust.gain, 0, strength * 0.8, up, hold, down);
        swell(this.rushGust.gain, 0.55, 0.55 + strength * 0.4, up, hold, down);
      },
      () => rand(7, 16),
    );
  }

  /** Vagues : un bruit qui monte en trois secondes puis se retire. */
  private buildSurf(): void {
    const swell = this.ctx.createGain();
    swell.gain.value = 0.3;
    const body = this.noise().connect(this.filter('lowpass', 750));
    const foam = this.noise().connect(this.filter('bandpass', 2600, 0.4));
    const foamGain = this.ctx.createGain();
    foamGain.gain.value = 0.25;
    body.connect(swell);
    foam.connect(foamGain).connect(swell);
    swell.connect(this.layers.surf);
    this.every(
      () => {
        const t = this.ctx.currentTime;
        swell.gain.cancelScheduledValues(t);
        swell.gain.setValueAtTime(swell.gain.value, t);
        swell.gain.linearRampToValueAtTime(1, t + rand(2.5, 3.8));
        swell.gain.linearRampToValueAtTime(0.25, t + rand(6.5, 8.5));
      },
      () => rand(8, 11),
    );
  }

  /** Feuillage : un frémissement aigu qui palpite. */
  private buildLeaves(): void {
    const flutter = this.ctx.createGain();
    flutter.gain.value = 0.5;
    this.noise().connect(this.filter('bandpass', 4200, 0.6)).connect(flutter).connect(this.layers.leaves);
    this.every(() => flutter.gain.setTargetAtTime(rand(0.15, 1), this.ctx.currentTime, 0.12), () => rand(0.2, 0.7));
  }

  private buildRain(): void {
    this.noise().connect(this.filter('highpass', 1200)).connect(this.filter('lowpass', 9000)).connect(this.layers.rain);
  }

  /**
   * Grillons : une note aiguë hachée très vite, avec un second grillon un peu à côté. Ils ne chantent pas en continu, ce
   * qui finirait par agacer : une courte tirade de quelques secondes, puis un long silence.
   */
  private buildCrickets(): void {
    const gate = this.ctx.createGain();
    gate.gain.value = 0;
    gate.connect(this.layers.crickets);
    this.every(
      () => {
        if (this.levels.crickets < 0.05) return;
        const t = this.ctx.currentTime;
        gate.gain.cancelScheduledValues(t);
        gate.gain.setValueAtTime(gate.gain.value, t);
        gate.gain.linearRampToValueAtTime(1, t + 1.5);
        gate.gain.linearRampToValueAtTime(1, t + rand(3, 6));
        gate.gain.linearRampToValueAtTime(0, t + rand(8, 11));
      },
      () => rand(45, 110),
    );
    for (const [pitch, rate] of [[4300, 16], [4650, 13]] as const) {
      const carrier = this.ctx.createOscillator();
      carrier.frequency.value = pitch;
      const am = this.ctx.createGain();
      am.gain.value = 0.5;
      const lfo = this.ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = rate;
      const depth = this.ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(am.gain);
      carrier.connect(am).connect(gate);
      carrier.start();
      lfo.start();
    }
  }

  /** Vent relatif : le souffle dans les oreilles grandit avec la vitesse. */
  private buildRush(): void {
    this.noise().connect(this.filter('bandpass', 750, 0.4)).connect(this.rushGust);
  }

  private scheduleBirds(): void {
    this.every(
      () => {
        if (this.levels.birds < 0.04) return;
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = rand(-0.8, 0.8);
        pan.connect(this.layers.birds);
        const notes = 2 + Math.floor(rand(0, 4));
        const base = this.ctx.currentTime + 0.02;
        const pitch = rand(2300, 4300);
        for (let i = 0; i < notes; i++) {
          const start = base + i * rand(0.1, 0.17);
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          const from = pitch * rand(0.9, 1.15);
          osc.frequency.setValueAtTime(from, start);
          osc.frequency.exponentialRampToValueAtTime(from * (Math.random() < 0.5 ? 0.78 : 1.3), start + 0.09);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.6, start + 0.012);
          gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
          osc.connect(gain).connect(pan);
          osc.start(start);
          osc.stop(start + 0.13);
        }
      },
      () => rand(1.5, 5) / Math.max(0.15, this.levels.birds),
    );
  }

  /** Mouettes : un cri qui descend, deux ou trois fois de suite. */
  private scheduleGulls(): void {
    this.every(
      () => {
        if (this.levels.gulls < 0.05) return;
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = rand(-0.7, 0.7);
        const tone = this.filter('bandpass', 1600, 1.2);
        tone.connect(pan).connect(this.layers.gulls);
        const calls = 2 + Math.floor(rand(0, 2));
        const base = this.ctx.currentTime + 0.02;
        for (let i = 0; i < calls; i++) {
          const start = base + i * 0.55;
          const osc = this.ctx.createOscillator();
          osc.type = 'sawtooth';
          const vibrato = this.ctx.createOscillator();
          vibrato.frequency.value = 38;
          const vibratoDepth = this.ctx.createGain();
          vibratoDepth.gain.value = 60;
          vibrato.connect(vibratoDepth).connect(osc.frequency);
          const gain = this.ctx.createGain();
          osc.frequency.setValueAtTime(1750, start);
          osc.frequency.exponentialRampToValueAtTime(950, start + 0.4);
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.5, start + 0.05);
          gain.gain.linearRampToValueAtTime(0, start + 0.42);
          osc.connect(gain).connect(tone);
          for (const node of [osc, vibrato]) {
            node.start(start);
            node.stop(start + 0.45);
          }
        }
      },
      () => rand(9, 20) / Math.max(0.3, this.levels.gulls),
    );
  }

  /** Cloches de troupeau, au loin : deux notes qui se superposent et s'éteignent. */
  private scheduleBells(): void {
    this.every(
      () => {
        if (this.levels.bells < 0.05) return;
        const far = this.filter('lowpass', 2600);
        const pan = this.ctx.createStereoPanner();
        pan.pan.value = rand(-0.9, 0.9);
        far.connect(pan).connect(this.layers.bells);
        const rings = 2 + Math.floor(rand(0, 3));
        const base = this.ctx.currentTime + 0.02;
        for (let i = 0; i < rings; i++) {
          const start = base + i * rand(0.25, 0.5);
          for (const pitch of [rand(1050, 1250), rand(1650, 1900)]) {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.frequency.value = pitch;
            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.35, start + 0.004);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 1.1);
            osc.connect(gain).connect(far);
            osc.start(start);
            osc.stop(start + 1.2);
          }
        }
      },
      () => rand(5, 13) / Math.max(0.3, this.levels.bells),
    );
  }

  /** Rayon (m) dans lequel un troupeau s'entend. */
  static readonly HERD_RANGE_M = 110;

  /** Beuglements et bêlements : seulement quand un troupeau est tout près, de plus en plus fort à mesure qu'on s'en approche. */
  private scheduleHerd(): void {
    this.every(
      () => {
        const herd = this.herd;
        if (!herd || herd.distanceM > Soundscape.HERD_RANGE_M) return;
        const loudness = Math.pow(1 - herd.distanceM / Soundscape.HERD_RANGE_M, 1.6);
        if (loudness < 0.03) return;
        const voice = { loudness: loudness * 1.5, pan: herd.pan, distance01: herd.distanceM / Soundscape.HERD_RANGE_M };
        if (herd.kind === 'vache') mooVoice(this.ctx, this.master, voice);
        else if (this.bleat) {
          // L'enregistrement dure trois secondes et contient déjà deux bêlements : on attend qu'il soit fini avant de le rejouer.
          if (this.ctx.currentTime >= this.bleatUntil) this.bleatUntil = this.ctx.currentTime + playBleatSample(this.ctx, this.master, this.bleat, voice) + 0.8;
        } else {
          // Sans l'enregistrement, les moutons bêlent à deux ou trois, l'un après l'autre.
          const calls = 1 + Math.floor(rand(0, 3));
          for (let i = 0; i < calls; i++) {
            window.setTimeout(() => {
              if (!this.disposed) bleatVoice(this.ctx, this.master, { ...voice, loudness: voice.loudness * rand(0.7, 1) });
            }, i * rand(900, 1500));
          }
        }
      },
      () => rand(2.2, 5.5),
    );
  }

  setHerd(herd: NearHerd | null): void {
    this.herd = herd;
  }

  private apply(): void {
    const t = this.ctx.currentTime;
    this.levels = habitatMix(this.habitats, this.moment, this.weather);
    for (const name of Object.keys(this.layers) as LayerName[]) {
      this.layers[name].gain.setTargetAtTime(this.levels[name] * LAYER_GAIN[name], t, FADE_S);
    }
  }

  /** Les milieux traversés et leur poids : les sons se fondent d'un milieu à l'autre. */
  setHabitats(habitats: { habitat: Habitat; weight: number }[]): void {
    this.habitats = habitats;
    this.apply();
  }

  setAmbiance(moment: Moment, weather: Weather): void {
    this.moment = moment;
    this.weather = weather;
    this.apply();
  }

  /** Vitesse du cycliste (m/s). */
  setSpeed(mps: number): void {
    const share = Math.min(1, Math.max(0, mps / FULL_RUSH_MPS));
    this.rush.gain.setTargetAtTime(Math.pow(share, 1.4) * 0.38, this.ctx.currentTime, 0.4);
  }

  /** En pause, le paysage se tait. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.updateMaster();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    this.updateMaster();
    return this.muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private updateMaster(): void {
    this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : this.volume, this.ctx.currentTime, 0.25);
  }

  /** Niveau sonore actuel (0 à 1), pour vérifier qu'il y a bien du son. */
  level(): number {
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  }

  get state(): AudioContextState {
    return this.ctx.state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const stop of this.stops) stop();
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    window.setTimeout(() => void this.ctx.close().catch(() => {}), 700);
  }
}
