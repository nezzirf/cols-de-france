// Écran d'accueil : le profil en haut, quatre onglets (sortie libre, entraînement, garage, historique), un engrenage pour
// les options, et en bas le résumé de ce qui va être lancé avec le bouton « Rouler ». Tout ce que le joueur choisit
// reste dans son profil.

import { type AppOptions, CUSTOM_ROUTE_ID, type Profile, type WorkoutWhere } from '../app/profile';
import type { SavedRide } from '../app/rideAutosave';
import { type HistoryEntry, loadHistory } from '../app/rideHistory';
import { findBike, findJersey, wearing, type Bike } from '../sim/bikes';
import type { GroupOptions } from '../sim/group';
import { SALON_ROUTE_ID } from '../sim/salonRoute';
import { WORLD_NAME, WORLD_ROUTE_ID } from '../sim/worldRoute';
import { loadRouteIndex, type RouteSummary } from '../sim/route';
import { expandBlocks, loadWorkouts, saveWorkouts, WORKOUT_PRESETS, type Workout } from '../sim/workout';
import { duration, esc, fr, hex } from './format';
import './menu.css';
import './menuLayout.css';
import { drawWorkoutArt } from './charts';
import { BikePreview, renderStill } from './preview';
import { renderGarage } from './tabGarage';
import { renderHistory } from './tabHistory';
import { renderOptions } from './tabOptions';
import { renderRideSettings } from './rideSettings';
import { renderRoutes } from './tabRoutes';
import { renderWorkouts } from './tabWorkouts';

export type DeviceKind = 'ble' | 'ant' | 'hr' | 'play';

export interface MenuHost {
  profile: Profile;
  saveProfile(): void;
  /** Rend le message à afficher ; lève une erreur si la connexion échoue. */
  connect(kind: DeviceKind): Promise<string>;
  isConnected(kind: DeviceKind): boolean;
  start(routeId: string, workout: Workout | null, app: AppOptions | null, group: GroupOptions | null): Promise<void>;
  /** Sortie interrompue que l'on peut reprendre, si elle existe. */
  pendingRide(): SavedRide | null;
  resumeRide(): Promise<void>;
  /** Termine la sortie interrompue : son récap s'affiche et elle entre dans l'historique. */
  finishPendingRide(): void;
  discardPendingRide(): void;
  /** Rouvre le récap d'une sortie de l'historique. */
  openRide(entry: HistoryEntry): void;
}

/** Ce que les onglets partagent avec l'écran. */
export interface MenuContext {
  profile: Profile;
  routes: RouteSummary[];
  workouts: Workout[];
  /** À appeler après tout changement de choix. */
  changed(): void;
  saveWorkouts(): void;
  openRide(entry: HistoryEntry): void;
}

type TabId = 'accueil' | 'sortie' | 'entrainement' | 'garage' | 'historique' | 'options';

const TABS: { id: TabId; label: string }[] = [
  { id: 'sortie', label: 'Sortie libre' },
  { id: 'entrainement', label: 'Entraînement' },
  { id: 'garage', label: 'Garage' },
  { id: 'historique', label: 'Historique' },
];

/** Les deux façons de rouler : sans séance (sortie libre) ou avec (entraînement). Le bouton Rouler suit la dernière ouverte. */
type Mode = 'sortie' | 'entrainement';

/** Les onglets où l'on prépare une sortie : le bouton Rouler s'y affiche. */
const RIDE_TABS: TabId[] = ['accueil', 'sortie', 'entrainement', 'garage'];

/** Les quatre gros boutons de l'accueil, avec leur dessin. */
const HUB: { id: Exclude<TabId, 'accueil' | 'options'>; title: string; icon: string }[] = [
  { id: 'sortie', title: 'Sortie libre', icon: '<path d="M2 19 9 6l4.5 8 3-4.5L22 19Z"/><path d="M9 6l2.2 3.6-2.2-1-2 1Z" class="snow"/>' },
  { id: 'entrainement', title: 'Entraînement', icon: '<path d="M13.5 2 5 13.5h6L10 22l9-12h-6.2Z"/>' },
  { id: 'garage', title: 'Garage', icon: '<circle cx="6" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="16" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 16 10 8h6l2 8M10 8 12 16M9 6h3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' },
  { id: 'historique', title: 'Historique', icon: '<path d="M4 20V12h4v8Zm6 0V5h4v15Zm6 0v-6h4v6Z"/>' },
];

const DEVICES: { kind: DeviceKind; label: string; title: string }[] = [
  { kind: 'ble', label: 'Bluetooth', title: 'Connecter le KICKR Core en Bluetooth' },
  { kind: 'ant', label: 'ANT+', title: 'Connecter le KICKR Core avec une clé ANT+ USB' },
  { kind: 'hr', label: 'Cardio', title: 'Connecter une ceinture cardio' },
  { kind: 'play', label: 'Zwift Play', title: 'Connecter les manettes Zwift Play pour changer de vitesse' },
];

/** Les images du bouton Garage déjà dessinées, par vélo et maillot : une même tenue ne se redessine pas. */
const stills = new Map<string, string>();

export class Menu {
  private tab: TabId = 'accueil';
  private mode: Mode = 'sortie';
  private preview: BikePreview | null = null;
  private shownBike = '';
  /** Les modèles 3D arrivent après le menu : tant qu'ils ne sont pas là, on n'affiche pas l'ancien cycliste dessiné par le code. */
  private loaded = { base: false, meshes: false };
  private context: MenuContext;
  private themeQuery: MediaQueryList | null = null;
  private onSystemTheme = (): void => this.applyTheme();

  constructor(
    private root: HTMLElement,
    private host: MenuHost,
  ) {
    this.context = {
      profile: host.profile,
      routes: [],
      workouts: loadWorkouts(),
      changed: () => this.changed(),
      saveWorkouts: () => saveWorkouts(this.context.workouts),
      openRide: (entry) => host.openRide(entry),
    };
  }

  private get profile(): Profile {
    return this.host.profile;
  }

  private get bike(): Bike {
    return wearing(findBike(this.profile.bikeId), this.profile.jerseyId);
  }

  private q<T extends HTMLElement>(selector: string): T {
    return this.root.querySelector(selector) as T;
  }

  async show(): Promise<void> {
    this.root.innerHTML = `<div class="m-root">
      <header class="m-top">
        <div class="m-player">
          <div class="m-avatar" data-r="avatar"></div>
          <div>
            <input class="m-name" data-r="name" aria-label="Nom du cycliste" maxlength="24" value="${esc(this.profile.name)}">
            <div class="m-brand">Cols de France</div>
          </div>
        </div>
        <div class="m-pills">
          <label class="m-pill"><small>FTP</small><input type="number" min="50" max="600" data-p="ftp" value="${this.profile.ftp}"><span>W</span></label>
          <label class="m-pill"><small>Poids</small><input type="number" min="35" max="150" step="0.5" data-p="riderKg" value="${this.profile.riderKg}"><span>kg</span></label>
          <div class="m-pill"><small>W/kg</small><b data-r="wkg"></b></div>
        </div>
        <div class="m-devices">
          ${DEVICES.map((d) => `<button class="m-device" data-d="${d.kind}" title="${d.title}">${d.label}</button>`).join('')}
          <button class="m-gear" data-t="options" aria-label="Options" title="Options">
            <svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="gear-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8d959e"/><stop offset="1" stop-color="#66707c"/></linearGradient><linearGradient id="gear-ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#cfd4da"/></linearGradient><linearGradient id="gear-eye" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1565b8"/><stop offset="1" stop-color="#0a4a94"/></linearGradient><mask id="gear-cut"><rect width="100" height="100" fill="#fff"/><circle cx="92.4" cy="74.5" r="13" fill="#000"/><circle cx="50.0" cy="99.0" r="13" fill="#000"/><circle cx="7.6" cy="74.5" r="13" fill="#000"/><circle cx="7.6" cy="25.5" r="13" fill="#000"/><circle cx="50.0" cy="1.0" r="13" fill="#000"/><circle cx="92.4" cy="25.5" r="13" fill="#000"/></mask></defs><circle cx="50" cy="50" r="46" fill="url(#gear-body)" mask="url(#gear-cut)"/><circle cx="50" cy="50" r="22" fill="url(#gear-ring)"/><circle cx="50" cy="50" r="14.5" fill="url(#gear-eye)"/></svg>
          </button>
        </div>
      </header>
      <nav class="m-tabs" role="tablist">
        <button class="m-tab m-home" data-t="accueil" aria-label="Retour à l'accueil">← Accueil</button>
        ${TABS.map((t) => `<button class="m-tab" role="tab" data-t="${t.id}">${t.label}</button>`).join('')}
      </nav>
      <main class="m-content" data-r="content"></main>
      <footer class="m-bar" data-r="bar">
        <div class="m-summary" data-r="summary"></div>
        <p class="m-msg" data-r="msg">Connecte ton home trainer pour que la résistance suive la route.</p>
        <button class="m-go" data-a="start">Rouler</button>
      </footer>
    </div>`;

    this.applyTheme();
    this.themeQuery?.removeEventListener('change', this.onSystemTheme);
    this.themeQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    this.themeQuery?.addEventListener('change', this.onSystemTheme);

    this.q<HTMLInputElement>('[data-r="name"]').addEventListener('input', (e) => {
      this.profile.name = (e.target as HTMLInputElement).value;
      this.changed();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-p]').forEach((input) => {
      input.addEventListener('input', () => {
        const value = Number(input.value);
        const key = input.dataset.p as 'ftp' | 'riderKg';
        if (value >= Number(input.min) && value <= Number(input.max)) this.profile[key] = value;
        this.changed();
      });
    });
    this.root.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => {
      b.addEventListener('click', () => this.openTab(b.dataset.t as TabId));
    });
    this.root.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => {
      b.addEventListener('click', () => void this.connect(b.dataset.d as DeviceKind));
    });
    this.q('[data-a="start"]').addEventListener('click', () => void this.start());

    try {
      this.context.routes = await loadRouteIndex();
    } catch (err) {
      this.say(`Données introuvables : ${err instanceof Error ? err.message : err}. Lance « npm run routes ».`, true);
    }
    const known = this.context.routes.some((r) => r.id === this.profile.routeId);
    if (!known && this.profile.routeId !== CUSTOM_ROUTE_ID && this.profile.routeId !== WORLD_ROUTE_ID) this.profile.routeId = this.context.routes[0]?.id ?? CUSTOM_ROUTE_ID;
    this.openTab(this.tab);
    this.changed();
  }

  /** Thème des menus : celui de l'appareil, ou clair, ou sombre selon le choix. */
  private applyTheme(): void {
    const root = this.root.querySelector<HTMLElement>('.m-root');
    if (!root) return;
    const choice = this.profile.theme;
    const dark = choice === 'sombre' || (choice === 'auto' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
  }

  private openTab(tab: TabId): void {
    this.tab = tab;
    if (tab === 'sortie' || tab === 'entrainement') this.mode = tab;
    this.preview?.dispose();
    this.preview = null;
    this.root.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.t === tab));
    });
    const content = this.q('[data-r="content"]');
    content.innerHTML = '';
    content.scrollTop = 0;
    this.renderResume(content);
    const page = document.createElement('div');
    page.className = 'm-page';
    content.appendChild(page);
    if (tab === 'accueil') {
      this.renderHub(page);
      this.changed();
      return;
    }
    const settings = document.createElement('div');
    settings.dataset.r = 'settings';
    if (tab === 'sortie') {
      renderRideSettings(settings, this.context, { training: false, media: false });
      page.appendChild(settings);
      const routes = document.createElement('div');
      page.appendChild(routes);
      renderRoutes(routes, this.context);
    } else if (tab === 'entrainement') {
      renderWorkouts(page, this.context);
      renderRideSettings(settings, this.context, { training: true, media: false });
      page.appendChild(settings);
    } else if (tab === 'historique') renderHistory(page, this.context);
    else if (tab === 'options') renderOptions(page, this.context, () => this.applyTheme());
    else this.renderGaragePage(page);
    // Le résumé dépend de l'onglet : le lieu choisi dans Entraînement ne vaut que là.
    this.changed();
  }

  /** L'accueil : quatre gros boutons, chacun avec ce qui est choisi en ce moment. */
  private renderHub(page: HTMLElement): void {
    const p = this.profile;
    const runs = loadHistory().length;
    const hint: Record<(typeof HUB)[number]['id'], string> = {
      sortie: `${this.labelOf(p.routeId)}${p.group ? ' · en peloton' : ''}`,
      entrainement: this.workout?.name ?? 'Une séance guidée, aux watts imposés',
      garage: `${this.bike.name} · ${findJersey(p.jerseyId)?.name ?? 'Tenue du vélo'}`,
      historique: runs ? `${runs} sortie${runs > 1 ? 's' : ''} enregistrée${runs > 1 ? 's' : ''}` : 'Tes sorties apparaîtront ici',
    };
    // La sortie libre prend la photo aérienne du col choisi ; les autres ont leur dégradé, défini dans la feuille de style.
    // Le monde d'entraînement et le parcours personnalisé n'ont pas de photo : ils prennent celle du premier col.
    const photoId = this.context.routes.some((r) => r.id === p.routeId) ? p.routeId : this.context.routes[0]?.id;
    const photo = photoId ? `linear-gradient(180deg, rgba(14, 22, 30, 0.25), rgba(14, 22, 30, 0.82)), url(data/${photoId}/ortho.jpg) center / cover` : '';
    page.innerHTML = `<div class="m-hub">${HUB.map(
      (h) => `<button class="m-hub-card" data-hub="${h.id}"${h.id === 'sortie' && photo ? ` style="background:${photo}"` : ''}>
        ${h.id === 'entrainement' ? '<canvas class="m-hub-chart" aria-hidden="true"></canvas>' : h.id === 'garage' ? '<img class="m-hub-bike" alt="" hidden>' : `<svg viewBox="0 0 24 24" aria-hidden="true">${h.icon}</svg>`}
        <b>${h.title}</b>
        <span>${esc(hint[h.id])}</span>
      </button>`,
    ).join('')}</div>`;
    page.querySelectorAll<HTMLElement>('[data-hub]').forEach((b) => b.addEventListener('click', () => this.openTab(b.dataset.hub as TabId)));
    // Les dessins des boutons se font une fois la page en place : ils ont besoin de leur taille affichée.
    requestAnimationFrame(() => this.paintHub());
  }

  /** Le cycliste et son vélo modélisés sont-ils chargés ? Les vélos d'un seul maillage arrivent après les autres. */
  private modelsReady(bike: Bike): boolean {
    if (!this.loaded.base) return false;
    const slow = bike.asset === 'rcrf' || bike.asset === 'aeroad' || bike.asset === 'giant' || bike.asset === 'filante' || bike.asset === 'xlab' || bike.asset === 'addict' || bike.asset === 'ef' || bike.asset === 'sl9' || bike.asset === 'pinarello' || bike.asset === 'trinity';
    return !slow || this.loaded.meshes;
  }

  /** Le déroulé de la séance choisie en fond de « Entraînement », et le cycliste de profil sur son vélo dans « Garage ». */
  private paintHub(): void {
    if (this.tab !== 'accueil') return;
    const chart = this.root.querySelector<HTMLCanvasElement>('.m-hub-chart');
    if (chart) {
      // Une séance toute plate ferait une simple dalle : pour le décor, elle cède la place à un modèle plus animé.
      const own = expandBlocks((this.workout ?? WORKOUT_PRESETS[0]).blocks);
      drawWorkoutArt(chart, own.length >= 5 ? own : expandBlocks(WORKOUT_PRESETS.find((w) => w.id === 'preset-sweetspot')!.blocks));
    }
    const img = this.root.querySelector<HTMLImageElement>('.m-hub-bike');
    if (!img) return;
    const bike = this.bike;
    if (!this.modelsReady(bike)) {
      img.hidden = true;
      return;
    }
    const key = `${bike.id}|${bike.jersey}|${JSON.stringify(bike.livery)}`;
    let url = stills.get(key);
    if (!url) {
      try {
        url = renderStill(bike, 1100, 640);
        stills.set(key, url);
      } catch {
        return;
      }
    }
    img.src = url;
    img.hidden = false;
  }

  /** Le garage : la liste à gauche, l'aperçu du cycliste à droite et toujours en vue, pour voir tout de suite ce qu'on choisit. */
  private renderGaragePage(page: HTMLElement): void {
    page.classList.add('m-garage');
    const body = document.createElement('div');
    body.className = 'm-garage-list';
    page.appendChild(body);
    const stage = document.createElement('div');
    stage.className = 'm-stage';
    stage.innerHTML = '<canvas class="m-preview" aria-label="Aperçu du cycliste et du vélo, à faire tourner à la souris"></canvas>';
    page.appendChild(stage);
    renderGarage(body, this.context);
    this.shownBike = '';
    this.preview = new BikePreview(stage.querySelector('canvas') as HTMLCanvasElement);
  }

  /** Propose de reprendre la sortie interrompue, quand il y en a une. */
  private renderResume(content: HTMLElement): void {
    const saved = this.host.pendingRide();
    if (!saved) return;
    const last = saved.samples[saved.samples.length - 1];
    const km = last ? last.distanceM / 1000 : 0;
    const box = document.createElement('div');
    box.className = 'm-resume';
    box.innerHTML = `<p><b>Sortie interrompue</b> · ${esc(saved.name)} · ${duration(saved.state.elapsedS)} · ${fr(km)} km</p>
      <div class="m-resume-actions">
        <button class="primary" data-a="resume">Reprendre</button>
        <button data-a="finish">Terminer et voir le récap</button>
        <button data-a="discard">Abandonner</button>
      </div>`;
    box.querySelector('[data-a="resume"]')!.addEventListener('click', () => void this.resume());
    box.querySelector('[data-a="finish"]')!.addEventListener('click', () => this.host.finishPendingRide());
    box.querySelector('[data-a="discard"]')!.addEventListener('click', () => {
      this.host.discardPendingRide();
      box.remove();
    });
    content.appendChild(box);
  }

  private async resume(): Promise<void> {
    this.preview?.dispose();
    this.preview = null;
    try {
      await this.host.resumeRide();
    } catch (err) {
      await this.show();
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }

  /** Libère l'aperçu 3D quand le menu laisse la place à un autre écran. */
  close(): void {
    this.preview?.dispose();
    this.preview = null;
    this.themeQuery?.removeEventListener('change', this.onSystemTheme);
  }

  /** Redessine l'aperçu du cycliste, par exemple quand un modèle vient d'être chargé. */
  refreshPreview(step: 'base' | 'meshes' = 'base'): void {
    this.loaded[step] = true;
    this.shownBike = '';
    // Le vélo modélisé vient d'arriver : les images dessinées avec l'ancien modèle ne valent plus.
    stills.clear();
    this.changed();
    this.paintHub();
  }

  /** Séance retenue pour la prochaine sortie. */
  private get workout(): Workout | null {
    const list = [...this.context.workouts, ...WORKOUT_PRESETS];
    return list.find((w) => w.id === this.profile.workoutId) ?? null;
  }

  /**
   * Ce que lancera « Rouler ». En entraînement, c'est la séance choisie et le lieu choisi là (le monde, un col, ou
   * devant une application) ; en sortie libre, c'est le parcours choisi dans l'onglet, seul ou en peloton.
   */
  private get launch(): { where: WorkoutWhere; routeId: string; app: AppOptions | null; group: GroupOptions | null; workout: Workout | null } {
    const p = this.profile;
    const training = this.mode === 'entrainement';
    const group: GroupOptions | null = !training && p.group ? { riders: p.groupRiders, wkg: p.groupWkg } : null;
    const where: WorkoutWhere = training ? p.workoutWhere : 'parcours';
    const routeId = where === 'monde' ? WORLD_ROUTE_ID : where === 'app' ? SALON_ROUTE_ID : p.routeId;
    return { where, routeId, app: where === 'app' ? { mode: p.appMode, bars: p.appBars } : null, group, workout: training ? this.workout : null };
  }

  /** Le nom d'un parcours pour l'affichage. */
  private labelOf(routeId: string): string {
    const p = this.profile;
    if (routeId === WORLD_ROUTE_ID) return `${WORLD_NAME} · boucle de 6 biomes`;
    if (routeId === CUSTOM_ROUTE_ID) return `Personnalisé · ${fr(p.customKm)} km à ${fr(p.customGrade)} %`;
    return this.context.routes.find((r) => r.id === routeId)?.name ?? '--';
  }

  private routeLabel(): string {
    const p = this.profile;
    const { where, routeId } = this.launch;
    if (where === 'app') {
      const how = p.appMode === 'flottante' ? 'barre flottante' : p.appMode === 'pastille' ? 'pastille flottante' : p.appMode === 'partage' ? 'écran partagé' : { haut: 'barre en haut', bas: 'barre en bas', 'les-deux': 'barres en haut et en bas' }[p.appBars];
      return `Média · ${how}`;
    }
    return this.labelOf(where === 'monde' ? WORLD_ROUTE_ID : routeId);
  }

  private changed(): void {
    const p = this.profile;
    this.host.saveProfile();
    const bike = this.bike;
    const jersey = findJersey(p.jerseyId);

    const avatar = this.q('[data-r="avatar"]');
    avatar.textContent = (p.name.trim()[0] ?? '?').toUpperCase();
    avatar.style.background = `linear-gradient(135deg, ${hex(bike.jersey)}, ${hex(bike.accent)})`;
    avatar.style.color = (bike.jersey & 0xff) + ((bike.jersey >> 8) & 0xff) + (bike.jersey >> 16) > 560 ? '#1d2329' : '#fff';
    this.q('[data-r="wkg"]').textContent = fr(p.ftp / p.riderKg, 2);

    const { group, workout, where } = this.launch;
    // Devant une application, il n'y a pas de décor : ni météo ni compagnons.
    const settings = this.root.querySelector<HTMLElement>('[data-r="settings"]');
    if (settings) settings.hidden = where === 'app';
    this.q<HTMLElement>('.m-tabs').hidden = this.tab === 'accueil';
    this.q('[data-r="bar"]').hidden = !RIDE_TABS.includes(this.tab);
    this.root.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.t === this.tab)));
    this.q('[data-r="summary"]').innerHTML = `
      <div class="m-sum-main"><b>${esc(this.routeLabel())}</b><span>${group ? `Peloton · ${group.riders} coureurs · ${fr(group.wkg)} W/kg` : workout ? esc(workout.name) : 'Sortie libre'}</span></div>
      <div class="m-sum-bike">${esc(bike.name)} · ${esc(jersey?.name ?? bike.team?.name ?? 'Tenue du vélo')}</div>`;

    const go = this.q<HTMLButtonElement>('[data-a="start"]');
    if (!go.disabled) go.textContent = group ? 'Rouler en peloton' : 'Rouler';

    const key = `${bike.id}|${bike.jersey}|${JSON.stringify(bike.livery)}`;
    if (!this.modelsReady(bike)) {
      this.shownBike = '';
      this.preview?.hide();
    } else if (key !== this.shownBike) {
      this.shownBike = key;
      this.preview?.show(bike);
    }
    this.root.querySelectorAll<HTMLElement>('[data-d]').forEach((b) => {
      b.dataset.on = String(this.host.isConnected(b.dataset.d as DeviceKind));
    });
  }

  say(text: string, error = false): void {
    const msg = this.q('[data-r="msg"]');
    msg.textContent = text;
    msg.classList.toggle('error', error);
  }

  private async connect(kind: DeviceKind): Promise<void> {
    this.say('Connexion…');
    try {
      this.say(await this.host.connect(kind));
    } catch (err) {
      this.say(err instanceof Error ? err.message : String(err), true);
    }
    this.changed();
  }

  /** Un home trainer est connecté, en Bluetooth ou avec la clé ANT+. */
  private hasTrainer(): boolean {
    return this.host.isConnected('ble') || this.host.isConnected('ant');
  }

  /**
   * Sans home trainer, la sortie démarrerait en mode démo au clavier sans qu'on s'en aperçoive : on le signale, et on
   * laisse choisir. Rend vrai si le joueur veut quand même rouler en démo.
   */
  private askNoTrainer(): Promise<boolean> {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'm-modal';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'm-modal-title');
      overlay.innerHTML = `<div class="m-modal-card">
        <h3 id="m-modal-title">Aucun home trainer connecté</h3>
        <p>Connecte ton home trainer (Bluetooth ou clé ANT+) avant de rouler, sinon la résistance ne suivra pas la route.</p>
        <p class="m-modal-note">Tu peux aussi rouler en mode démo : tu pédales au clavier (flèches ou ZQSD), sans home trainer.</p>
        <div class="m-modal-actions">
          <button class="primary" data-m="connect">Connecter en Bluetooth</button>
          <button data-m="demo">Rouler en démo</button>
          <button data-m="cancel">Annuler</button>
        </div>
      </div>`;
      const close = (demo: boolean) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(demo);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') close(false);
      };
      document.addEventListener('keydown', onKey);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close(false);
      });
      overlay.querySelector('[data-m="demo"]')!.addEventListener('click', () => close(true));
      overlay.querySelector('[data-m="cancel"]')!.addEventListener('click', () => close(false));
      overlay.querySelector('[data-m="connect"]')!.addEventListener('click', () => {
        close(false);
        void this.connect('ble');
      });
      this.q('.m-root').appendChild(overlay);
      overlay.querySelector<HTMLElement>('[data-m="connect"]')!.focus();
    });
  }

  private async start(): Promise<void> {
    if (!this.hasTrainer() && !(await this.askNoTrainer())) return;
    const button = this.q<HTMLButtonElement>('[data-a="start"]');
    button.disabled = true;
    button.textContent = 'Chargement du relief…';
    // L'aperçu libère la carte graphique avant que le jeu ne la réclame.
    this.preview?.dispose();
    this.preview = null;
    try {
      const { routeId, app, group, workout } = this.launch;
      await this.host.start(routeId, group ? null : workout, app, group);
    } catch (err) {
      await this.show();
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }
}
