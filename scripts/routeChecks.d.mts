export function findBacktracks(route: {
  x: number[];
  z: number[];
  ele: number[];
  stepM: number;
}): { fromM: number; toM: number }[];

export function findDetours(route: { x: number[]; z: number[]; ele: number[]; stepM: number }): { fromM: number; toM: number }[];
