// Options : son, apparence, comportement pendant la sortie, données et crédits. On y arrive par l'engrenage.

import type { Theme } from '../app/profile';
import type { MenuContext } from './menu';

export const CREDITS =
  'Tracés © contributeurs OpenStreetMap (ODbL) · Altitudes IGN RGE ALTI · Relief Mapzen Terrain Tiles · Bâtiments IGN BD TOPO · Photos IGN BD ORTHO · Tunnels et ponts © contributeurs OpenStreetMap (ODbL) · Vélo de route « Canyon Aeroad » par hipoojan (Sketchfab) · Cycliste : mannequin Mixamo (Adobe), casque « Capacete Ciclista » par LAFF3D et lunettes « Action Sunglass » par Nazmul (Sketchfab, CC BY 4.0)';

const THEMES: { id: Theme; label: string }[] = [
  { id: 'auto', label: 'Comme l’appareil' },
  { id: 'clair', label: 'Clair' },
  { id: 'sombre', label: 'Sombre' },
];

interface Switch {
  key: 'sound' | 'alerts' | 'autoPause' | 'screenOn';
  title: string;
  hint: string;
}

const SWITCHES: Record<string, Switch[]> = {
  son: [{ key: 'sound', title: 'Sons d’ambiance', hint: 'Forêt, plage, vent, public des cols, animaux. M les coupe pendant la sortie.' }],
  sortie: [
    { key: 'alerts', title: 'Alertes d’effort', hint: 'Un message quand tu forces trop tôt ou que ta cadence tombe trop bas.' },
    { key: 'autoPause', title: 'Pause automatique', hint: 'Le chrono s’arrête quand tu ne pédales plus et repart avec toi.' },
    { key: 'screenOn', title: 'Écran toujours allumé', hint: 'Pratique sur tablette : elle ne s’éteint pas pendant que tu pédales.' },
  ],
};

export function renderOptions(page: HTMLElement, ctx: MenuContext, onTheme: () => void): void {
  const p = ctx.profile;
  const row = (s: Switch) => `<label class="m-opt-row">
      <span><b>${s.title}</b><small>${s.hint}</small></span>
      <input type="checkbox" role="switch" data-k="${s.key}">
    </label>`;
  page.innerHTML = `
    <h2 class="m-title">Options</h2>
    <section class="m-card m-opt">
      <h3 class="m-caption">Son</h3>
      ${SWITCHES.son.map(row).join('')}
      <label class="m-opt-row" data-r="volumeRow">
        <span><b>Volume</b><small data-r="volumeText"></small></span>
        <input type="range" min="0" max="100" step="5" data-r="volume" value="${p.volume}">
      </label>
    </section>
    <section class="m-card m-opt">
      <h3 class="m-caption">Apparence</h3>
      <div class="m-opt-row">
        <span><b>Thème des menus</b><small>Clair le jour, sombre le soir, ou celui de ton appareil.</small></span>
        <div class="m-segment" role="group" aria-label="Thème">${THEMES.map((t) => `<button class="m-seg" data-theme="${t.id}" aria-pressed="false">${t.label}</button>`).join('')}</div>
      </div>
    </section>
    <section class="m-card m-opt">
      <h3 class="m-caption">Pendant la sortie</h3>
      ${SWITCHES.sortie.map(row).join('')}
    </section>
    <section class="m-card m-opt">
      <h3 class="m-caption">Mes données</h3>
      <div class="m-opt-row">
        <span><b>Tout effacer</b><small>Profil, séances, historique et records de cet appareil. Il n'y a pas de retour en arrière.</small></span>
        <button class="m-ghost" data-r="reset">Effacer…</button>
      </div>
    </section>
    <section class="m-card m-opt">
      <h3 class="m-caption">À propos</h3>
      <p class="m-credits-text">${CREDITS}</p>
    </section>`;

  const q = <T extends HTMLElement>(sel: string): T => page.querySelector(sel) as T;

  page.querySelectorAll<HTMLInputElement>('input[data-k]').forEach((box) => {
    const key = box.dataset.k as Switch['key'];
    box.checked = p[key];
    box.addEventListener('change', () => {
      p[key] = box.checked;
      showVolume();
      ctx.changed();
    });
  });

  const volume = q<HTMLInputElement>('[data-r="volume"]');
  const showVolume = () => {
    q('[data-r="volumeText"]').textContent = p.sound ? `${p.volume} %` : 'Les sons sont coupés';
    volume.disabled = !p.sound;
  };
  volume.addEventListener('input', () => {
    p.volume = Number(volume.value);
    showVolume();
    ctx.changed();
  });

  const showTheme = () =>
    page.querySelectorAll<HTMLElement>('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === p.theme)));
  page.querySelectorAll<HTMLElement>('[data-theme]').forEach((b) =>
    b.addEventListener('click', () => {
      p.theme = b.dataset.theme as Theme;
      showTheme();
      ctx.changed();
      onTheme();
    }),
  );

  // Effacer demande une seconde confirmation : un clic de trop ne doit pas tout perdre.
  const reset = q<HTMLButtonElement>('[data-r="reset"]');
  let armed = 0;
  reset.addEventListener('click', () => {
    if (!armed) {
      reset.textContent = 'Oui, tout effacer';
      reset.dataset.confirm = 'true';
      armed = window.setTimeout(() => {
        armed = 0;
        reset.textContent = 'Effacer…';
        delete reset.dataset.confirm;
      }, 5000);
      return;
    }
    clearTimeout(armed);
    try {
      localStorage.clear();
    } catch {
      // Sans stockage, il n'y a rien à effacer.
    }
    location.reload();
  });

  showVolume();
  showTheme();
}
