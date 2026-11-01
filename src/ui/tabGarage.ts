// Onglet Garage : choix du vélo et du maillot.

import { ALL_BIKES, BIKE_JERSEY, type Bike, type BikeShape, findBike, JERSEYS, setupFor, wearing } from '../sim/bikes';
import { steadySpeed } from '../sim/physicsEngine';
import { esc, fr, hex } from './format';
import type { MenuContext } from './menu';

type GarageView = 'velo' | 'maillot';

const CATEGORIES: { id: string; label: string; shapes: BikeShape[]; teams?: boolean }[] = [
  { id: 'equipes', label: 'Équipes WorldTour', shapes: ['route'], teams: true },
  { id: 'clm', label: 'Contre-la-montre', shapes: ['clm'] },
  { id: 'route', label: 'Route', shapes: ['route'], teams: false },
  { id: 'tout-terrain', label: 'Gravel et VTT', shapes: ['gravel', 'vtt'] },
  { id: 'ville', label: 'Ville', shapes: ['ville'] },
];

function bikeIcon(b: Bike): string {
  const frame = hex(b.frame);
  const r = b.shape === 'vtt' ? 21 : 19;
  return `<svg viewBox="0 0 120 68" aria-hidden="true">
    <g fill="none" stroke="#2b3138" stroke-width="${b.shape === 'route' || b.shape === 'clm' ? 2 : 4}">
      <circle cx="26" cy="44" r="${r}"/><circle cx="94" cy="44" r="${r}"/>
    </g>
    <path d="M26 44 46 19h34L94 44M46 19l10 25H26M56 44 80 19" fill="none" stroke="${frame}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="M80 19l-2-8h11M46 19l-2-6h-9" fill="none" stroke="#2b3138" stroke-width="3" stroke-linecap="round"/>
    <circle cx="56" cy="44" r="4" fill="${hex(b.accent)}"/>
  </svg>`;
}

function jerseyIcon(color: number, accent: number): string {
  const body = 'M38 8 22 14 6 34l14 10 8-9v47h44V35l8 9 14-10L78 14 62 8c-3 6-21 6-24 0Z';
  return `<svg viewBox="0 0 100 90" aria-hidden="true">
    <defs><clipPath id="j${color}${accent}"><path d="${body}"/></clipPath></defs>
    <path d="${body}" fill="${hex(color)}" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/>
    <rect x="0" y="44" width="100" height="11" fill="${hex(accent)}" clip-path="url(#j${color}${accent})"/>
  </svg>`;
}

export function renderGarage(page: HTMLElement, ctx: MenuContext): void {
  const p = ctx.profile;
  let view: GarageView = 'velo';
  let category = CATEGORIES.find((c) => matches(c, findBike(p.bikeId)))?.id ?? CATEGORIES[0].id;

  function matches(c: (typeof CATEGORIES)[number], b: Bike): boolean {
    if (!c.shapes.includes(b.shape)) return false;
    return c.teams === undefined || c.teams === (b.team !== null);
  }

  page.innerHTML = `
    <div class="m-sub">
      <button class="m-chip" data-v="velo">Vélo</button>
      <button class="m-chip" data-v="maillot">Maillot</button>
    </div>
    <div data-r="garage"></div>`;
  const body = page.querySelector('[data-r="garage"]') as HTMLElement;

  const showHeader = (): string => {
    const bike = findBike(p.bikeId);
    const setup = setupFor(bike, p.riderKg);
    const speed = (grade: number) => fr(steadySpeed(p.ftp, grade, 1000, setup) * 3.6);
    return `<div class="m-card m-bike-head">
      <div class="m-bike-pic">${bikeIcon(bike)}</div>
      <div>
        <h3>${esc(bike.name)}</h3>
        <p>${esc(bike.team ? `${bike.team.name} · ${bike.label}` : bike.label)}</p>
      </div>
      <dl>
        <div><dt>Poids</dt><dd>${fr(bike.kg)} kg</dd></div>
        <div><dt>CdA</dt><dd>${fr(bike.cda, 3)}</dd></div>
        <div><dt>À ta FTP, plat</dt><dd>${speed(0)} km/h</dd></div>
        <div><dt>À ta FTP, 8 %</dt><dd>${speed(8)} km/h</dd></div>
      </dl>
    </div>`;
  };

  const showBikes = () => {
    const current = CATEGORIES.find((c) => c.id === category)!;
    const bikes = ALL_BIKES.filter((b) => matches(current, b));
    body.innerHTML = `${showHeader()}
      <div class="m-sub m-sub-small">
        ${CATEGORIES.map((c) => `<button class="m-chip" data-c="${c.id}" aria-pressed="${c.id === category}">${c.label}</button>`).join('')}
      </div>
      <div class="m-grid">
        ${bikes
          .map(
            (b) => `<button class="m-item" data-b="${esc(b.id)}" aria-pressed="${b.id === p.bikeId}">
              ${bikeIcon(b)}
              <b>${esc(b.name)}</b>
              <span>${esc(b.team?.name ?? b.label)}</span>
              <span>${fr(b.kg)} kg · CdA ${fr(b.cda, 3)}</span>
            </button>`,
          )
          .join('')}
      </div>`;
    body.querySelectorAll<HTMLElement>('[data-c]').forEach((c) => {
      c.addEventListener('click', () => {
        category = c.dataset.c!;
        showBikes();
      });
    });
    body.querySelectorAll<HTMLElement>('[data-b]').forEach((b) => {
      b.addEventListener('click', () => {
        p.bikeId = b.dataset.b!;
        const scroll = page.parentElement?.scrollTop ?? 0;
        showBikes();
        if (page.parentElement) page.parentElement.scrollTop = scroll;
        ctx.changed();
      });
    });
  };

  const showJerseys = () => {
    const bike = wearing(findBike(p.bikeId), BIKE_JERSEY);
    body.innerHTML = `<div class="m-grid m-grid-jersey">
      <button class="m-item" data-j="${BIKE_JERSEY}" aria-pressed="${p.jerseyId === BIKE_JERSEY}">
        ${jerseyIcon(bike.jersey, bike.accent)}
        <b>Tenue du vélo</b>
        <span>${esc(bike.team?.name ?? 'Tenue neutre')}</span>
      </button>
      ${JERSEYS.map(
        (j) => `<button class="m-item" data-j="${j.id}" aria-pressed="${j.id === p.jerseyId}">
          ${jerseyIcon(j.color, j.accent)}
          <b>${esc(j.name)}</b>
          <span>${j.team ? 'Équipe' : 'Uni'}</span>
        </button>`,
      ).join('')}
    </div>`;
    body.querySelectorAll<HTMLElement>('[data-j]').forEach((b) => {
      b.addEventListener('click', () => {
        p.jerseyId = b.dataset.j!;
        body.querySelectorAll<HTMLElement>('[data-j]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        ctx.changed();
      });
    });
  };

  const show = () => {
    page.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === view)));
    if (view === 'velo') showBikes();
    else showJerseys();
  };
  page.querySelectorAll<HTMLElement>('[data-v]').forEach((b) => {
    b.addEventListener('click', () => {
      view = b.dataset.v as GarageView;
      show();
    });
  });
  show();
}
