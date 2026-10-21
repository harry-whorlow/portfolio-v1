export interface BoidsOptions {
  host: HTMLElement;
  follow: HTMLElement[];
  colors: string[];
  count?: number;
  paused?: boolean;
  hidden?: boolean;
}

export interface BoidsController {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  hide: () => void;
  show: () => void;
  readonly paused: boolean;
  readonly hidden: boolean;
  destroy: () => void;
}

interface Boid {
  x: number;
  y: number;
  vx: number;
  vy: number;
  flock: number;
}

const VIEW = 50;
const SEPARATION = 18;
const MAX_SPEED = 1.6;
const MIN_SPEED = 0.8;
const MAX_FORCE = 0.04;

const ALIGN = 1;
const COHERE = 0.8;
const SEPARATE = 1.6;

const REPEL_RADIUS = 120;
const REPEL = 0.6;

const EDGE = 80;
const TURN = 0.08;

const AREA_PER_BOID = 12000;
const MIN_COUNT = 40;
const MAX_COUNT = 800;

const SIZE = 4;
const SPREAD = 0.7;
const ALPHA = 0.5;

const MARGIN = SIZE * 2;

const WARM_UP = 300;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const limit = (x: number, y: number, max: number): [number, number] => {
  const len = Math.hypot(x, y);
  return len > max ? [(x / len) * max, (y / len) * max] : [x, y];
};

export const createBoids = (canvas: HTMLCanvasElement, options: BoidsOptions): BoidsController => {
  const ctx = canvas.getContext('2d')!;
  const { host, follow, colors } = options;

  let width = 0;
  let height = 0;
  let viewHeight = 0;
  let offset = 0;

  let boids: Boid[] = [];
  let pointer: { clientX: number; clientY: number } | null = null;

  let cols = 0;
  let rows = 0;
  let grid: Boid[][] = [];

  let paused = options.paused ?? false;
  let hidden = options.hidden ?? false;
  let visible = false;
  let dirty = true;
  let frame = 0;
  let last = 0;

  const spawn = (): Boid => {
    const angle = Math.random() * Math.PI * 2;
    const speed = MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED);
    return {
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      flock: Math.floor(Math.random() * colors.length),
    };
  };

  const resizeWorld = () => {
    width = host.clientWidth;
    height = host.clientHeight;
    cols = Math.max(1, Math.ceil(width / VIEW));
    rows = Math.max(1, Math.ceil(height / VIEW));
    grid = Array.from({ length: cols * rows }, () => []);

    const count = options.count ?? Math.round(clamp((width * height) / AREA_PER_BOID, MIN_COUNT, MAX_COUNT));
    while (boids.length < count) boids.push(spawn());
    boids.length = count;

    for (const boid of boids) {
      boid.x = clamp(boid.x, 0, width);
      boid.y = clamp(boid.y, 0, height);
    }
    dirty = true;
  };

  const resizeView = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    viewHeight = window.innerHeight;
    follow.forEach((element) => (element.style.height = `${viewHeight}px`));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(viewHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dirty = true;
  };

  const cellOf = (x: number, y: number) =>
    clamp(Math.floor(y / VIEW), 0, rows - 1) * cols + clamp(Math.floor(x / VIEW), 0, cols - 1);

  const step = (dt: number) => {
    grid.forEach((cell) => (cell.length = 0));
    for (const boid of boids) grid[cellOf(boid.x, boid.y)].push(boid);

    let px = 0;
    let py = 0;
    if (pointer) {
      const rect = host.getBoundingClientRect();
      px = pointer.clientX - rect.left;
      py = pointer.clientY - rect.top;
    }

    for (const boid of boids) {
      let alignX = 0;
      let alignY = 0;
      let cohereX = 0;
      let cohereY = 0;
      let separateX = 0;
      let separateY = 0;
      let mates = 0;

      const col = Math.floor(boid.x / VIEW);
      const row = Math.floor(boid.y / VIEW);

      for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
        for (let c = Math.max(0, col - 1); c <= Math.min(cols - 1, col + 1); c++) {
          for (const other of grid[r * cols + c]) {
            if (other === boid) continue;
            const dx = other.x - boid.x;
            const dy = other.y - boid.y;
            const dist = Math.hypot(dx, dy);
            if (dist > VIEW || dist === 0) continue;

            if (dist < SEPARATION) {
              separateX -= dx / dist / dist;
              separateY -= dy / dist / dist;
            }

            if (other.flock === boid.flock) {
              alignX += other.vx;
              alignY += other.vy;
              cohereX += other.x;
              cohereY += other.y;
              mates++;
            }
          }
        }
      }

      const steer = (x: number, y: number) => {
        const len = Math.hypot(x, y);
        if (len === 0) return [0, 0];
        return limit((x / len) * MAX_SPEED - boid.vx, (y / len) * MAX_SPEED - boid.vy, MAX_FORCE);
      };

      let ax = 0;
      let ay = 0;

      if (mates > 0) {
        const [alX, alY] = steer(alignX, alignY);
        const [coX, coY] = steer(cohereX / mates - boid.x, cohereY / mates - boid.y);
        ax += alX * ALIGN + coX * COHERE;
        ay += alY * ALIGN + coY * COHERE;
      }

      const [seX, seY] = steer(separateX, separateY);
      ax += seX * SEPARATE;
      ay += seY * SEPARATE;

      if (boid.y < EDGE) ay += (1 - boid.y / EDGE) * TURN;
      else if (boid.y > height - EDGE) ay -= (1 - (height - boid.y) / EDGE) * TURN;

      if (pointer) {
        const dx = boid.x - px;
        const dy = boid.y - py;
        const dist = Math.hypot(dx, dy);
        if (dist < REPEL_RADIUS && dist > 0) {
          const push = (1 - dist / REPEL_RADIUS) * REPEL;
          ax += (dx / dist) * push;
          ay += (dy / dist) * push;
        }
      }

      boid.vx += ax * dt;
      boid.vy += ay * dt;

      const speed = Math.hypot(boid.vx, boid.vy);
      const clamped = clamp(speed, MIN_SPEED, MAX_SPEED);
      boid.vx = (boid.vx / speed) * clamped;
      boid.vy = (boid.vy / speed) * clamped;
    }

    for (const boid of boids) {
      boid.x += boid.vx * dt;
      boid.y = clamp(boid.y + boid.vy * dt, 0, height);

      if (boid.x < -MARGIN) boid.x += width + MARGIN * 2;
      else if (boid.x > width + MARGIN) boid.x -= width + MARGIN * 2;
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, width, viewHeight);
    ctx.globalAlpha = ALPHA;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'round';

    const top = offset - MARGIN;
    const bottom = offset + viewHeight + MARGIN;

    colors.forEach((color, flock) => {
      ctx.beginPath();
      for (const boid of boids) {
        if (boid.flock !== flock || boid.y < top || boid.y > bottom) continue;
        const speed = Math.hypot(boid.vx, boid.vy);
        const cos = boid.vx / speed;
        const sin = boid.vy / speed;
        const x = boid.x;
        const y = boid.y - offset;
        const backX = x - cos * SIZE;
        const backY = y - sin * SIZE;
        const armX = -sin * SIZE * SPREAD;
        const armY = cos * SIZE * SPREAD;

        ctx.moveTo(backX + armX, backY + armY);
        ctx.lineTo(x + cos * SIZE, y + sin * SIZE);
        ctx.lineTo(backX - armX, backY - armY);
      }
      ctx.strokeStyle = color;
      ctx.stroke();
    });
  };

  const place = () => {
    const next = clamp(-host.getBoundingClientRect().top, 0, Math.max(0, height - viewHeight));
    if (next === offset && !dirty) return false;
    offset = next;
    follow.forEach((element) => (element.style.transform = `translate3d(0, ${offset}px, 0)`));
    return true;
  };

  const tick = (now: number) => {
    const dt = Math.min((now - last) / (1000 / 60), 3);
    last = now;

    const moved = place();
    const running = !paused && !hidden;
    if (running) step(dt);
    if (running || moved || dirty) draw();
    dirty = false;

    frame = requestAnimationFrame(tick);
  };

  const run = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!visible || document.hidden) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    pointer = { clientX: event.clientX, clientY: event.clientY };
  };
  const onPointerLeave = () => (pointer = null);
  const onResize = () => resizeView();

  const resizeObserver = new ResizeObserver(() => {
    resizeWorld();
    resizeView();
  });
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  });

  resizeWorld();
  resizeView();
  if (paused) for (let i = 0; i < WARM_UP; i++) step(1);

  resizeObserver.observe(host);
  visibilityObserver.observe(host);
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.documentElement.addEventListener('pointerleave', onPointerLeave);
  document.addEventListener('visibilitychange', run);

  const controller: BoidsController = {
    play: () => (paused = false),
    pause: () => (paused = true),
    toggle: () => (paused = !paused),
    hide: () => (hidden = true),
    show: () => (hidden = false),
    get paused() {
      return paused;
    },
    get hidden() {
      return hidden;
    },
    destroy: () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', run);
    },
  };

  return controller;
};
