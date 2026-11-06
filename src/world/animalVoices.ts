// Voix de la vache et du mouton, fabriquées comme une vraie voix : une source de cordes vocales (une onde riche en
// harmoniques, dont la hauteur varie et tremble) passée dans plusieurs résonances parallèles, les formants, qui se
// déplacent pendant le cri. C'est ce qui fait la voyelle : un « mmmôôô » long et grave pour la vache, un « bêêê » nasillard
// et tremblant pour le mouton.

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** Un point d'une courbe : instant (de 0 à 1 de la durée) et valeur. */
type Track = [number, number][];

interface Formant {
  /** Force de cette résonance par rapport aux autres. */
  gain: number;
  q: number;
  /** Sa fréquence (Hz) au cours du cri. */
  track: Track;
}

interface VoiceSpec {
  seconds: number;
  /** Hauteur de la voix (Hz). */
  pitch: Track;
  formants: Formant[];
  /** Enveloppe de volume. */
  amp: Track;
  /** Tremblement de la hauteur : fréquence (Hz) et amplitude (centièmes de ton). */
  vibrato: { hz: number; cents: number };
  /** Tremblement du volume, comme le « bê » haché du mouton. */
  tremolo?: { hz: number; depth: number };
  /** Part de souffle mêlé à la voix. */
  breath: number;
  /** Voix éraillée : une octave plus bas, à cette force, et une saturation douce qui durcit le timbre. */
  rasp?: { subharmonic: number; drive: number };
  /** Une attaque en « b » : un petit claquement de souffle au début du cri. */
  plosive?: number;
  /** Irrégularité de la hauteur, de 1 (normale) à plus : la voix du mouton déraille davantage. */
  unsteady?: number;
  /** Rattrapage du niveau : les résonances retirent beaucoup d'énergie à l'onde. */
  makeup: number;
}

export interface VoiceOptions {
  /** 0 à 1 : la voix est plus ou moins forte. */
  loudness: number;
  /** De −1 (à gauche) à 1 (à droite). */
  pan: number;
  /** 0 tout près, 1 au loin : plus c'est loin, plus les aigus s'éteignent. */
  distance01: number;
}

const waves = new WeakMap<BaseAudioContext, PeriodicWave>();
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Onde des cordes vocales : toutes les harmoniques, de plus en plus faibles. */
function glottal(ctx: BaseAudioContext): PeriodicWave {
  let wave = waves.get(ctx);
  if (!wave) {
    const n = 56;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let k = 1; k < n; k++) imag[k] = 1 / Math.pow(k, 1.1);
    wave = ctx.createPeriodicWave(real, imag);
    waves.set(ctx, wave);
  }
  return wave;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noises.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noises.set(ctx, buffer);
  }
  return buffer;
}

function follow(param: AudioParam, track: Track, start: number, seconds: number): void {
  param.setValueAtTime(track[0][1], start);
  for (let i = 1; i < track.length; i++) param.linearRampToValueAtTime(track[i][1], start + track[i][0] * seconds);
}

function speak(ctx: BaseAudioContext, out: AudioNode, spec: VoiceSpec, options: VoiceOptions): void {
  const t = ctx.currentTime + 0.03;
  const { seconds } = spec;
  const stop = t + seconds + 0.1;
  const loudness = Math.max(0, Math.min(1.5, options.loudness));

  const source = ctx.createOscillator();
  source.setPeriodicWave(glottal(ctx));
  follow(source.frequency, spec.pitch, t, seconds);

  // Une voix n'est jamais parfaitement stable : deux lentes irrégularités qui ne tombent jamais ensemble, plus le vibrato.
  const wobbles: GainNode[] = [];
  const wobble = (hz: number, cents: number): OscillatorNode => {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = hz;
    const depth = ctx.createGain();
    depth.gain.value = cents;
    lfo.connect(depth).connect(source.detune);
    wobbles.push(depth);
    lfo.start(t);
    lfo.stop(stop);
    return lfo;
  };
  const unsteady = spec.unsteady ?? 1;
  wobble(spec.vibrato.hz, spec.vibrato.cents);
  wobble(5.3, 14 * unsteady);
  wobble(8.9, 9 * unsteady);
  wobble(13.7, 6 * unsteady);

  const bus = ctx.createGain();
  const voiced = ctx.createGain();
  source.connect(voiced);
  if (spec.rasp) {
    // Une seconde voix une octave plus bas, un peu désaccordée : elle donne le grain rauque des bêlements.
    const sub = ctx.createOscillator();
    sub.setPeriodicWave(glottal(ctx));
    follow(sub.frequency, spec.pitch.map(([at, v]) => [at, v / 2] as [number, number]), t, seconds);
    sub.detune.value = rand(-25, 25);
    const subGain = ctx.createGain();
    subGain.gain.value = spec.rasp.subharmonic;
    // La seconde voix tremble avec la première.
    for (const depth of wobbles) depth.connect(sub.detune);
    sub.connect(subGain).connect(voiced);
    sub.start(t);
    sub.stop(stop);
  }
  let vocal: AudioNode = voiced;
  if (spec.rasp) {
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    const drive = spec.rasp.drive;
    for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * drive) / Math.tanh(drive);
    shaper.curve = curve;
    voiced.connect(shaper);
    vocal = shaper;
  }
  for (const formant of spec.formants) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = formant.q;
    follow(filter.frequency, formant.track, t, seconds);
    const gain = ctx.createGain();
    gain.gain.value = formant.gain;
    vocal.connect(filter).connect(gain).connect(bus);
  }

  const breath = ctx.createBufferSource();
  breath.buffer = noiseBuffer(ctx);
  breath.loop = true;
  const breathFilter = ctx.createBiquadFilter();
  breathFilter.type = 'bandpass';
  breathFilter.Q.value = 1.2;
  follow(breathFilter.frequency, spec.formants[1]?.track ?? spec.formants[0].track, t, seconds);
  const breathGain = ctx.createGain();
  breathGain.gain.value = spec.breath;
  breath.connect(breathFilter).connect(breathGain).connect(bus);

  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, t);
  for (const [at, level] of spec.amp) envelope.gain.linearRampToValueAtTime(level * spec.makeup * loudness, t + at * seconds);
  bus.connect(envelope);

  // Au loin, l'air éteint les aigus.
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.frequency.value = 5200 - 3800 * Math.max(0, Math.min(1, options.distance01));
  const stereo = ctx.createStereoPanner();
  stereo.pan.value = options.pan;
  air.connect(stereo).connect(out);

  if (spec.plosive) {
    const puff = ctx.createBufferSource();
    puff.buffer = noiseBuffer(ctx);
    const puffFilter = ctx.createBiquadFilter();
    puffFilter.type = 'bandpass';
    puffFilter.frequency.value = 950;
    puffFilter.Q.value = 0.9;
    const puffGain = ctx.createGain();
    puffGain.gain.setValueAtTime(0, t);
    puffGain.gain.linearRampToValueAtTime(spec.plosive * loudness, t + 0.008);
    puffGain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    puff.connect(puffFilter).connect(puffGain).connect(air);
    puff.start(t);
    puff.stop(t + 0.1);
  }

  let last: AudioNode = envelope;
  if (spec.tremolo) {
    const shake = ctx.createGain();
    shake.gain.value = 1 - spec.tremolo.depth / 2;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = spec.tremolo.hz;
    const depth = ctx.createGain();
    depth.gain.value = spec.tremolo.depth / 2;
    lfo.connect(depth).connect(shake.gain);
    lfo.start(t);
    lfo.stop(stop);
    // Un second battement, qui ne tombe pas juste : le hachage n'est jamais régulier.
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = spec.tremolo.hz * 1.37;
    const depth2 = ctx.createGain();
    depth2.gain.value = spec.tremolo.depth / 4;
    lfo2.connect(depth2).connect(shake.gain);
    lfo2.start(t);
    lfo2.stop(stop);
    envelope.connect(shake);
    last = shake;
  }

  last.connect(air);

  source.start(t);
  breath.start(t);
  source.stop(stop);
  breath.stop(stop);
}

/** « Meuh » : un « m » nasal, un long « ôô » grave dont la hauteur monte puis redescend, un « m » qui s'éteint. */
export function mooVoice(ctx: BaseAudioContext, out: AudioNode, options: VoiceOptions): void {
  const base = rand(0.92, 1.1);
  const seconds = rand(1.5, 2.2);
  const hz = (v: number): number => v * base;
  speak(
    ctx,
    out,
    {
      seconds,
      pitch: [[0, hz(88)], [0.1, hz(98)], [0.3, hz(128)], [0.55, hz(121)], [0.82, hz(104)], [1, hz(82)]],
      formants: [
        { gain: 1, q: 5, track: [[0, 290], [0.14, 320], [0.3, 470], [0.78, 440], [0.93, 330], [1, 280]] },
        { gain: 0.5, q: 7, track: [[0, 1050], [0.14, 980], [0.3, 920], [0.78, 840], [1, 1000]] },
        { gain: 0.12, q: 10, track: [[0, 2450], [1, 2350]] },
      ],
      amp: [[0, 0], [0.07, 0.3], [0.17, 0.55], [0.3, 1], [0.78, 0.85], [0.92, 0.32], [1, 0]],
      vibrato: { hz: 4.6, cents: 13 },
      breath: 0.07,
      makeup: 1.3,
    },
    options,
  );
}

/**
 * « Bêêê » : une voix de brebis, plutôt grave, nasillarde et éraillée, qui démarre sur un petit « b », monte puis
 * retombe en tremblant ; l'agneau a la même voix, plus aiguë et plus courte.
 */
export function bleatVoice(ctx: BaseAudioContext, out: AudioNode, options: VoiceOptions): void {
  const lamb = Math.random() < 0.22;
  const base = (lamb ? 1.6 : 1) * rand(0.9, 1.12);
  const seconds = lamb ? rand(0.55, 0.8) : rand(0.95, 1.4);
  const hz = (v: number): number => v * base;
  speak(
    ctx,
    out,
    {
      seconds,
      pitch: [[0, hz(255)], [0.06, hz(320)], [0.22, hz(345)], [0.55, hz(318)], [0.85, hz(270)], [1, hz(225)]],
      formants: [
        { gain: 0.5, q: 4, track: [[0, 280], [1, 260]] },
        { gain: 1, q: 4.5, track: [[0, 620], [0.2, 760], [0.6, 700], [1, 560]] },
        { gain: 0.9, q: 6, track: [[0, 1350], [0.25, 1750], [0.6, 1650], [1, 1300]] },
        { gain: 0.38, q: 8, track: [[0, 2600], [1, 2500]] },
        { gain: 0.15, q: 8, track: [[0, 3500], [1, 3300]] },
      ],
      amp: [[0, 0], [0.025, 0.85], [0.1, 1], [0.7, 0.8], [0.9, 0.4], [1, 0]],
      vibrato: { hz: 24, cents: 70 },
      tremolo: { hz: 23, depth: 0.62 },
      breath: 0.16,
      rasp: { subharmonic: 0.45, drive: 2.2 },
      plosive: 0.35,
      unsteady: 2.2,
      makeup: 0.8,
    },
    options,
  );
}
