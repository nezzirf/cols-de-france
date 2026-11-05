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
  const { livery } = bike;
  return createRiderModel(
    textile({ color: bike.jersey, bumpMap: fabric, bumpScale: 1.4 }),
    textile({ color: livery.shorts, roughness: 0.55, bumpMap: fabric, bumpScale: 1 }),
    {
      ...bikeShape(bike),
      frame: lacquer({ color: bike.frame }),
      coat: bike.coat,
      paint: lacquer({ color: bike.accent }),
      accent: pbr({ color: livery.trim, roughness: 0.34 }),
      helmet: pbr({ color: livery.helmet, roughness: 0.34 }),
      livery,
      brand: bike.brand ?? undefined,
    },
  );
}
