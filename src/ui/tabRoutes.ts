// Onglet Parcours : les cols réels et le parcours personnalisé.

import { CUSTOM_ROUTE_ID } from '../app/profile';
import { MAX_CLIMB_KM, MAX_GRADE_PCT, WARMUP_KM } from '../sim/customRoute';
import { findBike, setupFor } from '../sim/bikes';
import { WORLD_ROUTE_ID, worldLayout } from '../sim/worldRoute';
import { WORLD_STYLE } from '../world/worldStyle';
import { steadySpeed } from '../sim/physicsEngine';
import type { RouteData } from '../sim/route';
import { drawProfile, type ProfilePoint } from './charts';
import { duration, fr } from './format';
import type { MenuContext } from './menu';

const PROFILE_POINTS = 120;
const ESTIMATE_FTP_SHARE = 0.8;
const CUSTOM_START_ELE_M = 480;

async function colProfile(id: string): Promise<{ points: ProfilePoint[]; footKm: number }> {
  const data = (await fetch(`data/${id}/route.json`).then((r) => r.json())) as RouteData;
  const last = Math.round(data.endM / data.stepM);
  const every = Math.max(1, Math.floor(last / PROFILE_POINTS));
  const points: ProfilePoint[] = [];
  for (let i = 0; i <= last; i += every) points.push({ km: (i * data.stepM) / 1000, ele: data.ele[i] });
  return { points, footKm: data.footM / 1000 };
}

/** Dégradé des six biomes le long du parcours : chaque couleur fond dans la suivante, comme dans le jeu. */
export function worldGradient(): string {
  const { world, lapM: endM, loop } = worldLayout();
  const half = world.blendM / 2;
  const at = (m: number) => `${Math.max(0, Math.min(100, (m / endM) * 100)).toFixed(2)}%`;
  const stops = [`${WORLD_STYLE[world.zones[0].biome].swatch} 0%`];
  world.zones.slice(0, -1).forEach((zone, k) => {
    stops.push(`${WORLD_STYLE[zone.biome].swatch} ${at(zone.toM - loop.fromM - half)}`);
    stops.push(`${WORLD_STYLE[world.zones[k + 1].biome].swatch} ${at(zone.toM - loop.fromM + half)}`);
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function worldCard(): string {
  const { world, ele, lapM, loop } = worldLayout();
  const lap = ele.slice(loop.fromM / 10, loop.toM / 10 + 1);
  const gain = lap.reduce((s, e, i) => (i > 0 && e > lap[i - 1] ? s + e - lap[i - 1] : s), 0);
  // La plage ouvre et ferme le tour : elle n'apparaît qu'une fois dans la légende.
  const chips = world.zones
    .filter((z, i, all) => all.findIndex((o) => o.biome === z.biome) === i)
    .map((z) => `<li><i style="background:${WORLD_STYLE[z.biome].swatch}"></i>${z.name}<small>km ${(z.fromM - loop.fromM) / 1000}</small></li>`)
    .join('');
  return `<button class="m-world" data-id="${WORLD_ROUTE_ID}" aria-pressed="false" style="--zones:${worldGradient()}">
      <div class="m-world-head">
        <h3>Tour des six biomes</h3>
        <span class="m-route-stats">boucle de <b>${fr(lapM / 1000, 0)}</b> km · <b>+${Math.round(gain)}</b> m · <b>${Math.round(Math.max(...lap))}</b> m</span>
      </div>
      <canvas data-r="worldProfile"></canvas>
      <div class="m-world-strip"></div>
      <ul class="m-world-zones">${chips}</ul>
    </button>`;
}

export function renderRoutes(page: HTMLElement, ctx: MenuContext): void {
  const p = ctx.profile;
  page.innerHTML = `
    <h2 class="m-title">Les grands cols</h2>
    <p class="m-lead">Les routes réelles, depuis la vallée.</p>
    <div class="m-routes">
      ${ctx.routes
        .map(
          (r) => `<button class="m-route" data-id="${r.id}" style="background-image:linear-gradient(180deg,rgba(14,22,30,.28),rgba(14,22,30,.8)),url(data/${r.id}/ortho.jpg)">
            <span class="m-route-massif">${r.massif}</span>
            <h3>${r.name}</h3>
            <span class="m-route-stats"><b>${fr(r.climb.lengthKm)}</b> km · <b>${fr(r.climb.avgGradePct)}</b> % · <b>${r.climb.topM}</b> m</span>
            <canvas data-c="${r.id}"></canvas>
          </button>`,
        )
        .join('')}
    </div>
    <h2 class="m-title">Monde d'entraînement</h2>
    <p class="m-lead">Une route imaginaire, de la plage au désert : chaque paysage se fond dans le suivant.</p>
    ${worldCard()}
    <h2 class="m-title">Parcours personnalisé</h2>
    <p class="m-lead">${WARMUP_KM} km de plat pour s'échauffer, puis la montée que tu choisis.</p>
    <section class="m-custom" data-id="${CUSTOM_ROUTE_ID}" role="group" aria-label="Parcours personnalisé">
      <div class="m-custom-fields">
        <label><span>Distance de la montée <b data-r="km"></b></span>
          <input type="range" min="1" max="${MAX_CLIMB_KM}" step="0.5" data-f="customKm" value="${p.customKm}"></label>
        <label><span>Pente <b data-r="grade"></b></span>
          <input type="range" min="0" max="${MAX_GRADE_PCT}" step="0.5" data-f="customGrade" value="${p.customGrade}"></label>
      </div>
      <div class="m-custom-side">
        <div class="m-custom-stats" data-r="stats"></div>
        <canvas data-r="customProfile"></canvas>
        <button class="m-select" data-a="custom"></button>
      </div>
    </section>`;

  const pick = (id: string) => {
    p.routeId = id;
    page.querySelectorAll<HTMLElement>('.m-route, .m-world').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === id)));
    const custom = page.querySelector('.m-custom') as HTMLElement;
    custom.dataset.on = String(id === CUSTOM_ROUTE_ID);
    (page.querySelector('[data-a="custom"]') as HTMLElement).textContent = id === CUSTOM_ROUTE_ID ? 'Parcours choisi' : 'Choisir ce parcours';
    ctx.changed();
  };
  page.querySelectorAll<HTMLElement>('.m-route, .m-world').forEach((c) => c.addEventListener('click', () => pick(c.dataset.id!)));
  page.querySelector('[data-a="custom"]')!.addEventListener('click', () => pick(CUSTOM_ROUTE_ID));

  const showCustom = () => {
    const climb = p.customKm;
    const gain = climb * p.customGrade * 10;
    (page.querySelector('[data-r="km"]') as HTMLElement).textContent = `${fr(climb)} km`;
    (page.querySelector('[data-r="grade"]') as HTMLElement).textContent = `${fr(p.customGrade)} %`;
    const setup = setupFor(findBike(p.bikeId), p.riderKg);
    const speed = steadySpeed(p.ftp * ESTIMATE_FTP_SHARE, p.customGrade, CUSTOM_START_ELE_M + gain / 2, setup);
    (page.querySelector('[data-r="stats"]') as HTMLElement).innerHTML = `
      <div><b>${fr(WARMUP_KM + climb)}</b>km au total</div>
      <div><b>${Math.round(gain)}</b>m de dénivelé</div>
      <div><b>${duration((climb * 1000) / speed)}</b>de montée à ${Math.round(ESTIMATE_FTP_SHARE * 100)} % de FTP</div>`;
    drawProfile(
      page.querySelector('[data-r="customProfile"]') as HTMLCanvasElement,
      [
        { km: 0, ele: CUSTOM_START_ELE_M },
        { km: WARMUP_KM, ele: CUSTOM_START_ELE_M },
        { km: WARMUP_KM + climb, ele: CUSTOM_START_ELE_M + gain },
      ],
      WARMUP_KM,
    );
  };
  page.querySelectorAll<HTMLInputElement>('[data-f]').forEach((input) => {
    input.addEventListener('input', () => {
      p[input.dataset.f as 'customKm' | 'customGrade'] = Number(input.value);
      showCustom();
      pick(CUSTOM_ROUTE_ID);
    });
  });

  pick(p.routeId);
  showCustom();
  const layout = worldLayout();
  const profile = page.querySelector<HTMLCanvasElement>('[data-r="worldProfile"]');
  if (profile) {
    const lap = layout.ele.slice(layout.loop.fromM / 10, layout.loop.toM / 10 + 1);
    const points = lap.filter((_, i) => i % 40 === 0).map((e, i) => ({ km: (i * 400) / 1000, ele: e }));
    drawProfile(profile, points, 0);
  }
  for (const r of ctx.routes) {
    void colProfile(r.id).then(({ points, footKm }) => {
      const canvas = page.querySelector<HTMLCanvasElement>(`[data-c="${r.id}"]`);
      if (canvas) drawProfile(canvas, points, footKm);
    });
  }
}
