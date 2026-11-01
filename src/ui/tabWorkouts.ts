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
import { drawWorkout } from './charts';
import { duration, esc } from './format';
import type { MenuContext } from './menu';

const PRESET_PREFIX = 'preset-';
const KINDS = Object.keys(BLOCK_LABELS) as BlockKind[];

type NumberField = 'durationS' | 'fromPct' | 'toPct' | 'repeat' | 'restS';

interface Field {
  key: NumberField;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: 'time' | 'pct' | 'count';
}

const TIME = { min: 15, max: 3600, step: 15, unit: 'time' } as const;
const POWER = { min: 30, max: 200, step: 1, unit: 'pct' } as const;

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
    <div class="m-wk">
      <aside class="m-wk-list" data-r="list"></aside>
      <section class="m-card m-wk-editor">
        <div class="m-wk-head">
          <input class="m-wk-name" data-r="wkName" maxlength="40" aria-label="Nom de la séance">
          <div class="m-wk-stats" data-r="wkStats"></div>
        </div>
        <canvas class="m-wk-chart" data-r="chart" aria-label="Déroulé de la séance : clique sur un bloc pour le modifier"></canvas>
        <div class="m-wk-palette">
          ${KINDS.map((k) => `<button class="m-add" data-k="${k}">+ ${BLOCK_LABELS[k]}</button>`).join('')}
        </div>
        <div class="m-wk-blocks" data-r="blocks"></div>
        <div class="m-wk-form" data-r="form"></div>
        <div class="m-wk-actions">
          <button class="m-ghost" data-a="delete">Supprimer</button>
          <button class="m-ghost" data-a="save">Enregistrer</button>
          <button class="m-select" data-a="use"></button>
        </div>
        <p class="m-note">Pendant la séance, le home trainer impose la puissance (mode ERG) sur le parcours choisi. La sortie s'arrête à la fin de la séance, ou au bout du parcours s'il est plus court.</p>
      </section>
    </div>`;

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
    use.textContent = used ? 'Séance choisie' : 'Choisir pour la sortie';
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
        <b>${BLOCK_LABELS[block.kind]}</b>
        <span>
          <button class="m-icon" data-m="-1" aria-label="Avancer le bloc" title="Avancer le bloc">←</button>
          <button class="m-icon" data-m="1" aria-label="Reculer le bloc" title="Reculer le bloc">→</button>
          <button class="m-icon" data-m="0" aria-label="Retirer le bloc" title="Retirer le bloc">✕</button>
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
      </button>`;
    };
    q('list').innerHTML = `
      <button class="m-new" data-a="new">+ Nouvelle séance</button>
      <button class="m-wk-item" data-w="" aria-pressed="false" data-free="${p.workoutId === null}"><b>Sortie libre</b><span>Sans séance imposée</span></button>
      ${ctx.workouts.length ? `<h4>Mes séances</h4>${ctx.workouts.map(item).join('')}` : ''}
      <h4>Modèles</h4>
      ${WORKOUT_PRESETS.map(item).join('')}`;
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

  showAll();
}
