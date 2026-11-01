// Point d'entrée : menu, appairage du matériel, lancement et fin de sortie.

import { Game, type RideSummary } from './app/game';
import { DemoTrainer } from './hardware/demoTrainer';
import { BluetoothHeartRate } from './hardware/heartRate';
import { KickrAnt } from './hardware/antUsb';
import { KickrBluetooth } from './hardware/kickrBluetooth';
import type { HeartRateSensor, Trainer } from './hardware/types';
import { formatTime, Hud } from './hud/hud';
import './hud/hud.css';
import { drawClimbCard } from './hud/minimap';
import { ALL_BIKES, DEFAULT_BIKE_ID, findBike, GENERIC_BIKES, setupFor, TEAMS, type Bike } from './sim/bikes';
import { steadySpeed } from './sim/physicsEngine';
import { loadRoute, loadRouteIndex, Route, type RouteData, type RouteSummary } from './sim/route';
import { type FreeCamera, MOVE_KEYS } from './world/freeCamera';
import { World } from './world/scene';

interface Profile {
  riderKg: number;
  bikeId: string;
  difficulty: number;
}

const PROFILE_KEY = 'cols.profile';
const DEFAULT_PROFILE: Profile = { riderKg: 75, bikeId: DEFAULT_BIKE_ID, difficulty: 100 };

function loadProfile(): Profile {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PROFILE;
  }
}

function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    // Sans stockage, le profil reste valable pour la séance.
  }
}

const DEMO_HINT = '↑ ↓ puissance · Maj : ±50 W · F caméra libre · Pg↑ Pg↓ ±1 km · P pause · V caméra · Échap quitter';
const FREE_HINT = 'ZQSD déplacer · clic + souris regarder · A E descendre, monter · Maj vite · molette vitesse · T poser le cycliste ici · F sortir';
const JUMP_M = 1000;
const EXPLORE_REFRESH_MS = 150;

function bikeOptions(): string {
  const option = (b: Bike, label: string) => `<option value="${b.id}">${label}</option>`;
  const generic = GENERIC_BIKES.map((b) => option(b, b.name)).join('');
  const teams = TEAMS.map((t) => {
    const bikes = ALL_BIKES.filter((b) => b.team === t);
    return `<optgroup label="${t.name}">${bikes.map((b) => option(b, `${b.name} · ${b.label}`)).join('')}</optgroup>`;
  }).join('');
  return `<optgroup label="Vélos sans équipe">${generic}</optgroup>${teams}`;
}

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Résumé du vélo choisi : son effet se lit directement en vitesse. */
function bikeSummary(bike: Bike, riderKg: number): string {
  const setup = setupFor(bike, riderKg);
  const speed = (grade: number) => fr(steadySpeed(250, grade, 1000, setup) * 3.6);
  return `<div class="bike-head">
      <span class="swatch" style="background:${css(bike.jersey)}"></span><span class="swatch" style="background:${css(bike.accent)}"></span><span class="swatch" style="background:${css(bike.frame)}"></span>
      <span>${bike.team ? bike.team.name : 'Sans équipe'}</span>
    </div>
    <div class="dim">${bike.label} · ${fr(bike.kg)} kg · CdA ${fr(bike.cda, 3)} · Crr ${fr(bike.crr, 4)}</div>
    <div>À 250 W : ${speed(0)} km/h sur le plat · ${speed(8)} km/h à 8 %</div>`;
}

const fr = (v: number, digits = 1): string => v.toFixed(digits).replace('.', ',');

class App {
  private root = document.getElementById('app')!;
  private canvas = document.getElementById('view') as HTMLCanvasElement;
  private profile = loadProfile();
  private selected = '';
  private trainer: Trainer | null = null;
  private hr: HeartRateSensor | null = null;
  private game: Game | null = null;
  private world: World | null = null;
  private bpmBeforeStart: number | null = null;
  private route: Route | null = null;
  private hud: Hud | null = null;
  private lastExplore = 0;
  private looking = false;

  async showMenu(): Promise<void> {
    this.root.innerHTML = `<div class="screen"><div class="menu">
      <h1>Cols de France</h1>
      <p class="menu-sub">Les grands cols sur leurs routes réelles, depuis la vallée, sur home trainer.</p>
      <div class="menu-grid">
        <div class="cols" data-r="cols" aria-label="Choix du col"></div>
        <aside class="side">
          <div>
            <h3>Cycliste</h3>
            <label class="field">Poids (kg)<input type="number" min="35" max="150" step="0.5" data-p="riderKg" value="${this.profile.riderKg}"></label>
            <label class="field"><span>Pente ressentie <span data-r="diffLabel">${this.profile.difficulty} %</span></span><input type="range" min="25" max="100" step="5" data-p="difficulty" value="${this.profile.difficulty}"></label>
          </div>
          <div>
            <h3>Vélo</h3>
            <select class="bike-select" data-r="bike" aria-label="Choix du vélo">${bikeOptions()}</select>
            <div class="bike-card" data-r="bikeCard"></div>
          </div>
          <div>
            <h3>Matériel</h3>
            <button class="btn" data-a="ble">Connecter le KICKR Core (Bluetooth)</button>
            <button class="btn" data-a="ant">Connecter le KICKR Core (ANT+ USB)</button>
            <button class="btn" data-a="hr">Connecter une ceinture cardio</button>
            <p class="msg" data-r="msg">Sans home trainer connecté, la sortie démarre en mode démo au clavier.</p>
          </div>
          <button class="btn primary" data-a="start" disabled>Rouler</button>
        </aside>
      </div>
      <p class="credits">Tracés © contributeurs OpenStreetMap (ODbL) · Altitudes IGN RGE ALTI · Relief Mapzen Terrain Tiles · Bâtiments IGN BD TOPO · Photos IGN BD ORTHO</p>
    </div></div>`;

    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    const msg = q<HTMLElement>('[data-r="msg"]');
    const start = q<HTMLButtonElement>('[data-a="start"]');
    const say = (text: string, error = false) => {
      msg.textContent = text;
      msg.classList.toggle('error', error);
    };

    this.root.querySelectorAll<HTMLInputElement>('[data-p]').forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.p as 'riderKg' | 'difficulty';
        const value = Number(input.value);
        if (Number.isFinite(value)) this.profile[key] = value;
        q('[data-r="diffLabel"]').textContent = `${this.profile.difficulty} %`;
        saveProfile(this.profile);
      });
    });

    const bikeSelect = q<HTMLSelectElement>('[data-r="bike"]');
    const bikeCard = q<HTMLElement>('[data-r="bikeCard"]');
    const showBike = () => {
      const bike = findBike(this.profile.bikeId);
      bikeSelect.value = bike.id;
      bikeCard.innerHTML = bikeSummary(bike, this.profile.riderKg);
    };
    bikeSelect.addEventListener('change', () => {
      this.profile.bikeId = bikeSelect.value;
      saveProfile(this.profile);
      showBike();
    });
    q<HTMLInputElement>('[data-p="riderKg"]').addEventListener('input', showBike);
    showBike();

    const connect = async (button: HTMLElement, make: () => Trainer) => {
      await this.trainer?.disconnect();
      const trainer = make();
      say('Connexion…');
      try {
        await trainer.connect();
        this.trainer = trainer;
        this.root.querySelectorAll<HTMLElement>('[data-a="ble"],[data-a="ant"]').forEach((b) => (b.dataset.on = 'false'));
        button.dataset.on = 'true';
        say(`${trainer.label} connecté (${trainer.protocol}).`);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'NotFoundError') say('Aucun appareil choisi.');
        else say(err instanceof Error ? err.message : String(err), true);
      }
    };
    const bleBtn = q<HTMLElement>('[data-a="ble"]');
    bleBtn.addEventListener('click', () => void connect(bleBtn, () => new KickrBluetooth(() => this.profile.riderKg + this.bike.kg)));
    const antBtn = q<HTMLElement>('[data-a="ant"]');
    antBtn.addEventListener('click', () =>
      void connect(antBtn, () => new KickrAnt(() => ({ riderKg: this.profile.riderKg, bikeKg: this.bike.kg, wheelRadiusM: this.bike.wheelRadiusM }))),
    );
    const hrBtn = q<HTMLElement>('[data-a="hr"]');
    hrBtn.addEventListener('click', async () => {
      await this.hr?.disconnect();
      const sensor = new BluetoothHeartRate();
      sensor.onBpm = (bpm) => {
        this.bpmBeforeStart = bpm;
        this.game?.receiveHeartRate(bpm);
      };
      try {
        await sensor.connect();
        this.hr = sensor;
        hrBtn.dataset.on = 'true';
        say('Ceinture cardio connectée.');
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'NotFoundError')) {
          say(err instanceof Error ? err.message : String(err), true);
        }
      }
    });
    start.addEventListener('click', () => void this.startRide());

    let routes: RouteSummary[];
    try {
      routes = await loadRouteIndex();
    } catch (err) {
      say(`Données introuvables : ${err instanceof Error ? err.message : err}. Lance « npm run routes ».`, true);
      return;
    }
    const list = q<HTMLElement>('[data-r="cols"]');
    list.innerHTML = routes
      .map(
        (r) => `<button class="col-card" data-id="${r.id}" aria-pressed="false">
          <h2>${r.name}</h2>
          <div class="col-stats">${fr(r.climb.lengthKm)} km à ${fr(r.climb.avgGradePct)} %<br><span class="dim">${r.climb.topM} m · +${r.climb.gainM} m</span></div>
          <p>${r.subtitle} · ${fr(r.warmupKm)} km d'approche · ${r.massif}</p>
          <canvas width="760" height="64" data-c="${r.id}"></canvas>
        </button>`,
      )
      .join('');
    const pick = (id: string) => {
      this.selected = id;
      list.querySelectorAll<HTMLElement>('.col-card').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.id === id)));
      start.disabled = false;
    };
    list.querySelectorAll<HTMLElement>('.col-card').forEach((c) => c.addEventListener('click', () => pick(c.dataset.id!)));
    pick(this.selected || routes[0].id);

    await Promise.all(
      routes.map(async (r) => {
        const data = (await fetch(`data/${r.id}/route.json`).then((x) => x.json())) as RouteData;
        drawClimbCard(q<HTMLCanvasElement>(`[data-c="${r.id}"]`), new Route(data));
      }),
    );
  }

  private get bike(): Bike {
    return findBike(this.profile.bikeId);
  }

  private async startRide(): Promise<void> {
    const button = this.root.querySelector('[data-a="start"]') as HTMLButtonElement;
    button.disabled = true;
    button.textContent = 'Chargement du relief…';
    const { route, heights, buildings, ortho } = await loadRoute(this.selected);

    const demo = this.trainer === null;
    if (demo) {
      this.trainer = new DemoTrainer();
      await this.trainer.connect();
    }
    const trainer = this.trainer!;

    this.world = new World(this.canvas, route, heights, buildings, this.bike, ortho);
    const game = new Game(route, this.world, trainer, setupFor(this.bike, this.profile.riderKg), this.bike.shape);
    game.difficulty = this.profile.difficulty / 100;
    this.game = game;
    if (this.bpmBeforeStart !== null) game.receiveHeartRate(this.bpmBeforeStart);

    this.root.innerHTML = '';
    const hud = new Hud(this.root, route);
    hud.setConnection(trainer.label, trainer.state);
    trainer.onState = (state) => hud.setConnection(trainer.label, state);
    this.route = route;
    this.hud = hud;
    hud.setHint(demo ? DEMO_HINT : 'P pause · V caméra · Échap quitter');
    if (demo) {
      hud.enableExplore((d) => game.jumpTo(d));
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      this.canvas.addEventListener('pointermove', this.onPointerMove);
      this.canvas.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
    }
    hud.toast(`${route.data.name} · ${fr(route.data.footM / 1000)} km d'approche avant le pied du col`);

    game.onFrame = (s) => {
      hud.update(s, performance.now());
      if (demo) this.refreshExplore(s.distanceM);
    };
    game.onToast = (t) => hud.toast(t);
    game.onSegmentDone = (r) =>
      hud.toast(`${r.def.name} : ${formatTime(r.timeS)}${r.isNewPr ? ' · nouveau record' : ''}`, true);
    game.onTrainerError = (m) => hud.toast(`Home trainer : ${m}`);
    game.onFinish = (s) => this.showResult(route.data.name, s);

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    game.start();
    if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  }

  /** Position affichée pour pouvoir signaler un défaut à un endroit précis. */
  private refreshExplore(riderM: number): void {
    const now = performance.now();
    if (now - this.lastExplore < EXPLORE_REFRESH_MS || !this.route || !this.hud) return;
    this.lastExplore = now;
    const free = this.world?.free ?? null;
    const route = this.route;
    const here = free ? { x: free.x, z: free.z } : route.at(riderM);
    const near = route.nearest(here.x, here.z);
    const { lat, lon } = route.toLatLon(here.x, here.z);
    const where = `km ${fr(near.distM / 1000, 2)} · ${Math.round(route.eleAt(near.distM))} m · ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    const detail = free ? ` · à ${Math.round(near.offsetM)} m de la route · ${Math.round(free.speedMps)} m/s` : '';
    this.hud.updateExplore(riderM, where + detail);
  }

  private toggleFreeCamera(): void {
    if (!this.world || !this.game) return;
    if (this.world.free) {
      this.leaveFreeCamera();
      return;
    }
    this.world.enterFreeCamera();
    this.game.setFrozen(true);
    this.hud?.setHint(FREE_HINT);
  }

  private leaveFreeCamera(): void {
    this.world?.exitFreeCamera();
    this.game?.setFrozen(false);
    this.looking = false;
    this.hud?.setHint(DEMO_HINT);
  }

  /** Pose le cycliste sur la route, au point le plus proche de la caméra libre. */
  private dropRiderHere(free: FreeCamera): void {
    if (!this.route || !this.game) return;
    const target = this.route.nearest(free.x, free.z).distM;
    this.leaveFreeCamera();
    this.game.jumpTo(target);
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    const move = MOVE_KEYS[e.code];
    if (move) this.world?.free?.setKey(move, false);
  };

  private onBlur = (): void => {
    this.world?.free?.releaseAll();
    this.looking = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.world?.free) return;
    this.looking = true;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.looking) this.world?.free?.look(e.movementX, e.movementY);
  };

  private onPointerUp = (): void => {
    this.looking = false;
  };

  private onWheel = (e: WheelEvent): void => {
    this.world?.free?.changeSpeed(e.deltaY < 0 ? 1 : -1);
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.game) return;
    const free = this.world?.free ?? null;
    if (free) {
      const move = MOVE_KEYS[e.code];
      if (move) {
        free.setKey(move, true);
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        this.dropRiderHere(free);
        return;
      }
    }
    const demo = this.trainer instanceof DemoTrainer ? this.trainer : null;
    const step = e.shiftKey ? 50 : 10;
    switch (e.key) {
      case 'ArrowUp':
        demo?.adjust(step);
        break;
      case 'ArrowDown':
        demo?.adjust(-step);
        break;
      case 'p':
      case 'P':
        this.game.togglePause();
        break;
      case 'v':
      case 'V':
        if (this.world) this.world.cameraMode = this.world.cameraMode === 'poursuite' ? 'embarquée' : 'poursuite';
        break;
      case 'f':
      case 'F':
        if (demo) this.toggleFreeCamera();
        break;
      case 'PageUp':
        if (demo) {
          e.preventDefault();
          this.game.jumpTo(this.game.distanceM + JUMP_M);
        }
        break;
      case 'PageDown':
        if (demo) {
          e.preventDefault();
          this.game.jumpTo(this.game.distanceM - JUMP_M);
        }
        break;
      case 'Escape':
        void this.quit();
        break;
    }
  };

  private showResult(name: string, s: RideSummary): void {
    const screen = document.createElement('div');
    screen.className = 'screen over';
    const segs = s.results
      .map((r) => {
        const detail = r.isNewPr
          ? `<span class="pr">Nouveau record</span>`
          : `<span>record ${formatTime(r.previousPrS ?? 0)}</span>`;
        return `<div class="result-seg"><span>${r.def.name}</span><span>${formatTime(r.timeS)} · ${detail}</span></div>`;
      })
      .join('');
    screen.innerHTML = `<div class="result">
      <h2>${name}</h2>
      <div class="result-grid">
        <div><b>${formatTime(s.elapsedS)}</b>Temps</div>
        <div><b>${fr(s.distanceKm)} km</b>Distance</div>
        <div><b>${fr(s.avgSpeedKmh)} km/h</b>Vitesse moyenne</div>
        <div><b>${Math.round(s.avgPowerW)} W</b>Puissance moyenne</div>
      </div>
      ${segs}
      <button class="btn primary" data-a="menu">Retour au menu</button>
    </div>`;
    this.root.appendChild(screen);
    screen.querySelector('[data-a="menu"]')!.addEventListener('click', () => void this.quit());
  }

  private async quit(): Promise<void> {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.route = null;
    this.hud = null;
    this.game?.stop();
    this.world?.dispose();
    this.game = null;
    this.world = null;
    if (this.trainer instanceof DemoTrainer) {
      await this.trainer.disconnect();
      this.trainer = null;
    }
    // Le contexte WebGL ne se réutilise pas proprement : un canvas neuf évite tout état résiduel.
    const fresh = this.canvas.cloneNode() as HTMLCanvasElement;
    this.canvas.replaceWith(fresh);
    this.canvas = fresh;
    await this.showMenu();
  }
}

void new App().showMenu();
