// Pas de décor : quand on roule devant un écran, le jeu ne dessine rien et ne fait que suivre la séance.

import type { GameWorld } from '../app/game';
import type { RouteEvent } from './landmarks';

export class NoWorld implements GameWorld {
  readonly events: RouteEvent[] = [];
  onBiomeChange: (label: string) => void = () => {};

  render(): void {}
}
