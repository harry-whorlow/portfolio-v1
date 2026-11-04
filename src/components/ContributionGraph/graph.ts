import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import type { ContributionDay } from '../../data/contributions';

export interface GraphColors {
  openSource: string;
  personal: string;
  ink: string;
  paper: string;
}

export interface MonthLabel {
  label: string;
  x: number;
  y: number;
}

interface GraphOptions {
  weeks: ContributionDay[][];
  colors: GraphColors;
  onHover: (day: ContributionDay | null, x: number, y: number) => void;
  onRender: (months: MonthLabel[]) => void;
}

const CELL = 1.15;
const PITCH = 1.37;
const MAX_HEIGHT = 9;
const EMPTY_HEIGHT = 0.12;
const RADIUS = 0.08;
const ROUNDING_SEGMENTS = 3;
const CAP_HEIGHT = RADIUS * 2 + 0.02;
const OUTLINE_WIDTH = 0.05;

const FOV = 28;
const TILT = 0.9;
const PADDING = 1.08;
const CROP_TOP = 0.19;
const CROP_BOTTOM = 0.2;

const GROW_STAGGER = 0.6;
const GROW_SECONDS = 1.6;
const UPDATE_SECONDS = 1.2;

const WAVE_LIFT = 0.6;
const WAVE_ALONG = 0.45;
const WAVE_ACROSS = 0.8;
const WAVE_SPEED_ALONG = 0.55;
const WAVE_SPEED_ACROSS = 0.35;
const WAVE_FADE = 1.2;

const CAPACITY = 54 * 7;

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

const CAP = CAP_HEIGHT.toFixed(4);
const HALF_CAP = (CAP_HEIGHT / 2).toFixed(4);

const printed = ({
  color,
  faces = true,
  inflate = 0,
  side = THREE.FrontSide,
}: {
  color: string;
  faces?: boolean;
  inflate?: number;
  side?: THREE.Side;
}) =>
  new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) } },
    side,
    vertexShader: /* glsl */ `
      attribute float barHeight;
      varying vec3 vFace;
      void main() {
        vec3 transformed = position;
        if (barHeight < ${CAP}) transformed.y *= barHeight / ${CAP};
        else if (transformed.y > ${HALF_CAP}) transformed.y += barHeight - ${CAP};
        transformed += normal * ${inflate.toFixed(3)};
        vFace = normal;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying vec3 vFace;
      void main() {
        float tone = ${faces ? 'vFace.y > 0.5 ? 1.0 : (abs(vFace.x) > abs(vFace.z) ? 0.8 : 0.64)' : '1.0'};
        gl_FragColor = vec4(color * tone, 1.0);
        #include <colorspace_fragment>
      }`,
  });

const paint = (material: THREE.ShaderMaterial, color: string) =>
  (material.uniforms.color.value as THREE.Color).set(color);

export const createGraph = (canvas: HTMLCanvasElement, { weeks, colors, onHover, onRender }: GraphOptions) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 1000);

  const grid = new THREE.Group();
  scene.add(grid);

  const rounded = new RoundedBoxGeometry(CELL, CAP_HEIGHT, CELL, ROUNDING_SEGMENTS, RADIUS).translate(
    0,
    CAP_HEIGHT / 2,
    0
  );

  const meshes: THREE.InstancedMesh[] = [];
  const addMesh = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial) => {
    const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
    mesh.frustumCulled = false;
    grid.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  const layer = (material: THREE.ShaderMaterial) => {
    const geometry = rounded.clone();
    const heights = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    heights.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('barHeight', heights);
    const mesh = addMesh(geometry, material);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return mesh;
  };

  const openSource = layer(printed({ color: colors.openSource }));
  const personal = layer(printed({ color: colors.personal }));
  const empty = layer(printed({ color: colors.paper, faces: false }));

  const inks = [openSource, personal, empty].map((of) => {
    const hull = printed({ color: colors.ink, faces: false, inflate: OUTLINE_WIDTH, side: THREE.BackSide });
    addMesh(of.geometry, hull).instanceMatrix = of.instanceMatrix;
    return hull;
  });

  const box = new THREE.BoxGeometry(CELL, 1, CELL).translate(0, 0.5, 0);
  const picker = new THREE.InstancedMesh(box, new THREE.MeshBasicMaterial(), CAPACITY);
  picker.visible = false;
  grid.add(picker);

  type Position = { x: number; z: number; os: number; own: number };
  interface Bar {
    day: ContributionDay;
    from: Position;
    to: Position;
    delay: number;
  }

  let columns = 0;
  let monthStarts: { label: string; column: number }[] = [];

  const monthName = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
  const target = (weeks: ContributionDay[][]) => {
    columns = weeks.length;
    const max = Math.max(1, ...weeks.flat().map((day) => day.openSource + day.personal));
    monthStarts = weeks.flatMap((week, column) => {
      const first = week.find((day) => day.date.endsWith('-01'));
      return first ? [{ label: monthName.format(new Date(first.date)), column }] : [];
    });
    return weeks.flatMap((week, column) =>
      week.map((day) => ({
        day,
        delay: (column / Math.max(1, weeks.length - 1)) * GROW_STAGGER,
        to: {
          x: (column - (weeks.length - 1) / 2) * PITCH,
          z: (day.weekday - 3) * PITCH,
          os: (day.openSource / max) * MAX_HEIGHT,
          own: (day.personal / max) * MAX_HEIGHT,
        },
      }))
    );
  };

  let bars: Bar[] = target(weeks).map((bar) => ({ ...bar, from: bar.to }));
  let growth = 0;
  let rising = false;
  let progress = 1;
  let paused = false;
  let visible = false;
  let dirty = true;
  let frame = 0;
  let last = 0;
  let transitioning = false;
  let transitionStart = 0;
  let waveTime = 0;
  let waveStrength = 0;

  const matrix = new THREE.Matrix4();
  const place = (mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, height: number) => {
    const width = height > 0 ? 1 : 0;
    matrix.makeScale(width, 1, width).setPosition(x, y, z);
    mesh.setMatrixAt(i, matrix);
    (mesh.geometry.getAttribute('barHeight') as THREE.InstancedBufferAttribute).setX(i, height);
  };

  const risen = (delay: number) => easeOut(clamp01(growth * (1 + GROW_STAGGER) - delay));
  const growthGoal = () => (paused || rising ? 1 : 0);
  const lifts = new Float32Array(CAPACITY);

  const layout = () => {
    const t = easeOut(progress);
    bars.forEach(({ from, to, delay }, i) => {
      const g = risen(delay);
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      let os = (from.os + (to.os - from.os) * t) * g;
      let own = (from.own + (to.own - from.own) * t) * g;
      let tile = os + own < EMPTY_HEIGHT ? EMPTY_HEIGHT : 0;
      const lift = lifts[i] * g;
      if (own > 0) own += lift;
      else if (os > 0) os += lift;
      else tile += lift;
      place(openSource, i, x, 0, z, os);
      place(personal, i, x, os, z, own);
      place(empty, i, x, 0, z, tile);
      matrix.makeScale(CELL, Math.max(os + own, EMPTY_HEIGHT), CELL).setPosition(x, 0, z);
      picker.setMatrixAt(i, matrix);
    });
    for (const mesh of meshes) {
      mesh.count = bars.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.getAttribute('barHeight').needsUpdate = true;
    }
    picker.count = bars.length;
    picker.instanceMatrix.needsUpdate = true;
    picker.computeBoundingSphere();
    dirty = true;
  };

  const current = () => {
    const k = easeOut(progress);
    return new Map(
      bars.map(({ day, from, to }) => {
        const mix = (key: keyof Position) => from[key] + (to[key] - from[key]) * k;
        return [day.date, { x: mix('x'), z: mix('z'), os: mix('os'), own: mix('own') }];
      })
    );
  };

  const gridDepth = 7 * PITCH;
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (!width || !height) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    const framed = height / (1 - CROP_TOP - CROP_BOTTOM);
    camera.aspect = width / framed;
    camera.setViewOffset(width, framed, 0, framed * CROP_TOP, width, height);

    const halfFov = THREE.MathUtils.degToRad(FOV / 2);
    const fitWidth = ((Math.hypot(columns * PITCH, gridDepth) / 2) * PADDING) / (Math.tan(halfFov) * camera.aspect);
    const fitHeight = (((gridDepth + MAX_HEIGHT) / 2) * PADDING) / Math.tan(halfFov);
    const distance = Math.max(fitWidth, fitHeight);
    camera.position.set(0, Math.sin(TILT) * distance, Math.cos(TILT) * distance);
    camera.lookAt(0, MAX_HEIGHT * 0.25, 0);
    camera.updateProjectionMatrix();
    dirty = true;
  };

  const point = new THREE.Vector3();
  const toScreen = (x: number, y: number, z: number) => {
    point.set(x, y, z).applyMatrix4(grid.matrixWorld).project(camera);
    return { x: ((point.x + 1) / 2) * canvas.clientWidth, y: ((1 - point.y) / 2) * canvas.clientHeight };
  };
  const report = () => {
    const halfDepth = 3 * PITCH + CELL / 2;
    onRender(
      monthStarts.map(({ label, column }) => ({
        label,
        ...toScreen((column - (columns - 1) / 2) * PITCH, 0, halfDepth + PITCH * 0.9),
      }))
    );
  };

  const breathing = () => growth >= 1 && !transitioning && !paused;

  const wave = (dt: number) => {
    const goal = breathing() ? 1 : 0;
    if (!goal && !waveStrength) return;
    waveStrength = goal ? Math.min(1, waveStrength + WAVE_FADE * dt) : Math.max(0, waveStrength - WAVE_FADE * dt);
    if (goal) waveTime += dt;

    bars.forEach(({ to }, i) => {
      const a = Math.sin((to.x / PITCH) * WAVE_ALONG - waveTime * WAVE_SPEED_ALONG);
      const b = Math.sin((to.z / PITCH) * WAVE_ACROSS - waveTime * WAVE_SPEED_ACROSS);
      lifts[i] = ((a + b + 2) / 4) * WAVE_LIFT * waveStrength;
    });
    layout();
  };

  const tick = (now: number) => {
    frame = 0;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;

    const goal = growthGoal();
    if (growth !== goal) {
      const step = dt / GROW_SECONDS;
      growth = goal > growth ? Math.min(goal, growth + step) : Math.max(goal, growth - step);
      layout();
    }

    if (transitioning) {
      progress = clamp01((now - transitionStart) / (UPDATE_SECONDS * 1000));
      if (progress >= 1) transitioning = false;
      layout();
    }

    wave(dt);

    if (dirty) {
      renderer.render(scene, camera);
      report();
      dirty = false;
    }
    schedule();
  };

  const schedule = () => {
    if (frame || !visible) return;
    if (growth === growthGoal() && !transitioning && !breathing() && !waveStrength && !dirty) {
      last = 0;
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hover = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    ndc.set((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(picker, false)[0];
    onHover(hit?.instanceId !== undefined ? bars[hit.instanceId].day : null, x, y);
  };
  canvas.addEventListener('pointermove', (event) => event.pointerType === 'mouse' && hover(event));
  canvas.addEventListener('pointerup', (event) => event.pointerType !== 'mouse' && hover(event));
  canvas.addEventListener('pointerleave', (event) => event.pointerType === 'mouse' && onHover(null, 0, 0));

  new ResizeObserver(() => (resize(), schedule())).observe(canvas);

  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) schedule();
    else if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    }
  }).observe(canvas);

  layout();
  resize();

  return {
    setRising: (value: boolean) => {
      rising = value;
      schedule();
    },
    setData: (weeks: ContributionDay[][]) => {
      const now = current();
      bars = target(weeks).map((bar) => ({
        ...bar,
        from: now.get(bar.day.date) ?? { ...bar.to, os: 0, own: 0 },
      }));
      if (paused) progress = 1;
      else {
        progress = 0;
        transitioning = true;
        transitionStart = performance.now();
      }
      layout();
      schedule();
    },
    setColors: (next: Pick<GraphColors, 'ink' | 'paper'>) => {
      paint(empty.material as THREE.ShaderMaterial, next.paper);
      for (const ink of inks) paint(ink, next.ink);
      dirty = true;
      schedule();
    },
    setPaused: (value: boolean) => {
      paused = value;
      if (paused && transitioning) {
        transitioning = false;
        progress = 1;
      }
      if (paused) {
        growth = 1;
        waveStrength = 0;
        lifts.fill(0);
      }
      layout();
      schedule();
    },
  };
};
