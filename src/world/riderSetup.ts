// Habille le modèle du cycliste selon le vélo et le maillot choisis.

import type { Bike } from '../sim/bikes';
import { pbr } from './materials';
import { createRiderModel, type RiderLook, type RiderModel } from './rider';
import { fabricTexture } from './riderTextures';

export function bikeShape(bike: Bike): RiderLook {
  return { shape: bike.shape, tyreM: bike.tyreM, wheelRadiusM: bike.wheelRadiusM, design: bike.design };
}

export function dressedRider(bike: Bike): RiderModel {
  const fabric = fabricTexture();
  return createRiderModel(
    pbr({ color: bike.jersey, roughness: 0.68, bumpMap: fabric, bumpScale: 1.4 }),
    pbr({ color: 0x16181c, roughness: 0.5, bumpMap: fabric, bumpScale: 1 }),
    {
      ...bikeShape(bike),
      frame: pbr({ color: bike.frame, roughness: 0.28, metalness: 0.2 }),
      paint: pbr({ color: bike.accent, roughness: 0.28, metalness: 0.2 }),
      accent: pbr({ color: bike.accent, roughness: 0.34 }),
      brand: bike.brand ?? undefined,
    },
  );
}
