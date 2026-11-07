import fs from 'node:fs';
import path from 'node:path';
import type { Span } from '../../src/sim/structures';

/** Les tronçons enregistrés d'un parcours et la longueur de son tracé complet, lus dans public/data. */
export function loadRouteFile(id: string): { tunnels: Span[]; bridges: Span[]; pathM: number } {
  const dir = path.resolve(__dirname, '../../public/data', id);
  const structures = JSON.parse(fs.readFileSync(path.join(dir, 'structures.json'), 'utf8')) as { tunnels: Span[]; bridges: Span[] };
  const route = JSON.parse(fs.readFileSync(path.join(dir, 'route.json'), 'utf8')) as { x: number[]; stepM: number };
  return { ...structures, pathM: (route.x.length - 1) * route.stepM };
}
