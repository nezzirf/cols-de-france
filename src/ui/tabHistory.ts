// Onglet Historique : les sorties passées, le cumul de la semaine et les meilleures puissances.

import { deleteRide, type HistoryEntry, loadHistory, personalBests, weekTotals } from '../app/rideHistory';
import { BEST_WINDOWS_S, estimateFtp } from '../sim/rideStats';
import { duration, esc, fr } from './format';
import type { MenuContext } from './menu';

const windowLabel = (s: number): string => (s < 60 ? `${s} s` : `${s / 60} min`);

function dayLabel(ms: number): string {
  const label = new Date(ms).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const cell = (value: string, label: string): string => `<div class="m-hist-cell"><b>${value}</b><span>${label}</span></div>`;

export function renderHistory(page: HTMLElement, ctx: MenuContext): void {
  const history = loadHistory();
  if (history.length === 0) {
    page.innerHTML = `
      <h2 class="m-title">Mes sorties</h2>
      <p class="m-lead">Ici apparaîtront tes sorties, avec le cumul de la semaine et tes meilleures puissances. Toute sortie de plus d’une minute y est gardée automatiquement.</p>`;
    return;
  }

  const week = weekTotals(history);
  const bests = personalBests(history);
  const estimate = estimateFtp(bests[1200]);
  const bestCells = BEST_WINDOWS_S.filter((w) => bests[w] !== undefined)
    .map((w) => cell(`${bests[w]} W`, windowLabel(w)))
    .join('');

  page.innerHTML = `
    <h2 class="m-title">Cette semaine</h2>
    <p class="m-lead">Les sept derniers jours.</p>
    <div class="m-card m-hist-grid">
      ${cell(String(week.rides), week.rides > 1 ? 'sorties' : 'sortie')}
      ${cell(week.elapsedS > 0 ? duration(week.elapsedS) : '--', 'temps')}
      ${cell(`${fr(week.distanceKm)} km`, 'distance')}
      ${cell(`${Math.round(week.elevationGainM)} m`, 'dénivelé')}
      ${cell(String(Math.round(week.tss)), 'charge (TSS)')}
    </div>
    ${
      bestCells
        ? `<h2 class="m-title">Mes meilleures puissances</h2>
    <p class="m-lead">Le meilleur effort tenu sur chaque durée, toutes sorties confondues.</p>
    <div class="m-card m-hist-grid">${bestCells}</div>
    ${
      estimate !== null
        ? `<p class="m-hist-ftp">FTP estimée d’après ton meilleur effort de 20 minutes : <b>${estimate} W</b>
        ${Math.abs(estimate - ctx.profile.ftp) >= 3 ? `<button class="m-hist-btn" data-a="ftp">Utiliser ${estimate} W</button>` : '<span>(c’est déjà ta FTP)</span>'}</p>`
        : ''
    }`
        : ''
    }
    <h2 class="m-title">Toutes mes sorties</h2>
    <div class="m-hist-list" data-r="list"></div>`;

  page.querySelector<HTMLButtonElement>('[data-a="ftp"]')?.addEventListener('click', () => {
    ctx.profile.ftp = estimate!;
    ctx.changed();
    renderHistory(page, ctx);
  });

  const list = page.querySelector<HTMLElement>('[data-r="list"]')!;
  history.forEach((e) => list.appendChild(row(e, ctx, () => renderHistory(page, ctx))));
}

function row(e: HistoryEntry, ctx: MenuContext, refresh: () => void): HTMLElement {
  const item = document.createElement('div');
  item.className = 'm-card m-hist-row';
  item.innerHTML = `
    <button class="m-hist-open" data-a="open" ${e.detailed ? '' : 'disabled'} title="${e.detailed ? 'Revoir le récap' : 'Le détail de cette sortie n’est plus gardé'}">
      <b>${esc(e.name)}</b>
      <span>${dayLabel(e.id)}</span>
      <span class="m-hist-stats">${duration(e.elapsedS)} · ${fr(e.distanceKm)} km · +${e.elevationGainM} m · ${e.avgPowerW} W${e.tss !== null ? ` · TSS ${e.tss}` : ''}</span>
    </button>
    <button class="m-hist-del" data-a="del" aria-label="Supprimer cette sortie">Supprimer</button>`;
  item.querySelector('[data-a="open"]')!.addEventListener('click', () => ctx.openRide(e));
  const del = item.querySelector<HTMLButtonElement>('[data-a="del"]')!;
  del.addEventListener('click', () => {
    if (del.dataset.confirm !== 'true') {
      del.dataset.confirm = 'true';
      del.textContent = 'Sûr ?';
      window.setTimeout(() => {
        delete del.dataset.confirm;
        del.textContent = 'Supprimer';
      }, 3000);
      return;
    }
    deleteRide(e.id);
    refresh();
  });
  return item;
}
