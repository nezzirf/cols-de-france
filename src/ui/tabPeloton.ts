// Onglet Peloton : un groupe de dix ou quinze coureurs qui roule aux watts par kilo choisis, sur le parcours choisi.

import { CUSTOM_ROUTE_ID } from '../app/profile';
import { GROUP_RAMP_S, GROUP_SIZES, GROUP_WARMUP_S, GROUP_WARMUP_SHARE, GROUP_WKG_MAX, GROUP_WKG_MIN, GROUP_WKG_STEP } from '../sim/group';
import { WORLD_NAME, WORLD_ROUTE_ID } from '../sim/worldRoute';
import { fr } from './format';
import type { MenuContext } from './menu';
import { worldGradient } from './tabRoutes';

const WARMUP_MIN = GROUP_WARMUP_S / 60;
const RAMP_MIN = GROUP_RAMP_S / 60;

export function renderPeloton(page: HTMLElement, ctx: MenuContext): void {
  const p = ctx.profile;
  if (!p.groupRouteId) p.groupRouteId = p.routeId;
  page.innerHTML = `
    <h2 class="m-title">Rouler en peloton</h2>
    <p class="m-lead">Un groupe qui tient le niveau choisi du début à la fin : si tu vas moins vite, il part devant ; si tu vas plus vite, tu le doubles.</p>
    <section class="m-group" aria-label="Réglages du groupe">
      <label class="m-group-wkg"><span>Niveau du groupe <b data-r="wkg"></b></span>
        <input type="range" min="${GROUP_WKG_MIN}" max="${GROUP_WKG_MAX}" step="${GROUP_WKG_STEP}" data-g="wkg" value="${p.groupWkg}"></label>
      <p class="m-group-note" data-r="level"></p>
      <div class="m-group-size" role="group" aria-label="Nombre de coureurs">
        <span>Coureurs</span>
        ${GROUP_SIZES.map((n) => `<button class="m-seg" data-n="${n}" aria-pressed="false">${n}</button>`).join('')}
      </div>
      <p class="m-group-note" data-r="warmup"></p>
    </section>
    <h2 class="m-title">Parcours</h2>
    <div class="m-routes">
      ${ctx.routes
        .map(
          (r) => `<button class="m-route" data-id="${r.id}" style="background-image:linear-gradient(180deg,rgba(14,22,30,.28),rgba(14,22,30,.8)),url(data/${r.id}/ortho.jpg)">
            <span class="m-route-massif">${r.massif}</span>
            <h3>${r.name}</h3>
            <span class="m-route-stats"><b>${fr(r.climb.lengthKm)}</b> km · <b>${fr(r.climb.avgGradePct)}</b> % · <b>${r.climb.topM}</b> m</span>
          </button>`,
        )
        .join('')}
      <button class="m-route" data-id="${WORLD_ROUTE_ID}" style="background-image:linear-gradient(180deg,rgba(14,22,30,.2),rgba(14,22,30,.6)),${worldGradient()}">
        <span class="m-route-massif">Monde d'entraînement</span>
        <h3>${WORLD_NAME}</h3>
        <span class="m-route-stats">boucle sans fin, de la plage au désert</span>
      </button>
      <button class="m-route" data-id="${CUSTOM_ROUTE_ID}" style="background-image:linear-gradient(135deg,#2c3a47,#1a232c)">
        <span class="m-route-massif">Parcours personnalisé</span>
        <h3>Personnalisé</h3>
        <span class="m-route-stats"><b>${fr(p.customKm)}</b> km à <b>${fr(p.customGrade)}</b> %, réglé dans Parcours</span>
      </button>
    </div>`;

  const q = <T extends HTMLElement>(sel: string): T => page.querySelector(sel) as T;

  const showLevel = () => {
    const watts = Math.round(p.groupWkg * p.riderKg);
    q('[data-r="wkg"]').textContent = `${fr(p.groupWkg)} W/kg`;
    q('[data-r="level"]').textContent = `Pour toi, à ${fr(p.riderKg, 1)} kg : ${watts} W, soit ${Math.round((watts / p.ftp) * 100)} % de ta FTP.`;
    q('[data-r="warmup"]').textContent =
      `Échauffement : pendant ${WARMUP_MIN} minutes, le groupe roule à ${Math.round(GROUP_WARMUP_SHARE * 100)} % (${fr(p.groupWkg * GROUP_WARMUP_SHARE)} W/kg) ` +
      `pour que tu t'échauffes. Il monte ensuite à ${fr(p.groupWkg)} W/kg à partir de la ${WARMUP_MIN - RAMP_MIN}e minute et s'y tient jusqu'à la fin.`;
  };
  q<HTMLInputElement>('[data-g="wkg"]').addEventListener('input', (e) => {
    p.groupWkg = Number((e.target as HTMLInputElement).value);
    showLevel();
    ctx.changed();
  });

  const showSize = () => {
    page.querySelectorAll<HTMLElement>('[data-n]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.n) === p.groupRiders)));
  };
  page.querySelectorAll<HTMLElement>('[data-n]').forEach((b) =>
    b.addEventListener('click', () => {
      p.groupRiders = Number(b.dataset.n) as typeof p.groupRiders;
      showSize();
      ctx.changed();
    }),
  );

  const pick = (id: string) => {
    p.groupRouteId = id;
    page.querySelectorAll<HTMLElement>('.m-route').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === id)));
    ctx.changed();
  };
  page.querySelectorAll<HTMLElement>('.m-route').forEach((c) => c.addEventListener('click', () => pick(c.dataset.id!)));

  showLevel();
  showSize();
  pick(p.groupRouteId);
}
