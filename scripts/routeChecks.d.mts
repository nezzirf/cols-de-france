export function findBacktracks(route: {
  x: number[];
  z: number[];
  ele: number[];
  stepM: number;
}): { fromM: number; toM: number }[];
