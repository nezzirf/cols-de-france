import { describe, expect, it } from 'vitest';
import { FreeCamera, MOVE_KEYS } from '../src/world/freeCamera';
import { Route, type RouteData } from '../src/sim/route';

const flat = () => 0;
const cam = (yaw = 0, pitch = 0) => new FreeCamera({ x: 0, y: 10, z: 0 }, yaw, pitch);

describe('caméra libre', () => {
  it('avance dans la direction du regard', () => {
    const c = cam();
    c.setKey('forward', true);
    c.update(1, flat);
    expect(c.z).toBeCloseTo(-25, 6);
    expect(c.x).toBeCloseTo(0, 6);
  });
  it('suit la même convention que la route', () => {
    const c = cam(Math.PI / 2);
    c.setKey('forward', true);
    c.update(1, flat);
    expect(c.x).toBeCloseTo(25, 6);
  });
  it('se décale sur le côté', () => {
    const c = cam();
    c.setKey('right', true);
    c.update(1, flat);
    expect(c.x).toBeCloseTo(25, 6);
  });
  it('monte en regardant vers le haut', () => {
    const c = cam(0, Math.PI / 4);
    c.setKey('forward', true);
    c.update(1, flat);
    expect(c.y).toBeGreaterThan(20);
  });
  it('garde la même vitesse en diagonale', () => {
    const c = cam();
    c.setKey('forward', true);
    c.setKey('right', true);
    c.update(1, flat);
    expect(Math.hypot(c.x, c.z)).toBeCloseTo(25, 6);
  });
  it('accélère avec Maj', () => {
    const c = cam();
    c.setKey('forward', true);
    c.setKey('boost', true);
    c.update(1, flat);
    expect(Math.abs(c.z)).toBeCloseTo(150, 6);
  });
  it('ne passe pas sous le sol', () => {
    const c = cam();
    c.setKey('down', true);
    c.update(10, () => 5);
    expect(c.y).toBeCloseTo(5.6, 6);
  });
  it('ne se retourne pas en regardant trop haut', () => {
    const c = cam();
    c.look(0, -100000);
    expect(c.pitch).toBeLessThan(Math.PI / 2);
  });
  it('borne la vitesse réglée à la molette', () => {
    const c = cam();
    c.changeSpeed(100);
    expect(c.speedMps).toBe(300);
    c.changeSpeed(-100);
    expect(c.speedMps).toBe(3);
  });
  it('s’arrête quand on relâche tout', () => {
    const c = cam();
    c.setKey('forward', true);
    c.releaseAll();
    c.update(1, flat);
    expect(c.z).toBe(0);
  });
  it('utilise les touches physiques, valables en AZERTY', () => {
    expect(MOVE_KEYS.KeyW).toBe('forward');
    expect(MOVE_KEYS.KeyA).toBe('left');
  });
});

describe('position sur le parcours', () => {
  const route = new Route({
    stepM: 10,
    x: [0, 10, 20, 30],
    z: [0, 0, 0, 0],
    ele: [100, 101, 102, 103],
    grade: [10, 10, 10, 10],
    endM: 30,
    origin: { lat: 45, lon: 6 },
  } as RouteData);

  it('trouve le point de route le plus proche, entre deux échantillons', () => {
    const n = route.nearest(14, 5);
    expect(n.distM).toBeCloseTo(14, 6);
    expect(n.offsetM).toBeCloseTo(5, 6);
  });
  it('s’arrête au bout du parcours', () => {
    const n = route.nearest(50, 0);
    expect(n.distM).toBe(30);
    expect(n.offsetM).toBeCloseTo(20, 6);
  });
  it('retrouve l’origine en latitude et longitude', () => {
    expect(route.toLatLon(0, 0)).toEqual({ lat: 45, lon: 6 });
  });
  it('place le nord vers -Z', () => {
    expect(route.toLatLon(0, -1000).lat).toBeGreaterThan(45);
    expect(route.toLatLon(1000, 0).lon).toBeGreaterThan(6);
  });
});
