import * as THREE from 'three';
import gsap from 'gsap';
import type { Mark } from '../data/marks';
import heightMeta from './data/earth-1024x512-5m.json';
import heightUrl from './data/earth-1024x512-5m.bin.gz?url';
import { RAMP } from './palette';
import { createPlanetGeometry, decodeHeights } from './planet';
import { createTopoMaterial } from './topo-material';

// the darkest purple disappears on black, so markers pick from the rest of the ramp
// Satellites (display marks) are always red with off-white panels; red is kept out of the diamonds' colours so a red
// mark on the globe always means a named friend.
const SATELLITE_COLOR = RAMP[6];
const SATELLITE_PANEL_COLOR = RAMP[7];
const MARKER_COLORS = RAMP.slice(2).filter((color) => color !== SATELLITE_COLOR);

const CAMERA_DISTANCE = 4.6;
const AUTO_SPIN = 0.06;
const REST_PITCH = 0.35;
// the found city sits a little above the middle of the globe, leaving room for its marker
const LAND_OFFSET = 0.3;
const DRAG_SPEED = Math.PI;

// the solar-heightmap sandbox's Earth: heat map and surface off, 1km contours with a fixed coastline, heights
// exaggerated tenfold
const EXAGGERATION = 10;
const CONTOUR_KM = 1;
// a lighter mesh than the moon's; the contours come from the height texture, so only the silhouette coarsens
const MESH = { cols: 512, rows: 256 };
const MOBILE_MESH = { cols: 256, rows: 128 };

// A stretched diamond: a short point facing away from the earth over a long point reaching down to the city.
// The long point grows with the city's hellos; the short one and the width stay put.
const MARKER_WIDTH = 0.011;
const MARKER_CAP = 0.022;
// the long point's length, from a city with one hello up to the busiest city
const MIN_LENGTH = 0.02;
const MAX_LENGTH = 0.08;

// A display mark is a tiny satellite hovering above its city on a tether, rather than a diamond on the ground.
const SATELLITE_SIZE = 0.009;
const SATELLITE_ALTITUDE = 0.13;
// satellites are spread apart among themselves like the diamonds, but wider, since their panels stick out
const SATELLITE_SEPARATION = 0.05;

const SEPARATION_GAP = 0.6;
const MIN_SEPARATION = MARKER_WIDTH * 2 * SEPARATION_GAP;
const SPREAD_ITERATIONS = 120;
// how quickly a marker glides to its new spot when a neighbour arrives and it has to make room
const SPREAD_RATE = 5;

// how close (px) the pointer has to be to a marker for its readout to show
const HOVER_RADIUS = 44;
// a readout only shows while its anchor isn't hidden behind the globe; a hair under the unit sphere so anchors
// sitting right on the edge still count
const OCCLUDER_RADIUS = 0.995;

const TRAIL_POINTS = 56;
const TRAIL_LENGTH = 0.28;
const COMET_START = new THREE.Vector3(-4.8, 3.2, 1.4);
const COMET_SECONDS = 1.5;
const SPIN_SECONDS = 2.4;
const HOLD_SECONDS = 2.5;

const deg = THREE.MathUtils.degToRad;
const randomColor = () => MARKER_COLORS[Math.floor(Math.random() * MARKER_COLORS.length)];

/** Same convention as planet.ts: lon 0 faces +z, north is +y. */
const toVector = (lat: number, lon: number, radius = 1, target = new THREE.Vector3()) =>
  target.set(
    Math.cos(deg(lat)) * Math.sin(deg(lon)) * radius,
    Math.sin(deg(lat)) * radius,
    Math.cos(deg(lat)) * Math.cos(deg(lon)) * radius
  );

// Relative to the busiest city, so the tallest marker is always the busiest. The square root keeps a city with one
// hello visible next to one with hundreds.
const markerLength = (count: number, maxCount: number) =>
  MIN_LENGTH + (MAX_LENGTH - MIN_LENGTH) * Math.sqrt((count - 1) / Math.max(maxCount - 1, 1));

// Two four-sided cones with unit radius and height, base to base. The lower one points down with its tip on the
// city (y = 0) and its base at y = 1; the upper one sits on top with its base at y = 0. Scaling each one's y
// stretches that half of the diamond on its own.
const lowerGeometry = new THREE.ConeGeometry(1, 1, 4).rotateX(Math.PI).translate(0, 0.5, 0);
const upperGeometry = new THREE.ConeGeometry(1, 1, 4).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);

// the satellite in units of SATELLITE_SIZE: a box body, two flat solar panels on short arms, and a dish facing down
const satelliteBody = new THREE.BoxGeometry(1, 1, 1.3);
const satellitePanel = new THREE.BoxGeometry(1.8, 0.08, 0.9);
const satelliteArm = new THREE.BoxGeometry(0.5, 0.08, 0.08);
const satelliteDish = new THREE.ConeGeometry(0.45, 0.4, 6).rotateX(Math.PI).translate(0, -0.7, 0);
const panelMaterial = new THREE.MeshStandardMaterial({
  color: SATELLITE_PANEL_COLOR,
  emissive: SATELLITE_PANEL_COLOR,
  emissiveIntensity: 0.3,
  roughness: 0.3,
  metalness: 0.6,
  flatShading: true,
});

function createSatellite(material: THREE.Material) {
  const craft = new THREE.Group();
  craft.add(new THREE.Mesh(satelliteBody, material));
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(satelliteArm, material);
    arm.position.x = side * 0.75;
    const panel = new THREE.Mesh(satellitePanel, panelMaterial);
    panel.position.x = side * 1.9;
    craft.add(arm, panel);
  }
  craft.add(new THREE.Mesh(satelliteDish, material));
  return craft;
}
const FORWARD = new THREE.Vector3(0, 0, 1);

interface Marker {
  hello: Mark;
  color: string;
  /** The city's true direction from the globe's centre. */
  home: THREE.Vector3;
  /** Where the marker is drawn: home, nudged away from crowded neighbours. */
  normal: THREE.Vector3;
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  state: { grow: number; length: number };
  /** A `hello` mark: the diamond standing on the city. */
  diamond?: { lower: THREE.Mesh; upper: THREE.Mesh };
  /** A `display` mark: the satellite and the tether down to its city. */
  satellite?: { craft: THREE.Group; tether: THREE.Line; tetherPositions: Float32Array };
}

function createMarker(hello: Mark, color: string): Marker {
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.1,
    flatShading: true,
  });

  // the group sits on the city with +y pointing straight up, away from the earth
  const group = new THREE.Group();
  const normal = toVector(hello.lat, hello.lon);
  group.position.copy(normal);
  group.quaternion.setFromUnitVectors(UP, normal);

  const marker: Marker = { hello, color, home: normal.clone(), normal, group, material, state: { grow: 0, length: 0 } };

  if (hello.type === 'display') {
    const craft = createSatellite(material);
    const tetherPositions = new Float32Array(6);
    const tetherGeometry = new THREE.BufferGeometry();
    tetherGeometry.setAttribute('position', new THREE.BufferAttribute(tetherPositions, 3));
    const tether = new THREE.Line(
      tetherGeometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false })
    );
    tether.frustumCulled = false;
    group.add(craft, tether);
    marker.satellite = { craft, tether, tetherPositions };
  } else {
    const lower = new THREE.Mesh(lowerGeometry, material);
    const upper = new THREE.Mesh(upperGeometry, material);
    group.add(lower, upper);
    marker.diamond = { lower, upper };
  }

  drawMarker(marker);
  return marker;
}

function drawMarker({ group, state, diamond, satellite }: Marker) {
  const { grow, length } = state;
  group.visible = grow > 0.001;

  if (diamond) {
    const width = MARKER_WIDTH * Math.max(grow, 0.0001);
    diamond.lower.scale.set(width, Math.max(length * grow, 0.0001), width);
    diamond.upper.scale.set(width, Math.max(MARKER_CAP * grow, 0.0001), width);
    diamond.upper.position.y = length * grow;
  }

  if (satellite) {
    // it rises straight up out of the city as it grows in
    const { craft, tetherPositions } = satellite;
    craft.scale.setScalar(SATELLITE_SIZE * Math.max(grow, 0.0001));
    craft.position.set(0, SATELLITE_ALTITUDE * grow, 0);
    tetherPositions[4] = craft.position.y;
    satellite.tether.geometry.attributes.position.needsUpdate = true;
  }
}

const growMarker = (marker: Marker, length: number, delay = 0) =>
  gsap.to(marker.state, {
    grow: 1,
    length,
    delay,
    duration: 1.2,
    ease: 'elastic.out(1, 0.45)',
    onUpdate: () => drawMarker(marker),
  });

function createComet(pixelRatio: number) {
  const positions = new Float32Array(TRAIL_POINTS * 3);
  const alphas = new Float32Array(TRAIL_POINTS);
  const sizes = new Float32Array(TRAIL_POINTS);
  const whites = new Float32Array(TRAIL_POINTS);
  for (let i = 0; i < TRAIL_POINTS; i++) {
    const t = i / (TRAIL_POINTS - 1);
    sizes[i] = i === 0 ? 30 : THREE.MathUtils.lerp(16, 2, t);
    whites[i] = Math.max(1 - t * 4, 0);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aWhite', new THREE.BufferAttribute(whites, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color() },
      uScale: { value: pixelRatio * CAMERA_DISTANCE },
    },
    vertexShader: /* glsl */ `
      attribute float aAlpha;
      attribute float aSize;
      attribute float aWhite;
      uniform float uScale;
      varying float vAlpha;
      varying float vWhite;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uScale / -mv.z;
        vAlpha = aAlpha;
        vWhite = aWhite;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vAlpha;
      varying float vWhite;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float glow = pow(max(1.0 - d, 0.0), 2.0) * vAlpha;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), vWhite) * glow, glow);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.visible = false;
  return { points, positions, alphas, geometry, material };
}

/** Where a marker's readout should sit, in CSS pixels from the canvas's top left. */
export interface Readout {
  hello: Mark;
  color: string;
  x: number;
  y: number;
}

export interface GlobeOptions {
  reducedMotion?: boolean;
  /**
   * How much of the globe's width the canvas shows, from its left edge. 0.5 draws only the left half, for a globe
   * whose middle sits on the edge of the screen; the hidden part is never rendered.
   */
  visibleWidth?: number;
  /**
   * Called every frame with the hovered marker, or else the last one to land, or null when neither is in view.
   * Display marks are left out, since they carry their own label.
   */
  onReadout?: (readout: Readout | null) => void;
  /** Called every frame with every display mark that's grown in and facing the camera. */
  onLabels?: (labels: Readout[]) => void;
}

export interface Globe {
  /** Shows the hellos already in the database, growing their markers in one after another. */
  setHellos(hellos: Mark[]): void;
  /** Spins to the city, flies a comet into it and grows (or stretches) its marker. */
  land(hello: Mark): Promise<void>;
  setPaused(paused: boolean): void;
  dispose(): void;
}

export function createGlobe(
  canvas: HTMLCanvasElement,
  { reducedMotion = false, visibleWidth = 1, onReadout, onLabels }: GlobeOptions = {}
): Globe {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const pixelRatio = Math.min(window.devicePixelRatio, coarsePointer ? 1.5 : 2);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, CAMERA_DISTANCE);

  // only the markers are lit; the contours draw their own colour. The key light sits up and to the left
  // so the diamonds' facets catch it
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(-2, 3, 4);
  scene.add(key, new THREE.AmbientLight('#ffffff', 0.6));

  const globe = new THREE.Group();
  scene.add(globe);

  // the heights load on their own; markers and comets work on the bare sphere until they land
  let disposed = false;
  let surface: THREE.Mesh<THREE.BufferGeometry, ReturnType<typeof createTopoMaterial>> | undefined;
  let heightTexture: THREE.DataTexture | undefined;
  fetch(heightUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`height map ${response.status}`);
      return response.arrayBuffer();
    })
    .then((buffer) => decodeHeights(new Uint8Array(buffer), heightMeta))
    .then((heights) => {
      if (disposed) return;
      const built = createPlanetGeometry(heights, heightMeta, EXAGGERATION, coarsePointer ? MOBILE_MESH : MESH);
      heightTexture = built.heightTexture;
      const material = createTopoMaterial(heightTexture, heightMeta.minKm, heightMeta.maxKm, false, CONTOUR_KM, true);
      surface = new THREE.Mesh(built.geometry, material);
      globe.add(surface);
    })
    // the markers and comets still work on the bare sphere, so this only needs reporting
    .catch((error) => console.error('[globe] failed to load the height map', error));

  const comet = createComet(pixelRatio);
  scene.add(comet.points);

  const impacts = new THREE.Group();
  scene.add(impacts);

  // yaw spins around the poles, pitch tips a latitude towards the camera
  const pose = { yaw: 0, pitch: REST_PITCH };
  const qYaw = new THREE.Quaternion();
  const qPitch = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0);
  const poseQuaternion = (yaw: number, pitch: number, target = new THREE.Quaternion()) =>
    target.multiplyQuaternions(qPitch.setFromAxisAngle(X, pitch), qYaw.setFromAxisAngle(UP, yaw));

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    renderer.setSize(clientWidth, clientHeight, false);
    // the camera frames the whole globe, then draws only the part of that frame the canvas covers
    const fullWidth = clientWidth / visibleWidth;
    camera.aspect = fullWidth / Math.max(clientHeight, 1);
    // keep the whole globe and its markers in frame on narrow screens
    camera.position.z = CAMERA_DISTANCE * Math.max(1, 1 / camera.aspect);
    if (visibleWidth < 1) camera.setViewOffset(fullWidth, clientHeight, 0, 0, clientWidth, clientHeight);
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  let paused = false;
  let busy = false;
  let dragPointer: number | null = null;
  let lastX = 0;
  let lastY = 0;
  // the pointer over the canvas, for hover readouts; null once it leaves
  let hover: { x: number; y: number } | null = null;

  const localPoint = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: PointerEvent) => {
    // a tap picks the nearest marker; touch drags are left to the page so phones can scroll past the globe
    hover = localPoint(e);
    if (busy || dragPointer !== null || e.button !== 0 || e.pointerType === 'touch') return;
    dragPointer = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') hover = localPoint(e);
    if (e.pointerId !== dragPointer || busy) return;
    const scale = DRAG_SPEED / Math.max(canvas.clientHeight, 1);
    pose.yaw += (e.clientX - lastX) * scale;
    pose.pitch = THREE.MathUtils.clamp(pose.pitch + (e.clientY - lastY) * scale, -1.2, 1.2);
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId === dragPointer) dragPointer = null;
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch') hover = null;
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerLeave);

  const markers = new Map<string, Marker>();
  // the last city to land keeps its readout until something else is hovered
  let tracked: Marker | undefined;

  const world = new THREE.Vector3();
  const ray = new THREE.Vector3();

  // Whether the globe hides a point: cast a ray from the camera to it and see if it meets the sphere first. A
  // simple "does the marker face the camera" test hides raised markers that still poke out past the globe's edge.
  const occluded = (point: THREE.Vector3) => {
    const toPoint = ray.subVectors(point, camera.position).length();
    ray.divideScalar(toPoint);
    const b = camera.position.dot(ray);
    const disc = b * b - (camera.position.lengthSq() - OCCLUDER_RADIUS * OCCLUDER_RADIUS);
    if (disc <= 0) return false;
    const hit = -b - Math.sqrt(disc);
    return hit > 0 && hit < toPoint;
  };

  // the readout hangs off the diamond's widest point, where the two halves meet
  // a satellite's label rides along with the craft itself
  const project = (marker: Marker) => {
    if (marker.satellite) marker.satellite.craft.getWorldPosition(world);
    else
      world
        .copy(marker.normal)
        .multiplyScalar(1 + marker.state.length * marker.state.grow)
        .applyQuaternion(globe.quaternion);
    if (occluded(world)) return null;
    world.project(camera);
    return { x: ((world.x + 1) / 2) * canvas.clientWidth, y: ((1 - world.y) / 2) * canvas.clientHeight };
  };

  const readout = (): Readout | null => {
    if (hover && dragPointer === null) {
      let best: { marker: Marker; x: number; y: number } | undefined;
      let bestDistance = HOVER_RADIUS;
      for (const marker of markers.values()) {
        if (marker.state.grow < 0.5 || marker.hello.type === 'display') continue;
        const at = project(marker);
        if (!at) continue;
        const distance = Math.hypot(at.x - hover.x, at.y - hover.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { marker, ...at };
        }
      }
      if (best) return { hello: best.marker.hello, color: best.marker.color, x: best.x, y: best.y };
    }
    if (tracked && tracked.hello.type !== 'display') {
      const at = project(tracked);
      if (at) return { hello: tracked.hello, color: tracked.color, ...at };
    }
    return null;
  };

  const labels = (): Readout[] => {
    const shown: Readout[] = [];
    for (const marker of markers.values()) {
      if (marker.hello.type !== 'display' || marker.state.grow < 0.5) continue;
      const at = project(marker);
      if (at) shown.push({ hello: marker.hello, color: marker.color, ...at });
    }
    return shown;
  };

  const timer = new THREE.Timer();
  // only advances while playing, so the contours pick up where they stopped
  let flowSeconds = 0;
  const frame = (time: number) => {
    timer.update(time);
    const dt = Math.min(timer.getDelta(), 0.1);
    if (!paused) flowSeconds += dt;
    surface?.material.setTime(flowSeconds);
    if (!paused && !busy && dragPointer === null) pose.yaw += AUTO_SPIN * dt;
    poseQuaternion(pose.yaw, pose.pitch, globe.quaternion);
    glide(dt);
    renderer.render(scene, camera);
    onReadout?.(readout());
    onLabels?.(labels());
  };

  // only animate while the canvas is on screen
  const visibility = new IntersectionObserver(([entry]) => {
    renderer.setAnimationLoop(entry.isIntersecting ? frame : null);
    if (!entry.isIntersecting) {
      onReadout?.(null);
      onLabels?.([]);
    }
  });
  visibility.observe(canvas);

  const bezier = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3());
  const point = new THREE.Vector3();

  const drawComet = (progress: number) => {
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const t = progress - (i / (TRAIL_POINTS - 1)) * TRAIL_LENGTH;
      bezier.getPoint(THREE.MathUtils.clamp(t, 0, 1), point).toArray(comet.positions, i * 3);
      // points that haven't launched yet or have already hit the surface are hidden
      comet.alphas[i] = t < 0 || t > 1 ? 0 : Math.pow(1 - i / TRAIL_POINTS, 1.6);
    }
    comet.geometry.attributes.position.needsUpdate = true;
    comet.geometry.attributes.aAlpha.needsUpdate = true;
  };

  const impact = (at: THREE.Vector3, color: string) => {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 48), material);
    ring.position.copy(at).multiplyScalar(1.003);
    ring.quaternion.setFromUnitVectors(FORWARD, at.clone().normalize());
    ring.scale.setScalar(0.01);
    impacts.add(ring);
    gsap.to(ring.scale, { x: 0.12, y: 0.12, z: 0.12, duration: 1.1, ease: 'power2.out' });
    gsap.to(material, {
      opacity: 0,
      duration: 1.1,
      ease: 'power1.in',
      onComplete: () => {
        impacts.remove(ring);
        ring.geometry.dispose();
        material.dispose();
      },
    });
  };

  const push = new THREE.Vector3();
  const tangent = new THREE.Vector3();

  // Relaxes the drawn positions, starting each time from the true ones so a marker never strays further than it
  // must: every pair closer than the separation is pushed apart along the sphere, half each, until none are.
  // Diamonds and satellites are relaxed apart separately, since the satellites fly above the diamonds.
  const spread = () => {
    const all = [...markers.values()];
    relax(
      all.filter((marker) => !marker.satellite),
      MIN_SEPARATION
    );
    relax(
      all.filter((marker) => marker.satellite),
      SATELLITE_SEPARATION
    );
    // a marker nobody can see yet goes straight to its spot; the rest glide there in glide()
    for (const marker of all) if (marker.state.grow === 0 || reducedMotion) place(marker, marker.normal);
  };

  const relax = (all: Marker[], separation: number) => {
    all.forEach((marker) => marker.normal.copy(marker.home));
    const closeDot = Math.cos(separation);

    for (let iteration = 0; iteration < SPREAD_ITERATIONS; iteration++) {
      let moved = false;
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          const a = all[i].normal;
          const b = all[j].normal;
          const dot = a.dot(b);
          if (dot <= closeDot) continue;
          push.subVectors(a, b);
          // two cities in the same spot have no direction between them, so pick one that differs per pair
          if (push.lengthSq() < 1e-12) {
            tangent.set(Math.cos(i * 2.39996), Math.sin(i * 2.39996), 0.3);
            push.crossVectors(a, tangent);
          }
          const angle = Math.acos(Math.min(dot, 1));
          push.normalize().multiplyScalar((separation - angle) / 2 + 1e-4);
          a.add(push).normalize();
          b.sub(push).normalize();
          moved = true;
        }
      }
      if (!moved) break;
    }
  };

  const place = (marker: Marker, direction: THREE.Vector3) => {
    marker.group.position.copy(direction);
    marker.group.quaternion.setFromUnitVectors(UP, direction);
  };

  const glidePosition = new THREE.Vector3();
  const glide = (dt: number) => {
    const ease = 1 - Math.exp(-SPREAD_RATE * dt);
    for (const marker of markers.values()) {
      if (marker.group.position.distanceToSquared(marker.normal) < 1e-10) continue;
      place(marker, glidePosition.copy(marker.group.position).lerp(marker.normal, ease).normalize());
    }
  };

  const markerFor = (hello: Mark) => {
    let marker = markers.get(hello.id);
    if (!marker) {
      marker = createMarker(hello, hello.type === 'display' ? SATELLITE_COLOR : randomColor());
      markers.set(hello.id, marker);
      globe.add(marker.group);
    }
    marker.hello = hello;
    return marker;
  };

  // only the diamonds are sized by their hellos
  const diamonds = () => [...markers.values()].filter((marker) => marker.diamond);
  const maxCount = () => Math.max(1, ...diamonds().map((marker) => marker.hello.count));

  // eases every grown marker (bar one that's busy growing) to its length against the current busiest city
  const restretch = (except?: Marker) => {
    const max = maxCount();
    for (const marker of diamonds()) {
      if (marker === except || marker.state.grow === 0) continue;
      const length = markerLength(marker.hello.count, max);
      if (Math.abs(length - marker.state.length) < 1e-4) continue;
      if (reducedMotion) {
        marker.state.length = length;
        drawMarker(marker);
      } else gsap.to(marker.state, { length, duration: 0.8, ease: 'power2.inOut', onUpdate: () => drawMarker(marker) });
    }
  };

  return {
    setHellos(hellos) {
      const fresh = new Set(hellos.filter((hello) => !markers.has(hello.id)).map((hello) => hello.id));
      hellos.forEach(markerFor);
      // re-space whenever cities change, so a new arrival nudges its neighbours aside
      spread();
      const max = maxCount();
      hellos.forEach((hello, i) => {
        const marker = markers.get(hello.id)!;
        const length = marker.satellite ? 0 : markerLength(hello.count, max);
        if (reducedMotion) {
          Object.assign(marker.state, { grow: 1, length });
          drawMarker(marker);
        } else growMarker(marker, length, fresh.has(hello.id) ? 0.3 + i * 0.04 : 0);
      });
    },

    land(hello) {
      const marker = markerFor(hello);
      // neighbours shuffle aside for a new or taller marker, and the comet aims for where it will actually stand
      spread();
      const lat = Math.asin(THREE.MathUtils.clamp(marker.normal.y, -1, 1));
      const lon = Math.atan2(marker.normal.x, marker.normal.z);
      const length = markerLength(hello.count, maxCount());
      // the previous city's readout clears while this one flies in
      tracked = undefined;

      // the nearest equivalent yaw, plus a full turn in the direction it already spins
      // with only part of the globe on screen, the city turns to the middle of the part that shows, which is
      // (visibleWidth - 1) radii left of the globe's centre
      const targetYaw = -lon + Math.asin(visibleWidth - 1);
      const wrapped = THREE.MathUtils.euclideanModulo(targetYaw - pose.yaw + Math.PI, Math.PI * 2) - Math.PI;
      const yaw = pose.yaw + wrapped + Math.PI * 2;
      const pitch = lat - LAND_OFFSET;

      if (reducedMotion) {
        Object.assign(pose, { yaw, pitch });
        Object.assign(marker.state, { grow: 1, length });
        drawMarker(marker);
        restretch(marker);
        tracked = marker;
        return Promise.resolve();
      }

      busy = true;
      dragPointer = null;

      // where the city will be once the spin settles, so the comet can be aimed before it gets there
      const target = marker.normal.clone().applyQuaternion(poseQuaternion(yaw, pitch));
      const start = COMET_START.clone();
      const control = start.clone().add(target).multiplyScalar(0.5).addScaledVector(target, 1.4);
      bezier.v0.copy(start);
      bezier.v1.copy(control);
      bezier.v2.copy(target);
      comet.material.uniforms.uColor.value.set(marker.color);

      const flight = { progress: 0 };
      // the comet hits the surface just after the spin settles, its tail still streaming in behind it
      const landAt = SPIN_SECONDS + 0.15;
      const launchAt = landAt - COMET_SECONDS;
      // power2.in ends at twice the average speed, so the tail keeps that pace as it streams in
      const tailSeconds = (TRAIL_LENGTH * COMET_SECONDS) / 2;

      return new Promise<void>((resolve) => {
        gsap
          .timeline({
            onComplete: () => {
              busy = false;
              resolve();
            },
          })
          .to(pose, { yaw, pitch, duration: SPIN_SECONDS, ease: 'power3.inOut' }, 0)
          .call(
            () => {
              drawComet(0);
              comet.points.visible = true;
            },
            [],
            launchAt
          )
          .to(
            flight,
            {
              progress: 1,
              duration: COMET_SECONDS,
              ease: 'power2.in',
              onUpdate: () => drawComet(flight.progress),
            },
            launchAt
          )
          .call(
            () => {
              impact(target, marker.color);
              growMarker(marker, length);
              // a new busiest city shortens everyone else
              restretch(marker);
              tracked = marker;
            },
            [],
            landAt
          )
          // after impact the tail keeps flowing into the city and burns out
          .to(
            flight,
            {
              progress: 1 + TRAIL_LENGTH,
              duration: tailSeconds,
              ease: 'none',
              onUpdate: () => drawComet(flight.progress),
              onComplete: () => (comet.points.visible = false),
            },
            landAt
          )
          .to({}, { duration: HOLD_SECONDS });
      });
    },

    setPaused(value) {
      paused = value;
    },

    dispose() {
      disposed = true;
      heightTexture?.dispose();
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      visibility.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      scene.traverse((object) => {
        // Line covers LineSegments too, and the satellites' tethers
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry.dispose();
          (object.material as THREE.Material).dispose();
        }
      });
      renderer.dispose();
    },
  };
}
