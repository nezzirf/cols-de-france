// Onglet Entraînement : créateur de séances par blocs.

import {
  BLOCK_LABELS,
  type BlockKind,
  expandBlocks,
  newBlock,
  totalDuration,
  trainingLoad,
  type Workout,
  WORKOUT_PRESETS,
  type WorkoutBlock,
  zoneColor,
} from '../sim/workout';
import type { AppBars, AppMode, WorkoutWhere } from '../app/profile';
import { importWorkout } from '../sim/workoutImport';
import { MAX_CLIMB_KM, MAX_GRADE_PCT, WARMUP_KM } from '../sim/customRoute';
import { CUSTOM_ROUTE_ID } from '../app/profile';
import { WORLD_ROUTE_ID } from '../sim/worldRoute';
import { drawWorkout } from './charts';
import { duration, esc, fr } from './format';
import { castSupport } from '../app/castSource';
import type { MenuContext } from './menu';

const PRESET_PREFIX = 'preset-';
const KINDS = Object.keys(BLOCK_LABELS) as BlockKind[];

const WHERE: { id: WorkoutWhere; title: string; hint: string }[] = [
  { id: 'monde', title: 'Multi Worlds', hint: 'Boucle de 46 km, six paysages' },
  { id: 'parcours', title: 'Parcours', hint: 'Un grand col, ou ton propre parcours' },
  { id: 'app', title: 'Média', hint: 'Netflix, YouTube… avec des barres minimales' },
];

const APP_MODES: { id: AppMode; title: string; hint: string }[] = [
  { id: 'capture', title: 'Capturer dans la page', hint: "L'application s'affiche entre les barres" },
  { id: 'flottante', title: 'Barre flottante', hint: 'Une petite fenêtre au-dessus de tout (Chrome, Edge)' },
  { id: 'partage', title: 'Écran partagé', hint: 'Le jeu à côté de ton application (tablette)' },
  { id: 'pastille', title: 'Pastille flottante', hint: 'Une mini-fenêtre au-dessus de Netflix en plein écran (Android)' },
];

const APP_BARS: { id: AppBars; label: string }[] = [
  { id: 'haut', label: 'En haut' },
  { id: 'bas', label: 'En bas' },
  { id: 'les-deux', label: 'En haut et en bas' },
];

const APP_NOTES: Record<AppMode, string> = {
  capture:
    "Au lancement, ton navigateur te demande quelle fenêtre ou quel onglet afficher en fond. Le film reste entier, entre les barres. Netflix et d'autres services protégés peuvent apparaître en noir : dans ce cas, choisis la barre flottante.",
  partage:
    "Pour une tablette : ouvre ton application, puis place le jeu à côté d'elle avec l'écran partagé du système. Le jeu n'affiche que le panneau de la sortie, en gros, avec un bouton pour la terminer.",
  pastille:
    "Pour un téléphone ou une tablette Android (Chrome) : le jeu ouvre une petite fenêtre vidéo avec tes chiffres, qui reste par-dessus les autres applications. Lance la sortie, ouvre Netflix en plein écran, puis déplace ou agrandis la pastille avec les doigts. Garde le jeu ouvert en arrière-plan, sans le fermer.",
  flottante:
    "Le jeu ouvre une barre qui reste au-dessus de toutes tes fenêtres, même d'une vidéo en plein écran (Chrome ou Edge sur ordinateur). Ouvre ton application en plein écran, puis glisse la barre en haut ou en bas.",
};

type NumberField = 'durationS' | 'fromPct' | 'toPct' | 'repeat' | 'restS';

interface Field {
  key: NumberField;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: 'time' | 'pct' | 'count';
}

const TIME = { min: 15, max: 10800, step: 15, unit: 'time' } as const;
const POWER = { min: 20, max: 200, step: 1, unit: 'pct' } as const;

function fieldsOf(kind: BlockKind): Field[] {
  switch (kind) {
    case 'stable':
      return [
        { key: 'durationS', label: 'Durée', ...TIME },
        { key: 'fromPct', label: 'Puissance', ...POWER },
      ];
    case 'intervalles':
      return [
        { key: 'repeat', label: 'Répétitions', min: 1, max: 30, step: 1, unit: 'count' },
        { key: 'durationS', label: 'Durée de l’effort', ...TIME },
        { key: 'fromPct', label: 'Puissance de l’effort', ...POWER },
        { key: 'restS', label: 'Durée de la récupération', ...TIME },
        { key: 'toPct', label: 'Puissance de récupération', ...POWER },
      ];
    default:
      return [
        { key: 'durationS', label: 'Durée', ...TIME },
        { key: 'fromPct', label: 'Puissance au début', ...POWER },
        { key: 'toPct', label: 'Puissance à la fin', ...POWER },
      ];
  }
}

const blockColor = (b: WorkoutBlock): string => zoneColor(b.kind === 'intervalles' || b.kind === 'stable' ? b.fromPct : (b.fromPct + b.toPct) / 2);

function blockLength(b: WorkoutBlock): number {
  return totalDuration(expandBlocks([b]));
}

export function renderWorkouts(page: HTMLElement, ctx: MenuContext): void {
  const p = ctx.profile;
  const known = () => [...ctx.workouts, ...WORKOUT_PRESETS];
  const clone = (w: Workout): Workout => JSON.parse(JSON.stringify(w)) as Workout;
  const blank = (): Workout => ({
    id: `seance-${Date.now()}`,
    name: 'Nouvelle séance',
    blocks: [newBlock('echauffement'), newBlock('stable'), newBlock('recuperation')],
  });

  let draft = clone(known().find((w) => w.id === p.workoutId) ?? WORKOUT_PRESETS[0]);
  let selected = 0;

  page.innerHTML = `
    <section class="m-panel" data-tone="blue" aria-label="Lieu de la sortie">
      <h3 class="m-caption">Où rouler la séance ?</h3>
      <div class="m-options">
        ${WHERE.map((w) => `<button class="m-option" data-where="${w.id}"><b>${w.title}</b><span>${w.hint}</span></button>`).join('')}
      </div>
      <div class="m-panel-sub" data-tone="green" data-r="routePick" hidden>
        <div class="m-group">
          <h4 class="m-caption">Choisis le parcours</h4>
          <div class="m-options">
            ${ctx.routes
              .map((r) => `<button class="m-option" data-route="${r.id}"><b>${r.name}</b><span>${r.massif} · ${fr(r.climb.lengthKm)} km · ${fr(r.climb.avgGradePct)} % · ${r.climb.topM} m</span></button>`)
              .join('')}
            <button class="m-option" data-route="${CUSTOM_ROUTE_ID}"><b>Personnalisé</b><span>${WARMUP_KM} km de plat, puis la montée que tu choisis</span></button>
          </div>
        </div>
        <div class="m-group m-custom-row" data-r="customRow">
          <label class="m-field"><span class="m-caption">Distance de la montée <b data-r="km"></b></span>
            <input type="range" min="1" max="${MAX_CLIMB_KM}" step="0.5" data-f="customKm" value="${p.customKm}"></label>
          <label class="m-field"><span class="m-caption">Pente <b data-r="grade"></b></span>
            <input type="range" min="0" max="${MAX_GRADE_PCT}" step="0.5" data-f="customGrade" value="${p.customGrade}"></label>
        </div>
      </div>
      <div class="m-panel-sub" data-tone="violet" data-r="app" hidden>
        <div class="m-group">
          <h4 class="m-caption">Affichage de l'application</h4>
          <div class="m-options">
            ${APP_MODES.map((m) => `<button class="m-option" data-app-mode="${m.id}"><b>${m.title}</b><span>${m.hint}</span></button>`).join('')}
          </div>
        </div>
        <div class="m-group" data-r="barsRow">
          <h4 class="m-caption">Position des barres</h4>
          <div class="m-segment">${APP_BARS.map((b) => `<button class="m-seg" data-app-bars="${b.id}">${b.label}</button>`).join('')}</div>
        </div>
        <p class="m-note" data-r="appNote"></p>
      </div>
    </section>
    <input type="file" data-r="file" accept=".zwo,.mrc,.erg,.xml,.txt" multiple hidden>
    <div class="m-wk">
      <div class="m-wk-side">
        <div class="m-wk-list" data-r="list"></div>
        <p class="m-note" data-r="importNote" role="status"></p>
      </div>
      <section class="m-card m-wk-editor">
        <div class="m-wk-head">
          <label class="m-field">
            <span class="m-caption">Nom de la séance</span>
            <input class="m-wk-name" data-r="wkName" maxlength="40" aria-label="Nom de la séance">
          </label>
          <div class="m-wk-stats" data-r="wkStats"></div>
        </div>
        <div class="m-wk-section">
          <canvas class="m-wk-chart" data-r="chart" aria-label="Déroulé de la séance : clique sur un bloc pour le modifier"></canvas>
          <p class="m-note">Clique sur le graphique pour choisir un bloc.</p>
        </div>
        <div class="m-wk-section">
          <h4 class="m-caption">Ajouter un bloc</h4>
          <div class="m-wk-palette">
            ${KINDS.map((k) => `<button class="m-add" data-k="${k}">+ ${BLOCK_LABELS[k]}</button>`).join('')}
          </div>
        </div>
        <div class="m-wk-section">
          <h4 class="m-caption">Blocs de la séance</h4>
          <div class="m-wk-blocks" data-r="blocks"></div>
        </div>
        <div class="m-wk-section m-wk-form" data-r="form"></div>
        <div class="m-wk-actions">
          <button class="m-ghost" data-a="delete">Supprimer</button>
          <button class="m-ghost" data-a="save">Enregistrer</button>
          <button class="m-primary" data-a="use"></button>
        </div>
        <p class="m-note">Pendant la séance, le home trainer impose la puissance (mode ERG). La sortie s'arrête à la fin de la séance.</p>
      </section>
    </div>`;

  // Une tablette ne capture pas d'application et n'a pas de barre flottante : on lui propose l'écran partagé.
  const support = castSupport();
  const usable = (m: AppMode) => (m === 'capture' ? support.capture : m === 'flottante' ? support.floating : m === 'pastille' ? support.pill : true);
  if (!usable(p.appMode)) p.appMode = 'partage';

  const showWhere = () => {
    const mark = (selector: string, key: string, value: string) =>
      page.querySelectorAll<HTMLElement>(selector).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset[key] === value)));
    mark('[data-where]', 'where', p.workoutWhere);
    mark('[data-app-mode]', 'appMode', p.appMode);
    page.querySelectorAll<HTMLButtonElement>('[data-app-mode]').forEach((b) => {
      const ok = usable(b.dataset.appMode as AppMode);
      b.disabled = !ok;
      b.title = ok ? '' : 'Pas disponible dans ce navigateur';
    });
    mark('[data-app-bars]', 'appBars', p.appBars);
    mark('[data-route]', 'route', p.routeId);
    (page.querySelector('[data-r="routePick"]') as HTMLElement).hidden = p.workoutWhere !== 'parcours';
    (page.querySelector('[data-r="customRow"]') as HTMLElement).hidden = p.routeId !== CUSTOM_ROUTE_ID;
    (page.querySelector('[data-r="km"]') as HTMLElement).textContent = `${fr(p.customKm)} km`;
    (page.querySelector('[data-r="grade"]') as HTMLElement).textContent = `${fr(p.customGrade)} %`;
    (page.querySelector('[data-r="app"]') as HTMLElement).hidden = p.workoutWhere !== 'app';
    // La barre flottante est une seule fenêtre : choisir sa place est l'affaire du joueur.
    (page.querySelector('[data-r="barsRow"]') as HTMLElement).hidden = p.appMode !== 'capture';
    (page.querySelector('[data-r="appNote"]') as HTMLElement).textContent = APP_NOTES[p.appMode];
  };
  const onChoice = (selector: string, apply: (value: string) => void, key: string) =>
    page.querySelectorAll<HTMLElement>(selector).forEach((b) =>
      b.addEventListener('click', () => {
        apply(b.dataset[key]!);
        showWhere();
        ctx.changed();
      }),
    );
  onChoice(
    '[data-where]',
    (v) => {
      p.workoutWhere = v as WorkoutWhere;
      // Le Multi Worlds a son propre choix : ici, il faut un col ou le parcours personnalisé.
      if (v === 'parcours' && p.routeId === WORLD_ROUTE_ID) p.routeId = ctx.routes[0]?.id ?? CUSTOM_ROUTE_ID;
    },
    'where',
  );
  onChoice('[data-route]', (v) => (p.routeId = v), 'route');
  page.querySelectorAll<HTMLInputElement>('[data-f]').forEach((input) =>
    input.addEventListener('input', () => {
      p[input.dataset.f as 'customKm' | 'customGrade'] = Number(input.value);
      showWhere();
      ctx.changed();
    }),
  );
  onChoice('[data-app-mode]', (v) => (p.appMode = v as AppMode), 'appMode');
  onChoice('[data-app-bars]', (v) => (p.appBars = v as AppBars), 'appBars');
  showWhere();

  const q = <T extends HTMLElement>(name: string) => page.querySelector(`[data-r="${name}"]`) as T;
  const chart = q<HTMLCanvasElement>('chart');

  const stored = () => draft.id.startsWith(PRESET_PREFIX) || ctx.workouts.some((w) => w.id === draft.id);

  /** Un modèle n'est jamais modifié : la première retouche en fait une séance personnelle. */
  const edited = () => {
    if (!draft.id.startsWith(PRESET_PREFIX)) return;
    draft.id = `seance-${Date.now()}`;
    draft.name = `${draft.name} (perso)`;
    q<HTMLInputElement>('wkName').value = draft.name;
    showList();
  };

  const save = () => {
    if (draft.id.startsWith(PRESET_PREFIX)) return;
    const copy = clone(draft);
    const at = ctx.workouts.findIndex((w) => w.id === copy.id);
    if (at >= 0) ctx.workouts[at] = copy;
    else ctx.workouts.unshift(copy);
    ctx.saveWorkouts();
  };

  const showChart = () => {
    const steps = expandBlocks(draft.blocks);
    drawWorkout(chart, steps, { selectedBlock: selected });
    const total = totalDuration(steps);
    q('wkStats').innerHTML = `
      <div><b>${duration(total)}</b>durée</div>
      <div><b>${Math.round(trainingLoad(steps))}</b>TSS</div>`;
  };

  const showActions = () => {
    const used = p.workoutId === draft.id;
    const use = page.querySelector('[data-a="use"]') as HTMLElement;
    use.textContent = used ? '✓ Séance choisie' : 'Choisir pour la sortie';
    use.dataset.on = String(used);
    const preset = draft.id.startsWith(PRESET_PREFIX);
    (page.querySelector('[data-a="save"]') as HTMLButtonElement).disabled = preset;
    (page.querySelector('[data-a="delete"]') as HTMLButtonElement).disabled = preset || !stored();
  };

  const showBlocks = () => {
    q('blocks').innerHTML = draft.blocks
      .map(
        (b, i) => `<button class="m-block" data-i="${i}" aria-pressed="${i === selected}" style="--zone:${blockColor(b)}">
          <b>${BLOCK_LABELS[b.kind]}</b><span>${duration(blockLength(b))}</span>
        </button>`,
      )
      .join('');
    q('blocks')
      .querySelectorAll<HTMLElement>('[data-i]')
      .forEach((b) => b.addEventListener('click', () => select(Number(b.dataset.i))));
  };

  const fieldValue = (f: Field, v: number): string => {
    if (f.unit === 'time') return duration(v);
    if (f.unit === 'count') return `× ${v}`;
    return `${v} % · ${Math.round((v / 100) * p.ftp)} W`;
  };

  const showForm = () => {
    const form = q('form');
    const block = draft.blocks[selected];
    if (!block) {
      form.innerHTML = '<p class="m-note">Ajoute un bloc pour commencer.</p>';
      return;
    }
    form.innerHTML = `
      <div class="m-form-head">
        <h4 class="m-caption">Réglages · ${BLOCK_LABELS[block.kind]}</h4>
        <span class="m-form-tools">
          <button class="m-ghost m-small" data-m="-1">← Avancer</button>
          <button class="m-ghost m-small" data-m="1">Reculer →</button>
          <button class="m-ghost m-small" data-m="0">Retirer</button>
        </span>
      </div>
      <div class="m-form-fields">
        ${fieldsOf(block.kind)
          .map(
            (f) => `<label><span>${f.label} <b data-v="${f.key}">${fieldValue(f, block[f.key])}</b></span>
              <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" data-k2="${f.key}" value="${block[f.key]}"></label>`,
          )
          .join('')}
      </div>`;
    for (const f of fieldsOf(block.kind)) {
      const input = form.querySelector(`[data-k2="${f.key}"]`) as HTMLInputElement;
      input.addEventListener('input', () => {
        edited();
        block[f.key] = Number(input.value);
        (form.querySelector(`[data-v="${f.key}"]`) as HTMLElement).textContent = fieldValue(f, block[f.key]);
        showBlocks();
        showChart();
        showActions();
      });
    }
    form.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => {
      b.addEventListener('click', () => {
        edited();
        const move = Number(b.dataset.m);
        if (move === 0) {
          draft.blocks.splice(selected, 1);
          selected = Math.min(selected, draft.blocks.length - 1);
        } else {
          const to = selected + move;
          if (to < 0 || to >= draft.blocks.length) return;
          [draft.blocks[selected], draft.blocks[to]] = [draft.blocks[to], draft.blocks[selected]];
          selected = to;
        }
        showAll();
      });
    });
  };

  const select = (index: number) => {
    selected = index;
    showBlocks();
    showForm();
    showChart();
  };

  const showList = () => {
    const item = (w: Workout) => {
      const steps = expandBlocks(w.blocks);
      return `<button class="m-wk-item" data-w="${w.id}" aria-pressed="${w.id === draft.id}">
        <b>${esc(w.name)}</b><span>${duration(totalDuration(steps))} · ${Math.round(trainingLoad(steps))} TSS</span>
        ${w.id === p.workoutId ? '<em class="m-wk-chosen">✓ Pour la sortie</em>' : ''}
      </button>`;
    };
    q('list').innerHTML = `
      <button class="m-add m-wide" data-a="new">+ Nouvelle séance</button>
      <button class="m-add m-wide" data-a="import">Importer un fichier…</button>
      <button class="m-wk-item" data-w="" aria-pressed="false"><b>Sortie libre</b><span>Sans séance imposée</span>${p.workoutId === null ? '<em class="m-wk-chosen">✓ Pour la sortie</em>' : ''}</button>
      ${ctx.workouts.length ? `<h4 class="m-caption">Mes séances</h4>${ctx.workouts.map(item).join('')}` : ''}
      <h4 class="m-caption">Modèles</h4>
      ${WORKOUT_PRESETS.map(item).join('')}`;
    q('list')
      .querySelector('[data-a="import"]')!
      .addEventListener('click', () => q<HTMLInputElement>('file').click());
    q('list')
      .querySelector('[data-a="new"]')!
      .addEventListener('click', () => {
        draft = blank();
        selected = 0;
        save();
        showAll();
      });
    q('list')
      .querySelectorAll<HTMLElement>('[data-w]')
      .forEach((b) =>
        b.addEventListener('click', () => {
          const id = b.dataset.w!;
          if (id === '') {
            p.workoutId = null;
            ctx.changed();
            showAll();
            return;
          }
          draft = clone(known().find((w) => w.id === id)!);
          selected = 0;
          showAll();
        }),
      );
  };

  const showAll = () => {
    q<HTMLInputElement>('wkName').value = draft.name;
    showList();
    showBlocks();
    showForm();
    showChart();
    showActions();
  };

  q<HTMLInputElement>('wkName').addEventListener('input', (e) => {
    edited();
    draft.name = (e.target as HTMLInputElement).value;
    showActions();
  });
  q<HTMLInputElement>('wkName').addEventListener('change', () => {
    if (stored()) save();
    showList();
    ctx.changed();
  });
  page.querySelectorAll<HTMLElement>('[data-k]').forEach((b) => {
    b.addEventListener('click', () => {
      edited();
      draft.blocks.splice(selected + 1, 0, newBlock(b.dataset.k as BlockKind));
      selected = Math.min(selected + 1, draft.blocks.length - 1);
      showAll();
    });
  });
  chart.addEventListener('click', (e) => {
    const box = chart.getBoundingClientRect();
    const steps = expandBlocks(draft.blocks);
    const at = ((e.clientX - box.left) / box.width) * totalDuration(steps);
    const step = steps.find((s) => at < s.startS + s.durationS);
    if (step) select(step.block);
  });
  page.querySelector('[data-a="save"]')!.addEventListener('click', () => {
    save();
    showAll();
    ctx.changed();
  });
  page.querySelector('[data-a="delete"]')!.addEventListener('click', () => {
    ctx.workouts = ctx.workouts.filter((w) => w.id !== draft.id);
    ctx.saveWorkouts();
    if (p.workoutId === draft.id) p.workoutId = null;
    draft = clone(WORKOUT_PRESETS[0]);
    selected = 0;
    showAll();
    ctx.changed();
  });
  page.querySelector('[data-a="use"]')!.addEventListener('click', () => {
    save();
    p.workoutId = p.workoutId === draft.id ? null : draft.id;
    showAll();
    ctx.changed();
  });

  const say = (text: string, error = false) => {
    const note = q('importNote');
    note.textContent = text;
    note.classList.toggle('is-error', error);
  };

  /** Lit chaque fichier déposé ou choisi ; une séance qui échoue n'empêche pas les autres. */
  const importFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const done: string[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        const { workout, notes } = importWorkout(file.name, await file.text(), p.ftp);
        ctx.workouts.unshift(workout);
        draft = clone(workout);
        const blocks = `${workout.blocks.length} bloc${workout.blocks.length > 1 ? 's' : ''}`;
        const time = duration(totalDuration(expandBlocks(workout.blocks)));
        done.push(`« ${workout.name} » · ${time} · ${blocks}${notes.length ? ` (${notes.join(' ; ')})` : ''}`);
      } catch (err) {
        problems.push(`${file.name} : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (done.length > 0) {
      ctx.saveWorkouts();
      selected = 0;
      showAll();
      ctx.changed();
    }
    const imported = done.length > 0 ? `Importée${done.length > 1 ? 's' : ''} : ${done.join(' — ')}. Clique sur « Choisir pour la sortie » pour la rouler.` : '';
    say([imported, ...problems].filter(Boolean).join(' '), done.length === 0);
  };

  const fileInput = q<HTMLInputElement>('file');
  fileInput.addEventListener('change', () => {
    void importFiles([...(fileInput.files ?? [])]);
    fileInput.value = '';
  });
  // Sans ce garde-fou, un fichier lâché à côté de la zone serait ouvert à la place du jeu.
  const carriesFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  page.addEventListener('dragover', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    page.classList.add('m-dropping');
  });
  page.addEventListener('dragleave', (e) => {
    if (!page.contains(e.relatedTarget as Node | null)) page.classList.remove('m-dropping');
  });
  page.addEventListener('drop', (e) => {
    if (!carriesFiles(e)) return;
    e.preventDefault();
    page.classList.remove('m-dropping');
    void importFiles([...(e.dataTransfer?.files ?? [])]);
  });
  say('Importe un fichier .zwo (Zwift), .mrc ou .erg, ou glisse-le ici.');

  showAll();
}
