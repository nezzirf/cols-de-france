// Écran d'accueil : profil en haut, trois onglets, et à droite le cycliste avec le récapitulatif
// de la sortie. Tout ce que le joueur choisit reste dans son profil.

import { type AppOptions, CUSTOM_ROUTE_ID, type Profile, type WorkoutWhere } from '../app/profile';
import type { SavedRide } from '../app/rideAutosave';
import type { HistoryEntry } from '../app/rideHistory';
import { type Moment, MOMENTS, type Weather, WEATHERS } from '../world/ambiance';
import { findBike, findJersey, wearing, type Bike } from '../sim/bikes';
import type { GroupOptions } from '../sim/group';
import { SALON_ROUTE_ID } from '../sim/salonRoute';
import { WORLD_NAME, WORLD_ROUTE_ID } from '../sim/worldRoute';
import { loadRouteIndex, type RouteSummary } from '../sim/route';
import { loadWorkouts, saveWorkouts, WORKOUT_PRESETS, type Workout } from '../sim/workout';
import { duration, esc, fr, hex } from './format';
import './menu.css';
import { BikePreview } from './preview';
import { renderGarage } from './tabGarage';
import { renderHistory } from './tabHistory';
import { renderPeloton } from './tabPeloton';
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

type TabId = 'parcours' | 'entrainement' | 'peloton' | 'garage' | 'historique';

const TABS: { id: TabId; label: string }[] = [
  { id: 'parcours', label: 'Parcours' },
  { id: 'entrainement', label: 'Entraînement' },
  { id: 'peloton', label: 'Peloton' },
  { id: 'garage', label: 'Garage' },
  { id: 'historique', label: 'Historique' },
];

const CREDITS =
  'Tracés © contributeurs OpenStreetMap (ODbL) · Altitudes IGN RGE ALTI · Relief Mapzen Terrain Tiles · Bâtiments IGN BD TOPO · Photos IGN BD ORTHO · Vélo de route « Canyon Aeroad » par hipoojan (Sketchfab) · Cycliste « MEN » par shakeelsafdar, casque « Capacete Ciclista » par LAFF3D et lunettes « Action Sunglass » par Nazmul (Sketchfab, CC BY 4.0)';

const DEVICES: { kind: DeviceKind; label: string; title: string }[] = [
  { kind: 'ble', label: 'Bluetooth', title: 'Connecter le KICKR Core en Bluetooth' },
  { kind: 'ant', label: 'ANT+', title: 'Connecter le KICKR Core avec une clé ANT+ USB' },
  { kind: 'hr', label: 'Cardio', title: 'Connecter une ceinture cardio' },
  { kind: 'play', label: 'Zwift Play', title: 'Connecter les manettes Zwift Play pour changer de vitesse' },
];

export class Menu {
  private tab: TabId = 'parcours';
  private preview: BikePreview | null = null;
  private shownBike = '';
  private context: MenuContext;

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
        </div>
      </header>
      <nav class="m-tabs" role="tablist">
        ${TABS.map((t) => `<button class="m-tab" role="tab" data-t="${t.id}">${t.label}</button>`).join('')}
      </nav>
      <div class="m-body">
        <main class="m-content" data-r="content"></main>
        <aside class="m-side">
          <canvas class="m-preview" data-r="preview" aria-label="Aperçu du cycliste et du vélo, à faire tourner à la souris"></canvas>
          <div class="m-summary" data-r="summary"></div>
          <label class="m-slope" data-r="slope">
            <span>Pente ressentie <b data-r="difficulty"></b></span>
            <input type="range" min="25" max="100" step="5" data-p="difficulty" value="${this.profile.difficulty}">
          </label>
          <div class="m-ambiance" data-r="ambiance">
            <div class="m-ambiance-row">
              <label>Météo<select data-o="weather">${WEATHERS.map((w) => `<option value="${w.id}">${w.label}</option>`).join('')}</select></label>
              <label>Moment<select data-o="moment">${MOMENTS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select></label>
            </div>
            <label class="m-check" data-r="pelotonRow"><input type="checkbox" data-o="peloton"> Rouler avec un peloton</label>
            <label class="m-check"><input type="checkbox" data-o="ghost"> Fantôme de ma meilleure sortie</label>
          </div>
          <button class="m-go" data-a="start">Rouler</button>
          <p class="m-msg" data-r="msg">Sans home trainer connecté, la sortie démarre en mode démo au clavier.</p>
        </aside>
      </div>
      <footer class="m-credits">${CREDITS}</footer>
    </div>`;

    this.q<HTMLInputElement>('[data-r="name"]').addEventListener('input', (e) => {
      this.profile.name = (e.target as HTMLInputElement).value;
      this.changed();
    });
    this.root.querySelectorAll<HTMLInputElement>('[data-p]').forEach((input) => {
      input.addEventListener('input', () => {
        const value = Number(input.value);
        const key = input.dataset.p as 'ftp' | 'riderKg' | 'difficulty';
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
    this.root.querySelectorAll<HTMLSelectElement>('select[data-o]').forEach((select) => {
      const key = select.dataset.o as 'weather' | 'moment';
      select.value = this.profile[key];
      select.addEventListener('change', () => {
        if (key === 'weather') this.profile.weather = select.value as Weather;
        else this.profile.moment = select.value as Moment;
        this.changed();
      });
    });
    this.root.querySelectorAll<HTMLInputElement>('input[data-o]').forEach((box) => {
      const key = box.dataset.o as 'peloton' | 'ghost';
      box.checked = this.profile[key];
      box.addEventListener('change', () => {
        this.profile[key] = box.checked;
        this.changed();
      });
    });
    this.q('[data-a="start"]').addEventListener('click', () => void this.start());

    this.preview = new BikePreview(this.q('[data-r="preview"]'));
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

  private openTab(tab: TabId): void {
    this.tab = tab;
    this.root.querySelectorAll<HTMLElement>('[data-t]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.t === tab));
    });
    const content = this.q('[data-r="content"]');
    content.innerHTML = '';
    this.renderResume(content);
    const page = document.createElement('div');
    page.className = 'm-page';
    content.appendChild(page);
    if (tab === 'parcours') renderRoutes(page, this.context);
    else if (tab === 'entrainement') renderWorkouts(page, this.context);
    else if (tab === 'peloton') renderPeloton(page, this.context);
    else if (tab === 'historique') renderHistory(page, this.context);
    else renderGarage(page, this.context);
    // Le résumé dépend de l'onglet : le lieu choisi dans Entraînement ne vaut que là, ou avec une séance.
    this.changed();
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
  }

  /** Redessine l'aperçu du cycliste, par exemple quand un modèle vient d'être chargé. */
  refreshPreview(): void {
    this.shownBike = '';
    this.changed();
  }

  /** Séance retenue pour la prochaine sortie. */
  private get workout(): Workout | null {
    const list = [...this.context.workouts, ...WORKOUT_PRESETS];
    return list.find((w) => w.id === this.profile.workoutId) ?? null;
  }

  /**
   * Ce que lancera « Rouler ». Dans l'onglet Entraînement, ou dès qu'une séance est choisie, le lieu
   * choisi là s'applique, séance ou non ; sinon, c'est le parcours choisi dans l'onglet Parcours.
   */
  private get launch(): { where: WorkoutWhere; routeId: string; app: AppOptions | null; group: GroupOptions | null } {
    const p = this.profile;
    // Dans l'onglet Peloton, c'est le groupe et son parcours : pas de séance guidée.
    const group: GroupOptions | null = this.tab === 'peloton' ? { riders: p.groupRiders, wkg: p.groupWkg } : null;
    const training = group === null && (this.workout !== null || this.tab === 'entrainement');
    const where: WorkoutWhere = training ? p.workoutWhere : 'parcours';
    const routeId = group ? p.groupRouteId : where === 'monde' ? WORLD_ROUTE_ID : where === 'app' ? SALON_ROUTE_ID : p.routeId;
    return { where, routeId, app: where === 'app' ? { mode: p.appMode, bars: p.appBars } : null, group };
  }

  private routeLabel(): string {
    const p = this.profile;
    const { where, routeId } = this.launch;
    if (where === 'app') {
      const how = p.appMode === 'flottante' ? 'barre flottante' : p.appMode === 'partage' ? 'écran partagé' : { haut: 'barre en haut', bas: 'barre en bas', 'les-deux': 'barres en haut et en bas' }[p.appBars];
      return `Média · ${how}`;
    }
    if (where === 'monde' || routeId === WORLD_ROUTE_ID) return `${WORLD_NAME} · boucle de 6 biomes`;
    if (routeId === CUSTOM_ROUTE_ID) return `Personnalisé · ${fr(p.customKm)} km à ${fr(p.customGrade)} %`;
    return this.context.routes.find((r) => r.id === routeId)?.name ?? '--';
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
    this.q('[data-r="difficulty"]').textContent = `${p.difficulty} %`;

    const { group } = this.launch;
    const workout = group ? null : this.workout;
    // En ERG, le home trainer suit la puissance : la pente ressentie ne joue plus.
    this.q('[data-r="slope"]').hidden = workout !== null;
    // L'ambiance et le peloton n'ont de sens que dans le monde 3D, et le peloton hors séance guidée.
    this.q('[data-r="ambiance"]').hidden = this.launch.where === 'app';
    this.q('[data-r="pelotonRow"]').hidden = workout !== null || group !== null;
    this.q('[data-r="summary"]').innerHTML = `
      <div class="m-sum-title">${esc(bike.name)}</div>
      <div class="m-sum-sub">${esc(bike.team?.name ?? bike.label)}</div>
      <dl>
        <div><dt>Maillot</dt><dd>${esc(jersey?.name ?? 'Tenue du vélo')}</dd></div>
        <div><dt>Parcours</dt><dd>${esc(this.routeLabel())}</dd></div>
        <div><dt>${group ? 'Peloton' : 'Séance'}</dt><dd>${group ? `${group.riders} coureurs · ${fr(group.wkg)} W/kg` : workout ? esc(workout.name) : 'Sortie libre'}</dd></div>
      </dl>`;

    const go = this.q<HTMLButtonElement>('[data-a="start"]');
    if (!go.disabled) go.textContent = group ? 'Rouler en peloton' : 'Rouler';

    const key = `${bike.id}|${bike.jersey}`;
    if (key !== this.shownBike) {
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

  private async start(): Promise<void> {
    const button = this.q<HTMLButtonElement>('[data-a="start"]');
    button.disabled = true;
    button.textContent = 'Chargement du relief…';
    // L'aperçu libère la carte graphique avant que le jeu ne la réclame.
    this.preview?.dispose();
    this.preview = null;
    try {
      const { routeId, app, group } = this.launch;
      await this.host.start(routeId, group ? null : this.workout, app, group);
    } catch (err) {
      await this.show();
      this.say(err instanceof Error ? err.message : String(err), true);
    }
  }
}
