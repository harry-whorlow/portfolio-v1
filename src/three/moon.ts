import * as THREE from 'three';
import fullMeta from './data/moon.json';
import fullUrl from './data/moon-4096x2048.bin.gz?url';
import liteMeta from './data/moon-2048x1024-5m.json';
import liteUrl from './data/moon-2048x1024-5m.bin.gz?url';
import { createTopoMaterial } from './moon-material';

type HeightMeta = typeof fullMeta;

const qualityOverride = new URLSearchParams(location.search).get('moon');
const UPGRADE_MIN_MBPS = 25;
const THROUGHPUT_KEY = 'moon:mbps';

const MOON_RADIUS_KM = 1737.4;
const EXAGGERATION = 6;
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

export interface MoonOptions {
  heatmap?: boolean;
  distanceKm?: number;
}

export interface Moon {
  setHeatmap(enabled: boolean): void;
  setDistance(km: number): void;
  setScroll(progress: number): void;
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

function shouldUpgrade(mbps: number, cached: boolean) {
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

function createMoonGeometry(heights: Int16Array, meta: HeightMeta) {
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
      const scale = 1 + (heightsKm[dataRow * meta.cols + dataCol] / meta.radiusKm) * EXAGGERATION;
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

export function createMoon(canvas: HTMLCanvasElement, { heatmap = true, distanceKm = 1300 }: MoonOptions = {}): Moon {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const moon = new THREE.Group();
  scene.add(moon);

  const homeDirection = CAMERA_HOME.clone().normalize();
  const homeDistance = CAMERA_HOME.length();
  const homePosition = new THREE.Vector3();
  const homeQuaternion = new THREE.Quaternion();
  const aim = new THREE.Vector3();
  const pose = new THREE.Camera();

  const setDistance = (km: number) => {
    const distance = THREE.MathUtils.clamp(1 + km / MOON_RADIUS_KM, MIN_RADIUS, MAX_RADIUS);
    const t = THREE.MathUtils.clamp((distance - homeDistance) / (MAX_RADIUS - homeDistance), 0, 1);
    homePosition.copy(homeDirection).multiplyScalar(distance);
    aim.lerpVectors(CAMERA_TARGET, new THREE.Vector3(), t);
    pose.position.copy(homePosition);
    pose.lookAt(aim);
    homeQuaternion.copy(pose.quaternion);
  };
  setDistance(distanceKm);
  camera.position.copy(homePosition);
  camera.quaternion.copy(homeQuaternion);

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
  const moonRadius = 1 + (fullMeta.maxKm / fullMeta.radiusKm) * EXAGGERATION;
  const centerInView = new THREE.Vector3();
  const restPose = new THREE.Quaternion();
  let scrollProgress = 0;
  const scrollTilt = () => {
    if (scrollProgress <= 0) return 0;
    camera.updateMatrixWorld();
    centerInView.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
    const reach = Math.hypot(centerInView.y, centerInView.z);
    if (reach <= moonRadius) return 0;
    const facing = Math.atan2(centerInView.z, centerInView.y);
    const spread = Math.acos(moonRadius / reach);
    const lowestAngle = Math.atan(Math.min(Math.tan(facing + spread), Math.tan(facing - spread)));
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    return scrollProgress * (lowestAngle - halfFov);
  };

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
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
      moon.rotateOnWorldAxis(up, pendingX * scale);
      moon.rotateOnWorldAxis(right, pendingY * scale);
    } else {
      spin.multiplyScalar(Math.exp(-SPIN_DAMPING * dt));
      moon.rotateOnWorldAxis(up, spin.x * dt);
      moon.rotateOnWorldAxis(right, (spin.y + AUTO_SPIN) * dt);
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
    camera.quaternion.copy(restPose);
  });

  let disposed = false;
  let mesh: THREE.Mesh<THREE.BufferGeometry, ReturnType<typeof createTopoMaterial>> | undefined;
  let heightTexture: THREE.DataTexture | undefined;
  let upgrade: { t: number; geometry: THREE.BufferGeometry; heightTexture: THREE.DataTexture } | undefined;

  const showHeights = (heights: Int16Array, meta: HeightMeta) => {
    const built = createMoonGeometry(heights, meta);
    if (!mesh) {
      heightTexture = built.heightTexture;
      mesh = new THREE.Mesh(built.geometry, createTopoMaterial(heightTexture, fullMeta.minKm, fullMeta.maxKm, heatmap));
      moon.add(mesh);
      return;
    }
    // Same grid at both resolutions, so the new heights blend in on the existing mesh rather than
    // overlaying a second one (which would z-fight).
    mesh.geometry.setAttribute('nextPosition', built.geometry.getAttribute('position'));
    mesh.material.setNextHeightMap(built.heightTexture);
    upgrade = { t: 0, geometry: built.geometry, heightTexture: built.heightTexture };
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

  (async () => {
    if (qualityOverride === 'full') {
      const full = await fetchBytes(fullUrl);
      const heights = await decodeHeights(full.bytes, fullMeta);
      if (!disposed) showHeights(heights, fullMeta);
      return;
    }
    const lite = await fetchBytes(liteUrl);
    if (disposed) return;
    showHeights(await decodeHeights(lite.bytes, liteMeta), liteMeta);
    if (disposed || !shouldUpgrade(lite.mbps, lite.cached)) return;
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
    setScroll(progress) {
      scrollProgress = THREE.MathUtils.clamp(progress, 0, 1);
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
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
