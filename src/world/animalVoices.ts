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
  const wobble = (hz: number, cents: number): OscillatorNode => {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = hz;
    const depth = ctx.createGain();
    depth.gain.value = cents;
    lfo.connect(depth).connect(source.detune);
    lfo.start(t);
    lfo.stop(stop);
    return lfo;
  };
  wobble(spec.vibrato.hz, spec.vibrato.cents);
  wobble(5.3, 14);
  wobble(8.9, 9);

  const bus = ctx.createGain();
  for (const formant of spec.formants) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = formant.q;
    follow(filter.frequency, formant.track, t, seconds);
    const gain = ctx.createGain();
    gain.gain.value = formant.gain;
    source.connect(filter).connect(gain).connect(bus);
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
    envelope.connect(shake);
    last = shake;
  }

  // Au loin, l'air éteint les aigus.
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.frequency.value = 5200 - 3800 * Math.max(0, Math.min(1, options.distance01));
  const stereo = ctx.createStereoPanner();
  stereo.pan.value = options.pan;
  last.connect(air).connect(stereo).connect(out);

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

/** « Bêêê » : une voix plus haute, nasillarde, que son tremblement rapide hache en petits coups. */
export function bleatVoice(ctx: BaseAudioContext, out: AudioNode, options: VoiceOptions): void {
  const lamb = Math.random() < 0.22;
  const base = (lamb ? 1.55 : 1) * rand(0.9, 1.12);
  const seconds = lamb ? rand(0.5, 0.7) : rand(0.8, 1.15);
  const hz = (v: number): number => v * base;
  speak(
    ctx,
    out,
    {
      seconds,
      pitch: [[0, hz(360)], [0.09, hz(425)], [0.45, hz(450)], [0.8, hz(395)], [1, hz(330)]],
      formants: [
        { gain: 1, q: 6, track: [[0, 640], [0.5, 730], [1, 590]] },
        { gain: 0.85, q: 8, track: [[0, 1450], [0.5, 1750], [1, 1380]] },
        { gain: 0.35, q: 10, track: [[0, 2650], [1, 2550]] },
      ],
      amp: [[0, 0], [0.05, 0.7], [0.14, 1], [0.78, 0.85], [0.93, 0.35], [1, 0]],
      vibrato: { hz: 26, cents: 55 },
      tremolo: { hz: 26, depth: 0.5 },
      breath: 0.12,
      makeup: 1.6,
    },
    options,
  );
}
