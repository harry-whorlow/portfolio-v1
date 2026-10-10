import * as THREE from 'three';
import { createTopoMaterial } from './topo-material';

export interface HeightMeta {
  file: string;
  cols: number;
  rows: number;
  unitsPerKm: number;
  radiusKm: number;
  minKm: number;
  maxKm: number;
}

type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

/** A starting camera and planet pose, as copied with the "Copy scene" button in the solar-heightmap sandbox. */
export interface SceneState {
  distanceKm: number;
  /** Keep the camera where the scene put it instead of easing back to the default framing. */
  freeCam: boolean;
  camera: { position: Vec3; quaternion: Quat };
  planet: { quaternion: Quat };
}

export interface PlanetBody {
  /** Also the query param that forces a quality, e.g. `?mars=full` or `?moon=lite`. */
  name: string;
  exaggeration: number;
  contourIntervalKm: number;
  lite: { meta: HeightMeta; url: string };
  full: { meta: HeightMeta; url: string };
}

const UPGRADE_MIN_MBPS = 25;
const THROUGHPUT_KEY = 'planet:mbps';

const MESH_COLS = 1024;
const MESH_ROWS = 512;

const CAMERA_HOME = new THREE.Vector3(0, 1.05, 1.4);
const CAMERA_TARGET = new THREE.Vector3(0, 0.95, 0);
const MIN_RADIUS = 1.25;
const MAX_RADIUS = 6;
const RETURN_RATE = 4;
const AUTO_SPIN = 0.02;
const DRAG_SPEED = Math.PI;
const SPIN_DAMPING = 3;
const UPGRADE_FADE_SECONDS = 2;

export interface PlanetOptions {
  heatmap?: boolean;
  distanceKm?: number;
  scene?: SceneState;
}

export interface Planet {
  setHeatmap(enabled: boolean): void;
  setDistance(km: number): void;
  setScroll(progress: number): void;
  /** Resolves once the first heightmap is on screen. */
  ready: Promise<void>;
  dispose(): void;
}

async function fetchBytes(url: string) {
  const response = await fetch(url);
  const bodyStart = performance.now();
  const bytes = new Uint8Array(await response.arrayBuffer());
  const seconds = Math.max((performance.now() - bodyStart) / 1000, 1e-3);
  const timing = performance.getEntriesByName(response.url).at(-1) as PerformanceResourceTiming | undefined;
  const cached = timing?.transferSize === 0;
  return { bytes, cached, mbps: (bytes.length * 8) / seconds / 1e6 };
}

function shouldUpgrade(mbps: number, cached: boolean, qualityOverride: string | null) {
  if (qualityOverride === 'full') return true;
  if (qualityOverride === 'lite') return false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (connection?.saveData || /2g|3g/.test(connection?.effectiveType ?? '')) return false;
  try {
    // A cache hit says nothing about the network, so fall back to the last real measurement.
    if (cached) mbps = Number(localStorage.getItem(THROUGHPUT_KEY) ?? 0);
    else localStorage.setItem(THROUGHPUT_KEY, String(mbps));
  } catch {
    if (cached) return false;
  }
  return mbps >= UPGRADE_MIN_MBPS;
}

function decodeHeights(compressed: Uint8Array<ArrayBuffer>, meta: HeightMeta) {
  return decompress(compressed).then((bytes) => unpackHeights(bytes, meta));
}

async function decompress(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return bytes;
}

function unpackHeights(bytes: Uint8Array, meta: HeightMeta) {
  const count = bytes.length / 2;
  const stride = meta.cols + 1;
  const heights = new Int16Array(count);
  for (let row = 0; row < count; row += stride) {
    let prev = 0;
    for (let i = row; i < row + stride; i++) {
      heights[i] = prev + (bytes[i] | (bytes[count + i] << 8)); // Int16Array wraps the uint16 delta
      prev = heights[i];
    }
  }
  return heights;
}

function createPlanetGeometry(heights: Int16Array, meta: HeightMeta, exaggeration: number) {
  const heightsKm = new Float32Array(meta.cols * (meta.rows + 1));
  for (let r = 0; r <= meta.rows; r++) {
    for (let c = 0; c < meta.cols; c++) {
      heightsKm[r * meta.cols + c] = heights[r * (meta.cols + 1) + c] / meta.unitsPerKm;
    }
  }
  const heightTexture = new THREE.DataTexture(heightsKm, meta.cols, meta.rows + 1, THREE.RedFormat, THREE.FloatType);
  heightTexture.needsUpdate = true;

  const cols = MESH_COLS;
  const rows = MESH_ROWS;
  const count = (cols + 1) * (rows + 1);
  const position = new Float32Array(count * 3);
  const gridUv = new Float32Array(count * 2);

  for (let r = 0; r <= rows; r++) {
    const lat = THREE.MathUtils.degToRad(90 - (r / rows) * 180);
    const dataRow = Math.round((r / rows) * meta.rows);
    for (let c = 0; c <= cols; c++) {
      const lon = THREE.MathUtils.degToRad(-180 + (c / cols) * 360);
      const dataCol = Math.round((c / cols) * meta.cols) % meta.cols;
      const i = r * (cols + 1) + c;
      const scale = 1 + (heightsKm[dataRow * meta.cols + dataCol] / meta.radiusKm) * exaggeration;
      position[i * 3] = Math.cos(lat) * Math.sin(lon) * scale;
      position[i * 3 + 1] = Math.sin(lat) * scale;
      position[i * 3 + 2] = Math.cos(lat) * Math.cos(lon) * scale;
      gridUv[i * 2] = c / cols;
      gridUv[i * 2 + 1] = r / rows;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      if (r > 0) indices.push(a, b, a + 1);
      if (r < rows - 1) indices.push(b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  const positionAttribute = new THREE.BufferAttribute(position, 3);
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('nextPosition', positionAttribute);
  geometry.setAttribute('gridUv', new THREE.BufferAttribute(gridUv, 2));
  return { geometry, heightTexture };
}

export function createPlanet(
  canvas: HTMLCanvasElement,
  body: PlanetBody,
  { heatmap = true, distanceKm = 1300, scene: start }: PlanetOptions = {}
): Planet {
  const { meta: fullMeta, url: fullUrl } = body.full;
  const { meta: liteMeta, url: liteUrl } = body.lite;
  const qualityOverride = new URLSearchParams(location.search).get(body.name);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const gl = renderer.getContext();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const planet = new THREE.Group();
  scene.add(planet);

  const homeDirection = CAMERA_HOME.clone().normalize();
  const homeDistance = CAMERA_HOME.length();
  const homePosition = new THREE.Vector3();
  const homeQuaternion = new THREE.Quaternion();
  const aim = new THREE.Vector3();
  const pose = new THREE.Camera();

  let freeCam = false;
  const setDistance = (km: number) => {
    const distance = THREE.MathUtils.clamp(1 + km / fullMeta.radiusKm, MIN_RADIUS, MAX_RADIUS);
    if (freeCam) {
      homePosition.setLength(distance);
      return;
    }
    const t = THREE.MathUtils.clamp((distance - homeDistance) / (MAX_RADIUS - homeDistance), 0, 1);
    homePosition.copy(homeDirection).multiplyScalar(distance);
    aim.lerpVectors(CAMERA_TARGET, new THREE.Vector3(), t);
    pose.position.copy(homePosition);
    pose.lookAt(aim);
    homeQuaternion.copy(pose.quaternion);
  };
  setDistance(start?.distanceKm ?? distanceKm);
  if (start) {
    freeCam = start.freeCam;
    if (freeCam) {
      homePosition.fromArray(start.camera.position);
      homeQuaternion.fromArray(start.camera.quaternion);
    }
    planet.quaternion.fromArray(start.planet.quaternion);
  }
  camera.position.copy(start ? new THREE.Vector3(...start.camera.position) : homePosition);
  camera.quaternion.copy(start ? new THREE.Quaternion(...start.camera.quaternion) : homeQuaternion);

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let dragPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  let pendingX = 0;
  let pendingY = 0;
  const spin = new THREE.Vector2();
  const dragVelocity = new THREE.Vector2();

  const onPointerDown = (e: PointerEvent) => {
    if (dragPointer !== null || e.button !== 0) return;
    dragPointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    spin.set(0, 0);
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== dragPointer) return;
    pendingX += e.clientX - lastX;
    pendingY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === dragPointer) dragPointer = null;
  };
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // Both heightmaps share the full map's height range so colours and framing don't jump on upgrade.
  const planetRadius = 1 + (fullMeta.maxKm / fullMeta.radiusKm) * body.exaggeration;
  const centerInView = new THREE.Vector3();
  const restPose = new THREE.Quaternion();
  let scrollProgress = 0;
  const scrollTilt = () => {
    if (scrollProgress <= 0) return 0;
    camera.updateMatrixWorld();
    centerInView.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
    const reach = Math.hypot(centerInView.y, centerInView.z);
    if (reach <= planetRadius) return 0;
    const facing = Math.atan2(centerInView.z, centerInView.y);
    const spread = Math.acos(planetRadius / reach);
    const lowestAngle = Math.atan(Math.min(Math.tan(facing + spread), Math.tan(facing - spread)));
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    return scrollProgress * (lowestAngle - halfFov);
  };

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const timer = new THREE.Timer();
  const frame = (time: number) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1);
    const ease = 1 - Math.exp(-RETURN_RATE * dt);
    camera.position.lerp(homePosition, ease);
    camera.quaternion.slerp(homeQuaternion, ease);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);

    if (dragPointer !== null) {
      const scale = DRAG_SPEED / Math.max(canvas.clientHeight, 1);
      if (dt > 0)
        spin.lerp(dragVelocity.set(pendingX * scale, pendingY * scale).divideScalar(dt), 1 - Math.exp(-20 * dt));
      planet.rotateOnWorldAxis(up, pendingX * scale);
      planet.rotateOnWorldAxis(right, pendingY * scale);
    } else {
      spin.multiplyScalar(Math.exp(-SPIN_DAMPING * dt));
      planet.rotateOnWorldAxis(up, spin.x * dt);
      planet.rotateOnWorldAxis(right, (spin.y + AUTO_SPIN) * dt);
    }
    pendingX = 0;
    pendingY = 0;

    mesh?.material.setTime(time / 1000);

    if (upgrade) {
      upgrade.t = Math.min(upgrade.t + dt / UPGRADE_FADE_SECONDS, 1);
      mesh?.material.setBlend(upgrade.t * upgrade.t * (3 - 2 * upgrade.t));
      if (upgrade.t >= 1) finishUpgrade();
    }

    if (scrollProgress >= 1) return;
    restPose.copy(camera.quaternion);
    camera.rotateX(scrollTilt());
    renderer.render(scene, camera);
    // Chrome only submits a canvas's GL work when it's composited, so a planet drawing behind opacity: 0 would
    // queue every frame (and its first uploads) for the GPU to chew through the moment it fades in.
    gl.flush();
    camera.quaternion.copy(restPose);
  };

  // Only animate while the canvas is on screen, so a planet further down the page costs nothing until reached.
  let visible = false;
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    renderer.setAnimationLoop(visible ? frame : null);
  });
  visibility.observe(canvas);

  let disposed = false;
  let mesh: THREE.Mesh<THREE.BufferGeometry, ReturnType<typeof createTopoMaterial>> | undefined;
  let heightTexture: THREE.DataTexture | undefined;
  let upgrade: { t: number; geometry: THREE.BufferGeometry; heightTexture: THREE.DataTexture } | undefined;

  const showHeights = (heights: Int16Array, meta: HeightMeta) => {
    const built = createPlanetGeometry(heights, meta, body.exaggeration);
    if (!mesh) {
      heightTexture = built.heightTexture;
      mesh = new THREE.Mesh(
        built.geometry,
        createTopoMaterial(heightTexture, fullMeta.minKm, fullMeta.maxKm, heatmap, body.contourIntervalKm)
      );
      planet.add(mesh);
      return;
    }
    // Same grid at both resolutions, so the new heights blend in on the existing mesh rather than
    // overlaying a second one (which would z-fight).
    mesh.geometry.setAttribute('nextPosition', built.geometry.getAttribute('position'));
    mesh.material.setNextHeightMap(built.heightTexture);
    upgrade = { t: 0, geometry: built.geometry, heightTexture: built.heightTexture };
    // Nobody is watching, so skip the fade rather than play it when the planet scrolls into view.
    if (!visible) finishUpgrade();
  };

  const finishUpgrade = () => {
    if (!mesh || !upgrade) return;
    const previous = { geometry: mesh.geometry, heightTexture };
    mesh.geometry = upgrade.geometry;
    heightTexture = upgrade.heightTexture;
    mesh.material.setHeightMap(heightTexture);
    mesh.material.setNextHeightMap(heightTexture);
    mesh.material.setBlend(0);
    upgrade = undefined;
    // Detach the shared attribute first so disposing the old geometry doesn't free the new one's buffer.
    previous.geometry.deleteAttribute('nextPosition');
    previous.geometry.dispose();
    previous.heightTexture?.dispose();
  };

  let markReady = () => {};
  const ready = new Promise<void>((resolve) => (markReady = resolve));

  (async () => {
    if (qualityOverride === 'full') {
      const full = await fetchBytes(fullUrl);
      const heights = await decodeHeights(full.bytes, fullMeta);
      if (!disposed) showHeights(heights, fullMeta);
      markReady();
      return;
    }
    const lite = await fetchBytes(liteUrl);
    if (disposed) return;
    showHeights(await decodeHeights(lite.bytes, liteMeta), liteMeta);
    markReady();
    if (disposed || !shouldUpgrade(lite.mbps, lite.cached, qualityOverride)) return;
    const full = await fetchBytes(fullUrl);
    if (disposed) return;
    const heights = await decodeHeights(full.bytes, fullMeta);
    if (!disposed) showHeights(heights, fullMeta);
  })();

  return {
    setHeatmap(enabled) {
      heatmap = enabled;
      mesh?.material.setHeatmap(enabled);
    },
    setDistance,
    ready,
    setScroll(progress) {
      scrollProgress = THREE.MathUtils.clamp(progress, 0, 1);
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      visibility.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      heightTexture?.dispose();
      upgrade?.geometry.dispose();
      upgrade?.heightTexture.dispose();
      renderer.dispose();
    },
  };
}
