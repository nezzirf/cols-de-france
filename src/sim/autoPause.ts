// Pause automatique : quand le cycliste s'arrête vraiment, le chrono et l'enregistrement s'arrêtent aussi.

/** Temps à l'arrêt avant que la pause ne se déclenche. */
export const AUTO_PAUSE_AFTER_S = 3;
/** En dessous, sans pédaler, le vélo est considéré à l'arrêt : à moins de 5 km/h, on ne roule plus vraiment (m/s). */
export const STOPPED_SPEED_MPS = 1.4;

export type AutoPauseChange = 'pause' | 'resume' | null;

export class AutoPause {
  private idleS = 0;
  paused = false;

  /**
   * `pedalling` : on pédale ou on produit de la puissance ; `rolling` : le vélo avance encore, par exemple en descente.
   * La reprise se fait dès le premier coup de pédale, pas à l'élan.
   */
  update(dt: number, pedalling: boolean, rolling: boolean): AutoPauseChange {
    if (pedalling) {
      this.idleS = 0;
      if (!this.paused) return null;
      this.paused = false;
      return 'resume';
    }
    if (this.paused) return null;
    this.idleS = rolling ? 0 : this.idleS + dt;
    if (this.idleS < AUTO_PAUSE_AFTER_S) return null;
    this.paused = true;
    return 'pause';
  }

  reset(): void {
    this.idleS = 0;
    this.paused = false;
  }
}
