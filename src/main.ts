// Point d'entrée : menu, appairage du matériel, lancement et fin de sortie.

import { Game, type RideSummary } from './app/game';
import { type AppOptions, CUSTOM_ROUTE_ID, loadProfile, saveProfile } from './app/profile';
import { keepAwake, openFloatingBar, startCapture } from './app/castSource';
import { clearInProgress, loadInProgress, type SavedRide, saveInProgress } from './app/rideAutosave';
import { addRide, type HistoryEntry, loadHistory, loadSamples, personalBests, referenceRide } from './app/rideHistory';
import { summaryFromSamples } from './app/rideSummary';
import { preloadBikeAsset } from './world/bikeAsset';
import { preloadRiderAsset } from './world/riderAsset';
import { DemoTrainer } from './hardware/demoTrainer';
import { BluetoothHeartRate } from './hardware/heartRate';
import { KickrAnt } from './hardware/antUsb';
import { KickrBluetooth } from './hardware/kickrBluetooth';
import { ActionGate, type ShiftDirection, ShiftGate, type ZwiftAction, ZwiftPlay } from './hardware/zwiftPlay';
import type { HeartRateSensor, Trainer } from './hardware/types';
import { formatTime, Hud } from './hud/hud';
import './hud/hud.css';
import { MiniHud } from './hud/miniHud';
import { PillHud } from './hud/pillHud';
import { findBike, setupFor, wearing, type Bike } from './sim/bikes';
import type { GroupOptions } from './sim/group';
import { buildCustomRoute } from './sim/customRoute';
import { loadRoute, Route } from './sim/route';
import { buildSalonRoute } from './sim/salonRoute';
import { buildWorldRoute, WORLD_ROUTE_ID } from './sim/worldRoute';
import { expandBlocks, type Workout } from './sim/workout';
import { fr } from './ui/format';
import { type DeviceKind, Menu } from './ui/menu';
import { showRecap } from './ui/recap';
import { paintCustomGround } from './world/customGround';
import { paintWorldGround } from './world/worldGround';
import { type FreeCamera, MOVE_KEYS } from './world/freeCamera';
import { NoWorld } from './world/noWorld';
import { World } from './world/scene';
import { momentAtHour } from './world/ambiance';
import { Soundscape } from './world/soundscape';

const DEMO_HINT = '↑ ↓ puissance · Maj : ±50 W · L verrouiller les watts · M son · + − vitesses · F caméra libre · Pg↑ Pg↓ ±1 km · P pause · V caméra · Échap quitter';
const FREE_HINT = 'ZQSD déplacer · clic + souris regarder · A E descendre, monter · Maj vite · molette vitesse · T poser le cycliste ici · F sortir';
const JUMP_M = 1000;
const EXPLORE_REFRESH_MS = 150;
const MINI_REFRESH_MS = 250;
const FLOATING_BAR = { width: 980, height: 96 };

class App {
  private root = document.getElementById('app')!;
  private canvas = document.getElementById('view') as HTMLCanvasElement;
  private profile = loadProfile();
  private trainer: Trainer | null = null;
  private trainerKind: DeviceKind | null = null;
  private hr: HeartRateSensor | null = null;
  private play: ZwiftPlay[] = [];
  private shiftGate = new ShiftGate();
  private actionGate = new ActionGate();
  private menu: Menu | null = null;
  private game: Game | null = null;
  private world: World | null = null;
  private bpmBeforeStart: number | null = null;
  private route: Route | null = null;
  private hud: Hud | null = null;
  private mini: MiniHud | PillHud | null = null;
  private miniTimer = 0;
  private sound: Soundscape | null = null;
  private endButton: HTMLButtonElement | null = null;
  private cast: MediaStream | null = null;
  private pip: Window | null = null;
  private releaseLock: (() => void) | null = null;
  private lastExplore = 0;
  private looking = false;
  /** Ce qu'il faut savoir de la sortie en cours pour la sauvegarder, la reprendre et l'inscrire à l'historique. */
  private rideInfo: { routeId: string | null; name: string; workout: Workout | null } | null = null;

  async showMenu(): Promise<void> {
    this.menu = new Menu(this.root, {
      profile: this.profile,
      saveProfile: () => saveProfile(this.profile),
      connect: (kind) => this.connect(kind),
      isConnected: (kind) => {
        if (kind === 'play') return this.play.length > 0;
        return kind === 'hr' ? this.hr !== null : this.trainerKind === kind;
      },
      start: (routeId, workout, app, group) => (app ? this.startAppRide(workout, app) : this.startRide(routeId, workout, null, group)),
      pendingRide: () => loadInProgress(),
      resumeRide: () => this.resumeRide(),
      finishPendingRide: () => this.finishPendingRide(),
      discardPendingRide: () => clearInProgress(),
      openRide: (entry) => this.openPastRide(entry),
    });
    const bikeLoading = Promise.all([preloadBikeAsset(), preloadRiderAsset()]);
    await this.menu.show();
    // Le vélo modélisé arrive après le menu : l'aperçu se refait dès qu'il est là.
    void bikeLoading.then(() => this.menu?.refreshPreview());
  }

  private get bike(): Bike {
    return wearing(findBike(this.profile.bikeId), this.profile.jerseyId);
  }

  private async connect(kind: DeviceKind): Promise<string> {
    try {
      if (kind === 'hr') return await this.connectHeartRate();
      if (kind === 'play') return await this.connectZwiftPlay();
      await this.trainer?.disconnect();
      this.trainer = null;
      this.trainerKind = null;
      const trainer =
        kind === 'ble'
          ? new KickrBluetooth(() => this.profile.riderKg + this.bike.kg)
          : new KickrAnt(() => ({ riderKg: this.profile.riderKg, bikeKg: this.bike.kg, wheelRadiusM: this.bike.wheelRadiusM }));
      await trainer.connect();
      this.trainer = trainer;
      this.trainerKind = kind;
      return `${trainer.label} connecté (${trainer.protocol}).`;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'NotFoundError') return 'Aucun appareil choisi.';
      throw err;
    }
  }

  private async connectHeartRate(): Promise<string> {
    await this.hr?.disconnect();
    this.hr = null;
    const sensor = new BluetoothHeartRate();
    sensor.onBpm = (bpm) => {
      this.bpmBeforeStart = bpm;
      this.game?.receiveHeartRate(bpm);
    };
    await sensor.connect();
    this.hr = sensor;
    return 'Ceinture cardio connectée.';
  }

  private async connectZwiftPlay(): Promise<string> {
    const play = new ZwiftPlay();
    play.onShift = (direction) => this.onShift(direction);
    play.onAction = (action) => this.onZwiftAction(action);
    if (!(await play.connect(this.play.map((p) => p.deviceId)))) {
      return 'Cette manette est déjà connectée. Appuie sur l’autre pour la réveiller, puis reclique sur Zwift Play.';
    }
    this.play.push(play);
    this.game?.enableGears();
    return this.play.length === 1
      ? 'Manette connectée : appuie sur un bouton de vitesse. Si l’autre manette apparaît à part, reclique sur Zwift Play.'
      : 'Deuxième manette connectée : appuie sur un bouton de vitesse pour vérifier.';
  }

  private onShift(direction: ShiftDirection): void {
    if (!this.shiftGate.pass(direction, performance.now())) return;
    if (this.game) this.game.shift(direction === 'up' ? 1 : -1);
    else this.menu?.say(`Bouton reçu : vitesse ${direction === 'up' ? 'supérieure' : 'inférieure'}.`);
  }

  /** Y verrouille les watts, les flèches haut et bas les règlent d'un watt ; seulement pendant une sortie. */
  private onZwiftAction(action: ZwiftAction): void {
    if (!this.game || !this.actionGate.pass(action, performance.now())) return;
    this.lockAction(action === 'lock' ? 'toggle' : action === 'powerUp' ? 'up' : 'down');
  }

  private lockAction(action: 'toggle' | 'up' | 'down'): void {
    if (action === 'toggle') this.game?.toggleLock();
    else this.game?.adjustLock(action === 'up' ? 1 : -1);
  }

  private async loadTrack(routeId: string) {
    if (routeId === WORLD_ROUTE_ID) {
      const { route, heights } = buildWorldRoute();
      return { route, heights, buildings: [], ortho: paintWorldGround(route.data.terrain, heights, route.data.world!) };
    }
    if (routeId !== CUSTOM_ROUTE_ID) return loadRoute(routeId);
    const { customKm: climbKm, customGrade: gradePct } = this.profile;
    const { route, heights } = buildCustomRoute({ climbKm, gradePct });
    return { route, heights, buildings: [], ortho: paintCustomGround(route.data.terrain) };
  }

  /** Reprend la sortie interrompue : même parcours, même séance, chrono et points là où ils s'étaient arrêtés. */
  private async resumeRide(): Promise<void> {
    const saved = loadInProgress();
    if (!saved) throw new Error('La sortie à reprendre est introuvable.');
    if (saved.routeId === null) await this.startAppRide(saved.workout, { mode: this.profile.appMode, bars: this.profile.appBars }, saved);
    else await this.startRide(saved.routeId, saved.workout, saved);
  }

  /** Affiche un récap sans passer par le jeu : on quitte le menu et on y revient depuis l'écran. */
  private showStandaloneRecap(options: Parameters<typeof showRecap>[1]): void {
    this.menu?.close();
    this.menu = null;
    this.root.innerHTML = '';
    showRecap(this.root, options);
  }

  private finishPendingRide(): void {
    const saved = loadInProgress();
    if (!saved) return;
    const summary = summaryFromSamples(saved.samples, this.profile.ftp, saved.state.startedAt);
    const before = personalBests(loadHistory());
    addRide({ name: saved.name, routeId: saved.routeId, startedAt: summary.startedAt, elapsedS: summary.elapsedS, distanceKm: summary.distanceKm, samples: summary.samples, stats: summary.stats });
    clearInProgress();
    this.showStandaloneRecap({
      name: saved.name,
      summary,
      ftp: this.profile.ftp,
      previousBests: before,
      onApplyFtp: (ftp) => this.applyFtp(ftp),
      onMenu: () => void this.showMenu(),
    });
  }

  private openPastRide(entry: HistoryEntry): void {
    const samples = loadSamples(entry.id);
    if (!samples) {
      this.menu?.say('Le détail de cette sortie n’est plus gardé.', true);
      return;
    }
    this.showStandaloneRecap({
      name: entry.name,
      summary: summaryFromSamples(samples, this.profile.ftp, entry.id),
      ftp: this.profile.ftp,
      previousBests: personalBests(loadHistory(), entry.id),
      onApplyFtp: (ftp) => this.applyFtp(ftp),
      onMenu: () => void this.showMenu(),
    });
  }

  private applyFtp(ftp: number): void {
    this.profile.ftp = ftp;
    saveProfile(this.profile);
  }

  /** Enregistre l'état de la sortie toutes les 30 secondes, pour la reprendre après une coupure. */
  private autosave(game: Game): void {
    game.onCheckpoint = (state, samples) => {
      if (this.rideInfo) saveInProgress({ ...this.rideInfo, state, samples, savedAt: Date.now() });
    };
  }

  private async startRide(routeId: string, workout: Workout | null, resume: SavedRide | null = null, group: GroupOptions | null = null): Promise<void> {
    const { route, heights, buildings, ortho } = await this.loadTrack(routeId);

    const demo = this.trainer === null;
    if (demo) {
      this.trainer = new DemoTrainer();
      await this.trainer.connect();
    }
    const trainer = this.trainer!;

    this.world = new World(this.canvas, route, heights, buildings, this.bike, ortho, { weather: this.profile.weather, moment: this.profile.moment });
    // Sons d'ambiance : ils démarrent avec la sortie (le clic sur « Rouler » autorise le son) et suivent le milieu traversé.
    this.sound?.dispose();
    this.sound = null;
    if (this.profile.sound && typeof AudioContext !== 'undefined') {
      try {
        this.sound = new Soundscape({
          moment: this.profile.moment === 'reel' ? momentAtHour(new Date().getHours()) : this.profile.moment,
          weather: this.profile.weather === 'variable' ? 'degage' : this.profile.weather,
        });
        this.world.sound = this.sound;
      } catch {
        this.sound = null;
      }
    }
    const steps = workout ? expandBlocks(workout.blocks) : null;
    const game = new Game(route, this.world, trainer, setupFor(this.bike, this.profile.riderKg), this.bike.shape, steps, this.profile.ftp);
    game.difficulty = this.profile.difficulty / 100;
    this.game = game;
    this.rideInfo = { routeId, name: workout?.name ?? route.data.name, workout };
    this.autosave(game);
    // Courir contre soi-même : la meilleure sortie déjà faite sur ce parcours, s'il ne boucle pas.
    if (this.profile.ghost && !route.data.loop) game.setReference(referenceRide(routeId, 1));
    if (this.bpmBeforeStart !== null) game.receiveHeartRate(this.bpmBeforeStart);
    if (this.play.length > 0) game.enableGears();

    this.root.innerHTML = '';
    const hud = new Hud(this.root, route);
    hud.onLock = (a) => this.lockAction(a);
    hud.setLockAvailable(!steps);
    if (steps) hud.showWorkout(steps);
    hud.setConnection(trainer.label, trainer.state);
    trainer.onState = (state) => hud.setConnection(trainer.label, state);
    this.route = route;
    this.hud = hud;
    hud.setHint(demo ? DEMO_HINT : '+ − vitesses · L verrouiller les watts · M son · P pause · V caméra · Échap quitter');
    if (demo) {
      hud.enableExplore((d) => game.jumpTo(d));
      this.canvas.addEventListener('pointerdown', this.onPointerDown);
      this.canvas.addEventListener('pointermove', this.onPointerMove);
      this.canvas.addEventListener('pointerup', this.onPointerUp);
      this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
    }
    const intro = route.data.world
      ? `${route.data.name} · boucle de ${fr(route.data.climb.lengthKm, 0)} km, de la plage au désert, à répéter sans fin`
      : `${route.data.name} · ${fr(route.data.footM / 1000)} km d'approche avant le pied du col`;
    const bots = resume ? [] : this.profile.bots;
    const botNote = bots.length > 0 ? ` · ${bots.length} fantôme${bots.length > 1 ? 's' : ''} : ${bots.map((w) => fr(w)).join(' · ')} W/kg` : '';
    hud.toast((workout ? `${workout.name} · ${route.data.name}` : intro) + botNote);

    game.onFrame = (s) => {
      hud.update(s, performance.now());
      this.sound?.setSpeed(s.speedKmh / 3.6);
      this.sound?.setPaused(s.paused);
      if (demo) this.refreshExplore(s.distanceM);
    };
    game.onToast = (t) => hud.toast(t);
    game.onSegmentDone = (r) =>
      hud.toast(`${r.def.name} : ${formatTime(r.timeS)}${r.isNewPr ? ' · nouveau record' : ''}`, true);
    game.onTrainerError = (m) => hud.toast(`Home trainer : ${m}`);
    game.onFinish = (s) => this.showResult(workout?.name ?? route.data.name, s);
    if (resume) game.restore(resume.state, resume.samples);
    // Un groupe choisi dans l'onglet Peloton ; à défaut, les quatre coéquipiers de l'option du menu. La reprise ne les retrouve pas.
    if (group && !resume) game.enableGroup(group);
    else if (this.profile.peloton && !steps) game.enablePeloton();
    game.enableBots(bots);

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.releaseLock = keepAwake();
    game.start();
    this.addEndButton();
    if (import.meta.env.DEV) {
      (window as unknown as { __game: Game }).__game = game;
      (window as unknown as { __sound: Soundscape | null }).__sound = this.sound;
    }
  }

  /**
   * Sortie devant un écran : pas de décor, seulement des barres. L'image vient d'une application
   * capturée dans la page, ou bien la barre flotte seule par-dessus l'application.
   */
  private async startAppRide(workout: Workout | null, app: AppOptions, resume: SavedRide | null = null): Promise<void> {
    // Capture et fenêtre flottante exigent un geste récent du joueur : on les demande avant tout le reste.
    let stream: MediaStream | null = null;
    let pip: Window | null = null;
    let pill: PillHud | null = null;
    if (app.mode === 'partage') {
      // Rien à demander : le système place le jeu à côté de l'application.
    } else if (app.mode === 'pastille') {
      pill = new PillHud(workout ? expandBlocks(workout.blocks) : null);
      try {
        await pill.open();
      } catch (err) {
        pill.dispose();
        throw new Error(`La pastille n'a pas pu s'ouvrir (${err instanceof Error ? err.message : err}). Essaie « Écran partagé ».`);
      }
    } else if (app.mode === 'capture') {
      const fake = import.meta.env.DEV ? (window as unknown as { __fakeCast?: () => MediaStream }).__fakeCast : undefined;
      stream = fake ? fake() : await startCapture();
    } else {
      pip = await openFloatingBar(FLOATING_BAR.width, FLOATING_BAR.height);
    }

    const demo = this.trainer === null;
    if (demo) {
      this.trainer = new DemoTrainer();
      await this.trainer.connect();
    }
    const trainer = this.trainer!;
    const route = buildSalonRoute();
    const steps = workout ? expandBlocks(workout.blocks) : null;
    const game = new Game(route, new NoWorld(), trainer, setupFor(this.bike, this.profile.riderKg), this.bike.shape, steps, this.profile.ftp);
    game.difficulty = this.profile.difficulty / 100;
    this.game = game;
    this.route = route;
    this.rideInfo = { routeId: null, name: workout?.name ?? 'Sortie libre', workout };
    this.autosave(game);
    if (this.bpmBeforeStart !== null) game.receiveHeartRate(this.bpmBeforeStart);
    if (this.play.length > 0) game.enableGears();

    this.canvas.style.display = 'none';
    this.root.innerHTML = '';
    let mini: MiniHud | PillHud;
    if (app.mode === 'partage') {
      mini = new MiniHud(this.root, { placement: 'haut', steps, split: { onStop: () => this.game?.end() } });
    } else if (pill) {
      mini = pill;
      this.root.innerHTML = `<div class="screen"><div class="result">
        <h2>Pastille active</h2>
        <p>${workout ? `Ta séance « ${workout.name} » suit son cours` : 'Ta sortie suit son cours'} dans la petite fenêtre. Ouvre Netflix en plein écran : la pastille reste par-dessus, tu la déplaces et la agrandis avec les doigts.</p>
        <button class="btn" data-a="reopen" hidden>Rouvrir la pastille</button>
        <button class="btn primary" data-a="stop">Terminer la sortie</button>
      </div></div>`;
      const reopen = this.root.querySelector('[data-a="reopen"]') as HTMLButtonElement;
      reopen.addEventListener('click', () => void pill!.open().then(() => (reopen.hidden = true), () => {}));
      this.root.querySelector('[data-a="stop"]')!.addEventListener('click', () => this.game?.end());
      // Fermer la pastille ne coupe pas la sortie : un bouton permet de la rouvrir.
      pill.onClosed = () => (reopen.hidden = false);
    } else if (pip) {
      mini = new MiniHud(pip.document.body, { placement: 'haut', steps, floating: true });
      this.pip = pip;
      this.root.innerHTML = `<div class="screen"><div class="result">
        <h2>Barre flottante active</h2>
        <p>${workout ? `Ta séance « ${workout.name} » suit son cours` : 'Ta sortie suit son cours'} dans la petite fenêtre. Ouvre ton application en plein écran et glisse la barre en haut ou en bas de l'écran.</p>
        <button class="btn primary" data-a="stop">Terminer la sortie</button>
      </div></div>`;
      this.root.querySelector('[data-a="stop"]')!.addEventListener('click', () => this.game?.end());
      pip.addEventListener('keydown', this.onKey);
      // Fermer la barre met fin à la sortie, comme Échap.
      pip.addEventListener('pagehide', () => {
        if (this.pip) void this.quit();
      });
    } else {
      const bars = new MiniHud(this.root, { placement: app.bars, steps });
      mini = bars;
      const video = document.createElement('video');
      video.className = 'mini-video';
      // Le son de l'onglet capturé, s'il a été partagé, passe par le jeu : la diffusion sur une télé l'emporte avec l'image.
      video.muted = !stream?.getAudioTracks().length;
      video.autoplay = true;
      video.playsInline = true;
      video.srcObject = stream;
      bars.stage!.appendChild(video);
      this.cast = stream;
      stream!.getVideoTracks()[0]?.addEventListener('ended', () => {
        video.remove();
        bars.say("Le partage est arrêté. Termine la sortie avec Échap, ou relance-la pour choisir une autre application.");
      });
      void video.play().catch(() => {});
    }
    this.mini = mini;
    mini.setConnection(trainer.label, trainer.state);
    trainer.onState = (state) => mini.setConnection(trainer.label, state);

    game.onToast = (t) => mini.toast(t);
    game.onSegmentDone = (r) => mini.toast(`${r.def.name} : ${formatTime(r.timeS)}`);
    game.onTrainerError = (m) => mini.toast(`Home trainer : ${m}`);
    game.onFinish = (s) => {
      mini.toast('Séance terminée');
      this.showResult(workout?.name ?? 'Sortie libre', s);
    };
    // Le rafraîchissement ne suit pas l'écran : si le jeu passe au second plan, la barre doit continuer.
    this.miniTimer = window.setInterval(() => mini.update(game.currentSnapshot(), performance.now()), MINI_REFRESH_MS);

    if (resume) game.restore(resume.state, resume.samples);
    window.addEventListener('keydown', this.onKey);
    this.releaseLock = keepAwake();
    game.start();
    // L'écran partagé et la barre flottante ont déjà leur bouton ; avec la capture, il se pose sur la page.
    if (app.mode === 'capture') this.addEndButton();
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
    const locked = this.game.lockedPowerW !== null;
    switch (e.key) {
      case 'ArrowUp':
        // Watts verrouillés : la flèche règle le verrou, d'un watt (cinq avec Maj) ; sinon, la puissance du mode démo.
        if (locked) this.game.adjustLock(e.shiftKey ? 5 : 1);
        else demo?.adjust(step);
        break;
      case 'ArrowDown':
        if (locked) this.game.adjustLock(e.shiftKey ? -5 : -1);
        else demo?.adjust(-step);
        break;
      case 'l':
      case 'L':
        this.game.toggleLock();
        break;
      case 'm':
      case 'M':
        if (this.sound) this.hud?.toast(this.sound.toggleMute() ? 'Son coupé' : 'Son rétabli');
        break;
      case '+':
        this.game.shift(1);
        break;
      case '-':
        this.game.shift(-1);
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

  /**
   * Bouton pour finir la sortie : un premier appui demande confirmation, le second termine et ouvre le récap.
   * Il évite qu'un appui involontaire, sur une tablette surtout, mette fin à la séance.
   */
  private addEndButton(): void {
    const label = 'Terminer la séance';
    const button = document.createElement('button');
    button.className = 'end-ride';
    button.textContent = label;
    let timer = 0;
    button.addEventListener('click', () => {
      if (button.dataset.confirm !== 'true') {
        button.dataset.confirm = 'true';
        button.textContent = 'Appuie encore pour terminer';
        timer = window.setTimeout(() => {
          delete button.dataset.confirm;
          button.textContent = label;
        }, 3000);
        return;
      }
      clearTimeout(timer);
      this.game?.end();
    });
    this.root.appendChild(button);
    this.endButton = button;
  }

  private showResult(name: string, s: RideSummary): void {
    this.sound?.dispose();
    this.sound = null;
    this.endButton?.remove();
    this.endButton = null;
    // La sortie entre dans l'historique et n'est plus « interrompue » : le récap compare aux records d'avant.
    const before = personalBests(loadHistory());
    addRide({ name, routeId: this.rideInfo?.routeId ?? null, startedAt: s.startedAt, elapsedS: s.elapsedS, distanceKm: s.distanceKm, samples: s.samples, stats: s.stats });
    clearInProgress();
    this.rideInfo = null;
    showRecap(this.root, {
      name,
      summary: s,
      ftp: this.profile.ftp,
      previousBests: before,
      onApplyFtp: (ftp) => this.applyFtp(ftp),
      onMenu: () => void this.quit(),
    });
  }

  private async quit(): Promise<void> {
    this.sound?.dispose();
    this.sound = null;
    this.endButton?.remove();
    this.endButton = null;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.route = null;
    this.hud = null;
    clearInterval(this.miniTimer);
    this.mini?.dispose();
    this.mini = null;
    this.cast?.getTracks().forEach((t) => t.stop());
    this.cast = null;
    const pip = this.pip;
    this.pip = null;
    pip?.close();
    this.releaseLock?.();
    this.releaseLock = null;
    this.canvas.style.display = '';
    // Quitter avant la fin garde la sortie : le menu proposera de la reprendre.
    this.game?.saveNow();
    this.rideInfo = null;
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
