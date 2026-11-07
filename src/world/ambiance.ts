// Ambiance de la sortie : le moment de la journée et la météo. Ils changent la lumière, le ciel et la brume,
// jamais l'effort : la pente et la vitesse restent celles de la route.
//
// Le moment peut suivre l'heure réelle (le jour se couche pour de vrai), et la météo peut changer en roulant :
// les ciels se fondent alors l'un dans l'autre au lieu de sauter d'un réglage à l'autre.

export type Weather = 'degage' | 'nuageux' | 'brouillard' | 'pluie';
export type Moment = 'matin' | 'jour' | 'soir' | 'nuit';
/** Ce que le joueur choisit : un temps fixe, ou une météo qui évolue pendant la sortie. */
export type WeatherChoice = Weather | 'variable';
/** Ce que le joueur choisit : un moment fixe, ou l'heure qu'il est vraiment. */
export type MomentChoice = Moment | 'reel';

export interface Ambiance {
  weather: WeatherChoice;
  moment: MomentChoice;
}

export const DEFAULT_AMBIANCE: Ambiance = { weather: 'degage', moment: 'jour' };

export const WEATHERS: { id: WeatherChoice; label: string }[] = [
  { id: 'degage', label: 'Dégagé' },
  { id: 'nuageux', label: 'Nuageux' },
  { id: 'brouillard', label: 'Brouillard' },
  { id: 'pluie', label: 'Pluie' },
  { id: 'variable', label: 'Variable (change en roulant)' },
];

export const MOMENTS: { id: MomentChoice; label: string }[] = [
  { id: 'matin', label: 'Matin' },
  { id: 'jour', label: 'Jour' },
  { id: 'soir', label: 'Coucher de soleil' },
  { id: 'nuit', label: 'Nuit' },
  { id: 'reel', label: 'Heure réelle' },
];

/** Lumière du moment : direction du soleil (x, y, z), couleur et force du soleil, du ciel, teinte de l'horizon. */
interface MomentLook {
  sun: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  skyIntensity: number;
  zenith: [number, number, number];
  horizonTint: [number, number, number];
  /** 0 en plein jour, 1 en pleine nuit : les étoiles apparaissent avec elle. */
  night: number;
}

const MOMENT_LOOKS: Record<Moment, MomentLook> = {
  matin: { sun: [0.55, 0.3, 0.38], sunColor: 0xffd9b0, sunIntensity: 2.4, skyIntensity: 0.9, zenith: [0.14, 0.3, 0.6], horizonTint: [1, 0.93, 0.88], night: 0 },
  jour: { sun: [0.55, 0.62, 0.38], sunColor: 0xfff3e2, sunIntensity: 3, skyIntensity: 1.05, zenith: [0.07, 0.24, 0.62], horizonTint: [1, 1, 1], night: 0 },
  soir: { sun: [0.55, 0.13, 0.38], sunColor: 0xff9a55, sunIntensity: 1.9, skyIntensity: 0.7, zenith: [0.13, 0.15, 0.4], horizonTint: [1, 0.76, 0.62], night: 0 },
  // La lune tient lieu de soleil : une lumière froide et faible, mais assez pour deviner la route.
  nuit: { sun: [0.4, 0.5, -0.5], sunColor: 0x9db4ff, sunIntensity: 0.55, skyIntensity: 0.32, zenith: [0.012, 0.025, 0.09], horizonTint: [0.17, 0.22, 0.38], night: 1 },
};

/** Les moments de la journée réelle : de l'heure (0 à 24) au moment qui y règne. */
const DAY_KEYFRAMES: [number, Moment][] = [
  [0, 'nuit'],
  [5.5, 'nuit'],
  [7, 'matin'],
  [9.5, 'jour'],
  [17.5, 'jour'],
  [19.5, 'soir'],
  [21.5, 'nuit'],
  [24, 'nuit'],
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function lerpColor(a: number, b: number, t: number): number {
  const ch = (shift: number) => Math.round(lerp((a >> shift) & 255, (b >> shift) & 255, t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

function mixMoment(a: MomentLook, b: MomentLook, t: number): MomentLook {
  return {
    sun: lerp3(a.sun, b.sun, t),
    sunColor: lerpColor(a.sunColor, b.sunColor, t),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, t),
    skyIntensity: lerp(a.skyIntensity, b.skyIntensity, t),
    zenith: lerp3(a.zenith, b.zenith, t),
    horizonTint: lerp3(a.horizonTint, b.horizonTint, t),
    night: lerp(a.night, b.night, t),
  };
}

/** La lumière à une heure donnée (0 à 24), en fondu entre les moments qui l'entourent. */
export function momentLookAtHour(hour: number): MomentLook {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < DAY_KEYFRAMES.length; i++) {
    const [h1, m1] = DAY_KEYFRAMES[i];
    if (h <= h1) {
      const [h0, m0] = DAY_KEYFRAMES[i - 1];
      return mixMoment(MOMENT_LOOKS[m0], MOMENT_LOOKS[m1], (h - h0) / (h1 - h0 || 1));
    }
  }
  return MOMENT_LOOKS.nuit;
}

/** Le moment qui domine à une heure donnée, pour les sons. */
export function momentAtHour(hour: number): Moment {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5.5 || h >= 21) return 'nuit';
  if (h < 8) return 'matin';
  if (h < 18.5) return 'jour';
  return 'soir';
}

/** Effet de la météo : couverture, assombrissement, brume, force de la lumière et pluie. */
interface WeatherLook {
  /** Seuil de couverture nuageuse du ciel (bas : couvert). */
  cover: number;
  cloudDark: number;
  fogMultiplier: number;
  /** Part de gris mélangée à la couleur de la brume. */
  fogGrey: number;
  sunFactor: number;
  skyFactor: number;
  rain: number;
}

const WEATHER_LOOKS: Record<Weather, WeatherLook> = {
  degage: { cover: 0.46, cloudDark: 0, fogMultiplier: 1, fogGrey: 0, sunFactor: 1, skyFactor: 1, rain: 0 },
  nuageux: { cover: 0.26, cloudDark: 0.3, fogMultiplier: 1.6, fogGrey: 0.35, sunFactor: 0.45, skyFactor: 0.95, rain: 0 },
  brouillard: { cover: 0.05, cloudDark: 0.15, fogMultiplier: 18, fogGrey: 0.8, sunFactor: 0.25, skyFactor: 0.95, rain: 0 },
  pluie: { cover: 0.0, cloudDark: 0.6, fogMultiplier: 6, fogGrey: 0.65, sunFactor: 0.2, skyFactor: 0.8, rain: 1 },
};

function mixWeather(a: WeatherLook, b: WeatherLook, t: number): WeatherLook {
  return {
    cover: lerp(a.cover, b.cover, t),
    cloudDark: lerp(a.cloudDark, b.cloudDark, t),
    fogMultiplier: lerp(a.fogMultiplier, b.fogMultiplier, t),
    fogGrey: lerp(a.fogGrey, b.fogGrey, t),
    sunFactor: lerp(a.sunFactor, b.sunFactor, t),
    skyFactor: lerp(a.skyFactor, b.skyFactor, t),
    rain: lerp(a.rain, b.rain, t),
  };
}

// --- Météo qui change en roulant ---------------------------------------------------------------

/** Durée d'un temps avant qu'il commence à céder la place au suivant (s). */
const SPELL_MIN_S = 420;
const SPELL_SPAN_S = 360;
/** Durée du fondu d'un temps à l'autre (s). */
const BLEND_S = 150;

/** Suite pseudo-aléatoire reproductible : une même graine donne toujours le même ciel. */
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Le temps qui suit : jamais le même, et plutôt des nuages que du brouillard. */
const NEXT_WEIGHTS: Record<Weather, [Weather, number][]> = {
  degage: [['nuageux', 0.75], ['brouillard', 0.1], ['pluie', 0.15]],
  nuageux: [['degage', 0.4], ['pluie', 0.4], ['brouillard', 0.2]],
  brouillard: [['degage', 0.45], ['nuageux', 0.45], ['pluie', 0.1]],
  pluie: [['nuageux', 0.65], ['degage', 0.2], ['brouillard', 0.15]],
};

function nextWeather(from: Weather, roll: number): Weather {
  let acc = 0;
  for (const [w, weight] of NEXT_WEIGHTS[from]) {
    acc += weight;
    if (roll < acc) return w;
  }
  return NEXT_WEIGHTS[from][0][0];
}

export interface WeatherMix {
  from: Weather;
  to: Weather;
  /** De 0 (tout `from`) à 1 (tout `to`). */
  t: number;
}

/** Le temps qu'il fait `elapsedS` secondes après le départ : une succession de temps, fondus l'un dans l'autre. */
export function weatherAt(seed: number, elapsedS: number): WeatherMix {
  const next = sequence(seed);
  let state: Weather = next() < 0.7 ? 'degage' : 'nuageux';
  let end = 0;
  for (let guard = 0; guard < 500; guard++) {
    end += SPELL_MIN_S + next() * SPELL_SPAN_S;
    const following = nextWeather(state, next());
    if (elapsedS < end) {
      const x = Math.max(0, Math.min(1, (elapsedS - (end - BLEND_S)) / BLEND_S));
      return { from: state, to: following, t: x * x * (3 - 2 * x) };
    }
    state = following;
  }
  return { from: state, to: state, t: 0 };
}

export const FOG_GREY = 0x9aa3ab;

/** Tous les réglages que la scène applique pour une ambiance donnée. */
export interface AmbianceLook {
  sunDirection: [number, number, number];
  sunColor: number;
  sunIntensity: number;
  skyIntensity: number;
  zenith: [number, number, number];
  horizonTint: [number, number, number];
  cover: number;
  cloudDark: number;
  fogMultiplier: number;
  fogGrey: number;
  /** Intensité de la pluie, de 0 à 1 : la pluie monte et retombe en douceur. */
  rain: number;
  night: number;
}

function compose(m: MomentLook, w: WeatherLook): AmbianceLook {
  // Sous les nuages, le ciel perd sa couleur : le zénith tire vers le gris.
  const grey = w.fogGrey * 0.7;
  const zenith = m.zenith.map((c, i) => c + ([0.42, 0.45, 0.5][i] * m.skyIntensity - c) * grey) as [number, number, number];
  return {
    sunDirection: m.sun,
    sunColor: m.sunColor,
    sunIntensity: m.sunIntensity * w.sunFactor,
    skyIntensity: m.skyIntensity * w.skyFactor,
    zenith,
    horizonTint: m.horizonTint,
    cover: w.cover,
    cloudDark: w.cloudDark,
    fogMultiplier: w.fogMultiplier,
    fogGrey: w.fogGrey,
    rain: w.rain,
    night: m.night,
  };
}

/** Le contexte d'une ambiance qui change : l'heure réelle, le temps écoulé depuis le départ, la graine du ciel du jour. */
export interface AmbianceClock {
  hour: number;
  elapsedS: number;
  seed: number;
}

export interface AmbianceNow {
  look: AmbianceLook;
  /** Le temps et le moment qui dominent, pour les sons. */
  weather: Weather;
  moment: Moment;
}

export function ambianceNow(ambiance: Ambiance, clock: AmbianceClock): AmbianceNow {
  const reel = ambiance.moment === 'reel';
  const moment = reel ? momentLookAtHour(clock.hour) : MOMENT_LOOKS[ambiance.moment as Moment];
  let weatherLook: WeatherLook;
  let weather: Weather;
  if (ambiance.weather === 'variable') {
    const mix = weatherAt(clock.seed, clock.elapsedS);
    weatherLook = mixWeather(WEATHER_LOOKS[mix.from], WEATHER_LOOKS[mix.to], mix.t);
    weather = mix.t < 0.5 ? mix.from : mix.to;
  } else {
    weatherLook = WEATHER_LOOKS[ambiance.weather];
    weather = ambiance.weather;
  }
  return {
    look: compose(moment, weatherLook),
    weather,
    moment: reel ? momentAtHour(clock.hour) : (ambiance.moment as Moment),
  };
}

/** Le même résultat qu'avant pour un moment et un temps fixes. */
export function ambianceLook(ambiance: Ambiance): AmbianceLook {
  return ambianceNow(ambiance, { hour: 12, elapsedS: 0, seed: 0 }).look;
}

/** Vrai quand le ciel change pendant la sortie : la scène doit alors le recalculer de temps en temps. */
export function isDynamic(ambiance: Ambiance): boolean {
  return ambiance.weather === 'variable' || ambiance.moment === 'reel';
}
