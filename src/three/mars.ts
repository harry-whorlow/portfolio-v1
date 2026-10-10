import fullMeta from './data/mars.json';
import fullUrl from './data/mars-4096x2048.bin.gz?url';
import liteMeta from './data/mars-2048x1024-5m.json';
import liteUrl from './data/mars-2048x1024-5m.bin.gz?url';
import scene from './scenes/mars.json';
import { createPlanet, type PlanetOptions, type SceneState } from './planet';

export const createMars = (canvas: HTMLCanvasElement, options?: PlanetOptions) =>
  createPlanet(
    canvas,
    {
      name: 'mars',
      exaggeration: 4,
      contourIntervalKm: 0.5,
      lite: { meta: liteMeta, url: liteUrl },
      full: { meta: fullMeta, url: fullUrl },
    },
    { scene: scene as SceneState, ...options }
  );
