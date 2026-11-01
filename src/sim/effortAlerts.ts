// Alertes d'effort : un message discret quand le rythme risque de coûter cher plus loin.

const POWER_WINDOW_S = 120;
const OVER_FTP = 1.1;
const LOW_CADENCE_RPM = 60;
const LOW_CADENCE_AFTER_S = 20;
/** Un même message ne revient pas avant ce délai. */
const COOLDOWN_S = 300;

export interface AlertInput {
  powerW: number;
  cadenceRpm: number;
}

export class EffortAlerts {
  private powers: number[] = [];
  private sum = 0;
  private lowCadenceS = 0;
  private quietUntil = { power: 0, cadence: 0 };
  private clockS = 0;

  /**
   * À appeler une fois par seconde de sortie. Pendant une séance guidée, les efforts au-dessus de la FTP
   * sont voulus : seule la cadence est surveillée.
   */
  update(input: AlertInput, ftp: number, guided: boolean): string | null {
    this.clockS++;
    this.powers.push(input.powerW);
    this.sum += input.powerW;
    if (this.powers.length > POWER_WINDOW_S) this.sum -= this.powers.shift()!;

    this.lowCadenceS = input.cadenceRpm > 0 && input.cadenceRpm < LOW_CADENCE_RPM && input.powerW > 0 ? this.lowCadenceS + 1 : 0;

    if (!guided && ftp > 0 && this.powers.length === POWER_WINDOW_S && this.sum / POWER_WINDOW_S > ftp * OVER_FTP && this.clockS >= this.quietUntil.power) {
      this.quietUntil.power = this.clockS + COOLDOWN_S;
      return 'Au-dessus de ta FTP depuis 2 minutes : lève le pied si la montée est encore longue';
    }
    if (this.lowCadenceS >= LOW_CADENCE_AFTER_S && this.clockS >= this.quietUntil.cadence) {
      this.quietUntil.cadence = this.clockS + COOLDOWN_S;
      return 'Cadence basse : passe un rapport plus léger pour ménager les genoux';
    }
    return null;
  }
}
