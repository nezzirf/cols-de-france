// Bêlement enregistré : les trois premières secondes d'un enregistrement de mouton (public/sounds/mouton.mp3), deux
// bêlements de suite. Il remplace la voix synthétique dès qu'il est chargé ; sans lui (hors ligne, fichier absent), le jeu
// retombe sur la voix synthétique.

import type { VoiceOptions } from './animalVoices';

export const BLEAT_URL = `${import.meta.env.BASE_URL}sounds/mouton.mp3`;
/** Durée jouée (s) : les trois premières secondes de l'enregistrement. */
const CLIP_S = 3;

interface Sample {
  buffer: AudioBuffer;
  /** Gain qui ramène le plus fort de l'enregistrement à un niveau commun. */
  scale: number;
}

const loaded = new WeakMap<BaseAudioContext, Promise<Sample | null>>();

/** Charge et décode l'enregistrement, une seule fois par contexte audio. */
export function loadBleatSample(ctx: BaseAudioContext): Promise<Sample | null> {
  let pending = loaded.get(ctx);
  if (!pending) {
    pending = fetch(BLEAT_URL)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => {
        const data = buffer.getChannelData(0);
        const end = Math.min(data.length, Math.round(CLIP_S * buffer.sampleRate));
        let peak = 0;
        for (let i = 0; i < end; i++) peak = Math.max(peak, Math.abs(data[i]));
        return { buffer, scale: peak > 0 ? 0.55 / peak : 1 };
      })
      .catch(() => null);
    loaded.set(ctx, pending);
  }
  return pending;
}

/** Joue l'enregistrement, un peu plus aigu ou grave à chaque fois ; rend sa durée (s). */
export function playBleatSample(ctx: BaseAudioContext, out: AudioNode, sample: Sample, options: VoiceOptions): number {
  const t = ctx.currentTime + 0.03;
  const rate = 0.95 + Math.random() * 0.12;
  const seconds = Math.min(CLIP_S, sample.buffer.duration) / rate;
  const source = ctx.createBufferSource();
  source.buffer = sample.buffer;
  source.playbackRate.value = rate;
  const gain = ctx.createGain();
  const level = sample.scale * Math.max(0, Math.min(1.5, options.loudness));
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(level, t + 0.03);
  gain.gain.setValueAtTime(level, t + seconds - 0.15);
  gain.gain.linearRampToValueAtTime(0, t + seconds);
  // Au loin, l'air éteint les aigus.
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.frequency.value = 9000 - 7000 * Math.max(0, Math.min(1, options.distance01));
  const stereo = ctx.createStereoPanner();
  stereo.pan.value = options.pan;
  source.connect(gain).connect(air).connect(stereo).connect(out);
  source.start(t, 0, CLIP_S);
  source.stop(t + seconds + 0.05);
  return seconds;
}
