// Dessin d'une tenue d'équipe : où se place la seconde couleur sur le maillot, les manches, le cuissard et le casque.
// Les couleurs sont indicatives et sans logo ; la couleur de base du maillot reste celle de l'équipe.

/**
 * Motif de la seconde couleur sur le torse. L'ordre est celui lu par le shader du maillot.
 * - band : bande sur la poitrine · hem : bas du maillot · half : moitié basse · fade : dégradé qui monte du bas
 * - diag : bande en diagonale · shoulder : épaule droite · side : flancs · sweep : dégradé d'un côté à l'autre
 * - center : rayures verticales au milieu
 */
export const KIT_STYLES = ['plain', 'band', 'hem', 'half', 'fade', 'diag', 'shoulder', 'side', 'sweep', 'center'] as const;
export type KitStyle = (typeof KIT_STYLES)[number];

export interface Livery {
  style: KitStyle;
  /** Couleur du motif. */
  second: number;
  /** Manche gauche et manche droite (du coureur) ; absentes, elles reprennent la couleur du maillot. */
  sleeveL: number | null;
  sleeveR: number | null;
  shorts: number;
  helmet: number;
  /** Liserés du col, des manches et de la taille. */
  trim: number;
}

const DARK = 0x16181c;

/** Tenue unie : seul le maillot est coloré, le casque et les liserés reprennent l'accent du vélo. */
export function plainLivery(accent: number): Livery {
  return { style: 'plain', second: accent, sleeveL: null, sleeveR: null, shorts: DARK, helmet: accent, trim: accent };
}

/** Raccourci pour écrire une tenue : le motif est la seule partie obligatoire. */
export function livery(style: KitStyle, second: number, rest: Partial<Livery> & { helmet: number; trim: number }): Livery {
  return { style, second, sleeveL: null, sleeveR: null, shorts: DARK, ...rest };
}
