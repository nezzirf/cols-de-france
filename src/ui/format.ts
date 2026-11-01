export const fr = (v: number, digits = 1): string => v.toFixed(digits).replace('.', ',');

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function esc(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Durée d'un bloc : « 8:30 », ou « 1 h 05 » au-delà d'une heure. */
export function duration(totalS: number): string {
  const s = Math.round(totalS);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${String(m).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
