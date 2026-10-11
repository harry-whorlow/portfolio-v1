import fullMeta from './data/moon.json';
import fullUrl from './data/moon-4096x2048.bin.gz?url';
import liteMeta from './data/moon-2048x1024-5m.json';
import liteUrl from './data/moon-2048x1024-5m.bin.gz?url';
import colorUrl from './data/moon-color-2048x1024.jpg?url';
import { createEarth } from './earth';
import { createPlanet, type PlanetOptions } from './planet';

export const createMoon = (canvas: HTMLCanvasElement, options?: PlanetOptions) =>
  createPlanet(
    canvas,
    {
      name: 'moon',
      exaggeration: 6,
      contourIntervalKm: 0.25,
      lite: { meta: liteMeta, url: liteUrl },
      full: { meta: fullMeta, url: fullUrl },
      colorUrl,
    },
    { material: true, backdrop: createEarth, ...options }
  );
