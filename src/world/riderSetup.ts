// Habille le modèle du cycliste selon le vélo et le maillot choisis.

import type { Bike } from '../sim/bikes';
import { lacquer, pbr, textile } from './materials';
import { createRiderModel, type RiderLook, type RiderModel } from './rider';
import { fabricTexture } from './riderTextures';

export function bikeShape(bike: Bike): RiderLook {
  return { shape: bike.shape, tyreM: bike.tyreM, wheelRadiusM: bike.wheelRadiusM, design: bike.design };
}

export function dressedRider(bike: Bike): RiderModel {
  const fabric = fabricTexture();
  return createRiderModel(
    textile({ color: bike.jersey, bumpMap: fabric, bumpScale: 1.4 }),
    textile({ color: 0x16181c, roughness: 0.55, bumpMap: fabric, bumpScale: 1 }),
    {
      ...bikeShape(bike),
      frame: lacquer({ color: bike.frame }),
      paint: lacquer({ color: bike.accent }),
      accent: pbr({ color: bike.accent, roughness: 0.34 }),
      brand: bike.brand ?? undefined,
    },
  );
}
