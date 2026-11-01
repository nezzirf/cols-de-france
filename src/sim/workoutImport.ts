// Import d'une séance depuis un fichier : .zwo (Zwift, lu aussi par de nombreux sites d'entraînement)
// ou .mrc / .erg (courbe de puissance en texte). La séance est convertie en blocs, en % de FTP.

import { newBlock, type Workout, type WorkoutBlock } from './workout';

export interface ImportResult {
  workout: Workout;
  /** Ce qui n'a pas d'équivalent exact : le joueur doit le savoir. */
  notes: string[];
}

export const MAX_IMPORT_BYTES = 1_000_000;
const MAX_NAME = 40;
const MIN_PCT = 20;
const MAX_PCT = 200;
const MIN_S = 5;
const MAX_S = 10800;
/** Puissance donnée à un bloc « roulage libre », qui n'a pas de consigne. */
const FREE_RIDE_PCT = 55;
const SAME_PCT = 0.5;

const clampPct = (v: number): number => Math.max(MIN_PCT, Math.min(MAX_PCT, Math.round(v)));
const clampS = (v: number): number => Math.max(MIN_S, Math.min(MAX_S, Math.round(v)));

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function newId(): string {
  return `seance-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function stem(fileName: string): string {
  return fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

function block(kind: Parameters<typeof newBlock>[0], over: Partial<WorkoutBlock>): WorkoutBlock {
  return { ...newBlock(kind), ...over };
}

// ───── .zwo ─────

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? '');
  return out;
}

function pick(a: Record<string, string>, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number.parseFloat(a[key.toLowerCase()] ?? '');
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

/** Zwift donne la puissance en fraction de la FTP (0,75) ; certains exports écrivent déjà des pourcents. */
const toPct = (v: number): number => (v > 5 ? v : v * 100);

const ZWO_IGNORED = new Set(['workout_file', 'workout', 'name', 'author', 'description', 'sporttype', 'tags', 'tag', 'category', 'subcategory', 'textevent', 'message']);

export function parseZwo(text: string, fallbackName: string): ImportResult {
  const region = /<\s*workout\b[^>]*>([\s\S]*?)<\s*\/\s*workout\s*>/i.exec(text);
  if (!region) throw new Error('Ce fichier ne ressemble pas à une séance Zwift (.zwo) : aucun bloc de séance trouvé.');
  const blocks: WorkoutBlock[] = [];
  const notes: string[] = [];
  let freeRides = 0;
  let skipped = 0;

  for (const m of region[1].matchAll(/<\s*([A-Za-z][\w]*)\b([^<>]*?)\/?\s*>/g)) {
    const tag = m[1].toLowerCase();
    const a = attributes(m[2]);
    switch (tag) {
      case 'warmup':
      case 'cooldown':
      case 'ramp': {
        const low = toPct(pick(a, tag === 'cooldown' ? 0.75 : 0.25, 'powerlow', 'power'));
        const high = toPct(pick(a, tag === 'cooldown' ? 0.25 : 0.75, 'powerhigh', 'power'));
        const kind = tag === 'warmup' ? 'echauffement' : tag === 'cooldown' ? 'recuperation' : 'rampe';
        blocks.push(block(kind, { durationS: clampS(pick(a, 300, 'duration')), fromPct: clampPct(low), toPct: clampPct(high) }));
        break;
      }
      case 'steadystate': {
        const pct = clampPct(toPct(pick(a, 0.5, 'power')));
        blocks.push(block('stable', { durationS: clampS(pick(a, 300, 'duration')), fromPct: pct, toPct: pct }));
        break;
      }
      case 'intervalst':
        blocks.push(
          block('intervalles', {
            repeat: Math.max(1, Math.min(60, Math.round(pick(a, 1, 'repeat')))),
            durationS: clampS(pick(a, 30, 'onduration')),
            restS: clampS(pick(a, 30, 'offduration')),
            fromPct: clampPct(toPct(pick(a, 1, 'onpower'))),
            toPct: clampPct(toPct(pick(a, 0.5, 'offpower'))),
          }),
        );
        break;
      case 'freeride':
      case 'maxeffort':
        // Pas de consigne : le home trainer ne peut pas « laisser libre » en mode ERG.
        freeRides++;
        blocks.push(block('stable', { durationS: clampS(pick(a, 300, 'duration')), fromPct: FREE_RIDE_PCT, toPct: FREE_RIDE_PCT }));
        break;
      default:
        if (!ZWO_IGNORED.has(tag) && 'duration' in a) skipped++;
    }
  }
  if (blocks.length === 0) throw new Error('Aucun bloc de séance trouvé dans ce fichier.');
  if (freeRides > 0) notes.push(`${freeRides} bloc${freeRides > 1 ? 's' : ''} libre${freeRides > 1 ? 's' : ''} remplacé${freeRides > 1 ? 's' : ''} par ${FREE_RIDE_PCT} % de la FTP`);
  if (skipped > 0) notes.push(`${skipped} bloc${skipped > 1 ? 's' : ''} de type inconnu ignoré${skipped > 1 ? 's' : ''}`);

  const named = /<\s*name\s*>([\s\S]*?)<\s*\/\s*name\s*>/i.exec(text)?.[1]?.trim();
  const name = decode(named || fallbackName).slice(0, MAX_NAME) || 'Séance importée';
  return { workout: { id: newId(), name, blocks }, notes };
}

// ───── .mrc / .erg ─────

export function parseMrc(text: string, fileName: string, ftp: number): ImportResult {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
  const headerEnd = at(/^\[END COURSE HEADER\]/i);
  const header = lines.slice(0, headerEnd < 0 ? 0 : headerEnd);
  const from = at(/^\[COURSE DATA\]/i);
  const to = at(/^\[END COURSE DATA\]/i);
  if (from < 0) throw new Error('Ce fichier ne ressemble pas à une séance .mrc ou .erg : aucune donnée de puissance trouvée.');

  const ext = fileName.toLowerCase().split('.').pop();
  const headerText = header.join('\n');
  // Les .erg donnent des watts, les .mrc des pourcents de FTP ; l'en-tête le dit aussi.
  const watts = /\bWATTS\b/i.test(headerText) || (!/\bPERCENT\b/i.test(headerText) && ext === 'erg');
  const fileFtp = Number.parseFloat(/^\s*FTP\s*=\s*([\d.,]+)/im.exec(headerText)?.[1]?.replace(',', '.') ?? '');
  const reference = Number.isFinite(fileFtp) && fileFtp > 0 ? fileFtp : ftp;

  const points: [number, number][] = [];
  for (const line of lines.slice(from + 1, to < 0 ? undefined : to)) {
    const m = /^(-?[\d.,]+)\s+(-?[\d.,]+)/.exec(line);
    if (!m) continue;
    const t = Number.parseFloat(m[1].replace(',', '.'));
    const p = Number.parseFloat(m[2].replace(',', '.'));
    if (Number.isFinite(t) && Number.isFinite(p)) points.push([t * 60, watts ? (p / reference) * 100 : p]);
  }
  if (points.length < 2) throw new Error('Ce fichier contient trop peu de points pour faire une séance.');

  const blocks: WorkoutBlock[] = [];
  for (let i = 1; i < points.length; i++) {
    const [t0, p0] = points[i - 1];
    const [t1, p1] = points[i];
    const dt = t1 - t0;
    // Deux points au même instant font une marche, pas un bloc.
    if (dt < 1) continue;
    if (Math.abs(p1 - p0) < SAME_PCT) {
      const pct = clampPct((p0 + p1) / 2);
      const last = blocks[blocks.length - 1];
      // Les points intermédiaires d'un palier ne le coupent pas en morceaux.
      if (last && last.kind === 'stable' && Math.abs(last.fromPct - pct) < SAME_PCT) last.durationS = clampS(last.durationS + dt);
      else blocks.push(block('stable', { durationS: clampS(dt), fromPct: pct, toPct: pct }));
    } else {
      blocks.push(block('rampe', { durationS: clampS(dt), fromPct: clampPct(p0), toPct: clampPct(p1) }));
    }
  }
  if (blocks.length === 0) throw new Error('Aucun bloc de séance trouvé dans ce fichier.');

  const notes: string[] = [];
  if (watts && !(Number.isFinite(fileFtp) && fileFtp > 0)) {
    notes.push(`puissances en watts converties avec ta FTP actuelle (${Math.round(ftp)} W)`);
  }
  const described = /^\s*DESCRIPTION\s*=\s*(.+)$/im.exec(headerText)?.[1]?.trim();
  const name = (described || stem(fileName)).slice(0, MAX_NAME) || 'Séance importée';
  return { workout: { id: newId(), name, blocks }, notes };
}

/** Lit un fichier de séance, quel que soit son format. Lève une erreur claire s'il n'en est pas une. */
export function importWorkout(fileName: string, text: string, ftp: number): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) throw new Error('Fichier trop gros pour une séance.');
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'zwo' || /<\s*workout_file\b|<\s*workout\b/i.test(text)) return parseZwo(text, stem(fileName));
  if (ext === 'mrc' || ext === 'erg' || /\[COURSE DATA\]/i.test(text)) return parseMrc(text, fileName, ftp);
  throw new Error('Format non reconnu : utilise un fichier .zwo, .mrc ou .erg.');
}
