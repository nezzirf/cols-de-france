// « Réglages de la sortie » : ce qui ne change pas à chaque fois (météo, pente ressentie, compagnons de route) reste
// replié sous le choix du parcours ou de la séance, pour ne pas charger la page.

import { BOT_TINTS, BOT_WKG_MAX, BOT_WKG_MIN, BOT_WKG_STEP, DEFAULT_BOT_WKG, MAX_BOTS } from '../sim/bots';
import { GROUP_SIZES, GROUP_WARMUP_S, GROUP_WKG_MAX, GROUP_WKG_MIN, GROUP_WKG_STEP } from '../sim/group';
import { type MomentChoice, MOMENTS, type WeatherChoice, WEATHERS } from '../world/ambiance';
import { fr, hex } from './format';
import type { MenuContext } from './menu';

const WARMUP_MIN = GROUP_WARMUP_S / 60;
/** Le panneau garde son état d'un onglet à l'autre. */
let opened = false;

export interface SettingsOptions {
  /** Séance guidée : pas de pente ressentie, de coéquipiers ni de peloton. */
  training: boolean;
  /** Sortie devant une application : ni météo ni compagnons, il n'y a pas de décor. */
  media: boolean;
}

export function renderRideSettings(host: HTMLElement, ctx: MenuContext, { training, media }: SettingsOptions): void {
  if (media) return;
  const p = ctx.profile;
  const section = document.createElement('details');
  section.className = 'm-more';
  section.open = opened;
  section.innerHTML = `
    <summary><b>Réglages de la sortie</b><small data-r="brief"></small></summary>
    <div class="m-more-body">
      <div class="m-more-row">
        <label>Météo<select data-o="weather">${WEATHERS.map((w) => `<option value="${w.id}">${w.label}</option>`).join('')}</select></label>
        <label>Moment<select data-o="moment">${MOMENTS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select></label>
      </div>
      ${
        training
          ? ''
          : `<label class="m-slope">
        <span>Pente ressentie <b data-r="difficulty"></b></span>
        <input type="range" min="25" max="100" step="5" data-p="difficulty" value="${p.difficulty}">
      </label>`
      }
      <label class="m-check"><input type="checkbox" data-o="ghost"> Fantôme de ma meilleure sortie</label>
      ${training ? '' : '<label class="m-check"><input type="checkbox" data-o="peloton"> Rouler avec quatre coéquipiers</label>'}
      ${
        training
          ? ''
          : `<label class="m-check"><input type="checkbox" data-o="group"> Rouler en peloton</label>
      <div class="m-peloton" data-r="group" hidden>
        <label class="m-group-wkg"><span>Niveau du groupe <b data-r="wkg"></b></span>
          <input type="range" min="${GROUP_WKG_MIN}" max="${GROUP_WKG_MAX}" step="${GROUP_WKG_STEP}" data-g="wkg" value="${p.groupWkg}"></label>
        <p class="m-group-note" data-r="level"></p>
        <div class="m-group-size" role="group" aria-label="Nombre de coureurs">
          <span>Coureurs</span>
          ${GROUP_SIZES.map((n) => `<button class="m-seg" data-n="${n}" aria-pressed="false">${n}</button>`).join('')}
        </div>
        <p class="m-group-note">Échauffement : pendant ${WARMUP_MIN} minutes, le groupe reste avec toi. Il se cale ensuite sur son niveau et s'y tient jusqu'à la fin, sur le parcours choisi.</p>
      </div>`
      }
      <div class="m-bots" data-r="bots">
        <div class="m-bots-head"><span>Fantômes</span><button class="m-bots-add" data-a="addBot">+ Ajouter</button></div>
        <div data-r="botList"></div>
      </div>
    </div>`;
  host.appendChild(section);

  const q = <T extends HTMLElement>(sel: string): T => section.querySelector(sel) as T;
  section.addEventListener('toggle', () => (opened = section.open));

  section.querySelectorAll<HTMLSelectElement>('select[data-o]').forEach((select) => {
    const key = select.dataset.o as 'weather' | 'moment';
    select.value = p[key];
    select.addEventListener('change', () => {
      if (key === 'weather') p.weather = select.value as WeatherChoice;
      else p.moment = select.value as MomentChoice;
      brief();
      ctx.changed();
    });
  });
  section.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-o]').forEach((box) => {
    const key = box.dataset.o as 'peloton' | 'ghost' | 'group';
    box.checked = p[key];
    box.addEventListener('change', () => {
      p[key] = box.checked;
      showGroup();
      brief();
      ctx.changed();
    });
  });
  const slope = section.querySelector<HTMLInputElement>('[data-p="difficulty"]');
  slope?.addEventListener('input', () => {
    p.difficulty = Number(slope.value);
    showSlope();
    ctx.changed();
  });

  const showSlope = () => {
    const out = section.querySelector('[data-r="difficulty"]');
    if (out) out.textContent = `${p.difficulty} %`;
  };

  /** Une ligne qui résume les réglages, visible même replié. */
  const brief = () => {
    const weather = WEATHERS.find((w) => w.id === p.weather)?.label ?? '';
    const moment = MOMENTS.find((m) => m.id === p.moment)?.label ?? '';
    const extras = [p.group && !training ? 'peloton' : '', p.bots.length ? `${p.bots.length} fantôme${p.bots.length > 1 ? 's' : ''}` : ''].filter(Boolean);
    q('[data-r="brief"]').textContent = [weather, moment, ...extras].join(' · ');
  };

  // Le peloton.
  const showLevel = () => {
    const level = section.querySelector('[data-r="level"]');
    if (!level) return;
    const watts = Math.round(p.groupWkg * p.riderKg);
    q('[data-r="wkg"]').textContent = `${fr(p.groupWkg)} W/kg`;
    level.textContent = `Pour toi, à ${fr(p.riderKg, 1)} kg : ${watts} W, soit ${Math.round((watts / p.ftp) * 100)} % de ta FTP.`;
  };
  const showSize = () =>
    section.querySelectorAll<HTMLElement>('[data-n]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === p.groupRiders)));
  function showGroup(): void {
    const group = section.querySelector<HTMLElement>('[data-r="group"]');
    if (group) group.hidden = !p.group;
  }
  section.querySelector<HTMLInputElement>('[data-g="wkg"]')?.addEventListener('input', (e) => {
    p.groupWkg = Number((e.target as HTMLInputElement).value);
    showLevel();
    ctx.changed();
  });
  section.querySelectorAll<HTMLElement>('[data-n]').forEach((b) =>
    b.addEventListener('click', () => {
      p.groupRiders = Number(b.dataset.n) as typeof p.groupRiders;
      showSize();
      ctx.changed();
    }),
  );

  // Les fantômes : un curseur de W/kg chacun, jusqu'à cinq.
  const showBotWatts = () =>
    p.bots.forEach((w, i) => {
      const out = section.querySelector<HTMLElement>(`[data-r="bot${i}"]`);
      if (out) out.textContent = `${fr(w)} W/kg · ${Math.round(w * p.riderKg)} W`;
    });
  const renderBots = () => {
    const list = q('[data-r="botList"]');
    list.innerHTML = p.bots.length
      ? p.bots
          .map(
            (w, i) => `<div class="m-bot">
              <i style="background:${hex(BOT_TINTS[i])}"></i>
              <label><span>Fantôme ${i + 1} <b data-r="bot${i}"></b></span>
                <input type="range" min="${BOT_WKG_MIN}" max="${BOT_WKG_MAX}" step="${BOT_WKG_STEP}" data-bot="${i}" value="${w}"></label>
              <button data-rm="${i}" aria-label="Retirer le fantôme ${i + 1}">×</button>
            </div>`,
          )
          .join('')
      : '<p class="m-bots-empty">Aucun fantôme. Jusqu’à 5 coureurs virtuels, à la puissance par kilo de ton choix, avec ton vélo et ton poids.</p>';
    list.querySelectorAll<HTMLInputElement>('[data-bot]').forEach((input) =>
      input.addEventListener('input', () => {
        p.bots[Number(input.dataset.bot)] = Math.round(Number(input.value) * 10) / 10;
        showBotWatts();
        ctx.changed();
      }),
    );
    list.querySelectorAll<HTMLElement>('[data-rm]').forEach((b) =>
      b.addEventListener('click', () => {
        p.bots.splice(Number(b.dataset.rm), 1);
        renderBots();
        brief();
        ctx.changed();
      }),
    );
    q<HTMLButtonElement>('[data-a="addBot"]').hidden = p.bots.length >= MAX_BOTS;
    showBotWatts();
  };
  q('[data-a="addBot"]').addEventListener('click', () => {
    if (p.bots.length >= MAX_BOTS) return;
    // Le nouveau fantôme part du niveau du précédent : on règle ensuite chacun à son goût.
    p.bots.push(p.bots[p.bots.length - 1] ?? DEFAULT_BOT_WKG);
    renderBots();
    brief();
    ctx.changed();
  });

  showSlope();
  showLevel();
  showSize();
  showGroup();
  renderBots();
  brief();
}
