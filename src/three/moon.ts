import * as THREE from "three";
import meta from "./data/moon.json";
import heightsUrl from "./data/moon-4096x2048.bin?url";
import { createTopoMaterial } from "./moon-material";

const MOON_RADIUS_KM = 1737.4;
const EXAGGERATION = 4;
const MESH_COLS = 1024;
const MESH_ROWS = 512;

const CAMERA_HOME = new THREE.Vector3(0, 1.05, 1.4);
const CAMERA_TARGET = new THREE.Vector3(0, 0.95, 0);
const MIN_RADIUS = 1.25;
const MAX_RADIUS = 6;
const RETURN_RATE = 4;
const AUTO_SPIN = 0.02;

export interface MoonOptions {
  heatmap?: boolean;
  distanceKm?: number;
}

export interface Moon {
  setHeatmap(enabled: boolean): void;
  setDistance(km: number): void;
  dispose(): void;
}

function createMoonGeometry(heights: Int16Array) {
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
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("gridUv", new THREE.BufferAttribute(gridUv, 2));
  return { geometry, heightTexture };
}

export function createMoon(canvas: HTMLCanvasElement, { heatmap = true, distanceKm = 1300 }: MoonOptions = {}): Moon {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  const moon = new THREE.Group();
  scene.add(moon);

  // Camera eases toward a "home" pose on a fixed ray; further out it re-aims from the surface to the centre.
  const homeDirection = CAMERA_HOME.clone().normalize();
  const homeDistance = CAMERA_HOME.length();
  const homePosition = new THREE.Vector3();
  const homeQuaternion = new THREE.Quaternion();
  const aim = new THREE.Vector3();
  const pose = new THREE.Object3D();

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

  const right = new THREE.Vector3();
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1);
    const ease = 1 - Math.exp(-RETURN_RATE * dt);
    camera.position.lerp(homePosition, ease);
    camera.quaternion.slerp(homeQuaternion, ease);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    moon.rotateOnWorldAxis(right, AUTO_SPIN * dt);
    renderer.render(scene, camera);
  });

  let disposed = false;
  let mesh: THREE.Mesh<THREE.BufferGeometry, ReturnType<typeof createTopoMaterial>> | undefined;
  let heightTexture: THREE.DataTexture | undefined;

  fetch(heightsUrl)
    .then((res) => res.arrayBuffer())
    .then((buffer) => {
      if (disposed) return;
      const built = createMoonGeometry(new Int16Array(buffer));
      heightTexture = built.heightTexture;
      mesh = new THREE.Mesh(built.geometry, createTopoMaterial(heightTexture, meta.minKm, meta.maxKm, heatmap));
      moon.add(mesh);
    });

  return {
    setHeatmap(enabled) {
      heatmap = enabled;
      mesh?.material.setHeatmap(enabled);
    },
    setDistance,
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      mesh?.geometry.dispose();
      mesh?.material.dispose();
      heightTexture?.dispose();
      renderer.dispose();
    },
  };
}
