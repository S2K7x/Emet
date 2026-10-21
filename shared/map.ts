// Map geometry, shared by server and client. The server is authoritative; the client uses it for display and hints.

export interface Zone {
  id: string;
  label: string;
  labelAt?: [number, number]; // defaults to the zone center
  x: number;
  y: number;
  w: number;
  h: number;
  floor: string;
  accent: string;
}

export interface Prop {
  type: string;
  shape?: "rect" | "circle"; // absent = scenery, you walk through it
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
}

// Scenery only (never collides): flat or small, so it never looks like an obstacle.
export interface Decor {
  type: string;
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  w?: number;
  text?: string;
}

export interface MapData {
  name: string;
  width: number;
  height: number;
  spawn: { x: number; y: number; rx: number; ry: number };
  zones: Zone[];
  walls: number[][]; // [x, y, w, h]
  doors?: number[][]; // [x, y, w, h] openings between zones, drawn as portal gates
  decor?: Decor[];
  props: Prop[];
  emergency: { x: number; y: number }; // the big red button
  stations: Station[]; // quest spots
}

export interface Station {
  id: string;
  label: string;
  icon: string;
  game: string; // mini-game type (data/minigames.json)
  x: number;
  y: number;
}

interface Rect { x: number; y: number; w: number; h: number }
interface Circle { x: number; y: number; r: number }

export class MapGeometry {
  readonly rects: Rect[];
  readonly circles: Circle[];

  constructor(readonly data: MapData) {
    this.rects = data.walls.map(([x, y, w, h]) => ({ x, y, w, h }));
    this.circles = [];
    for (const p of data.props) {
      if (p.shape === "rect") this.rects.push({ x: p.x, y: p.y, w: p.w!, h: p.h! });
      if (p.shape === "circle") this.circles.push({ x: p.x, y: p.y, r: p.r! });
    }
  }

  // Places n players in an ellipse around the spawn point.
  spawnPoint(i: number, n: number) {
    const { x, y, rx, ry } = this.data.spawn;
    const a = (i / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
    return this.collide(x + Math.cos(a) * rx, y + Math.sin(a) * ry, 0);
  }

  // Pushes a circle (player) out of walls and obstacles, and keeps it inside the map.
  collide(x: number, y: number, radius: number) {
    for (let pass = 0; pass < 2; pass++) {
      for (const r of this.rects) {
        const cx = clamp(x, r.x, r.x + r.w);
        const cy = clamp(y, r.y, r.y + r.h);
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= radius * radius) continue;
        if (d2 > 0) {
          const d = Math.sqrt(d2);
          x = cx + (dx / d) * radius;
          y = cy + (dy / d) * radius;
        } else {
          // Center inside the rectangle: exit through the nearest side.
          const left = x - r.x, right = r.x + r.w - x, top = y - r.y, bottom = r.y + r.h - y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) x = r.x - radius;
          else if (m === right) x = r.x + r.w + radius;
          else if (m === top) y = r.y - radius;
          else y = r.y + r.h + radius;
        }
      }
      for (const c of this.circles) {
        const dx = x - c.x;
        const dy = y - c.y;
        const d = Math.hypot(dx, dy);
        const min = c.r + radius;
        if (d >= min) continue;
        if (d === 0) {
          y = c.y - min;
        } else {
          x = c.x + (dx / d) * min;
          y = c.y + (dy / d) * min;
        }
      }
    }
    return { x: clamp(x, radius, this.data.width - radius), y: clamp(y, radius, this.data.height - radius) };
  }

  // True if a wall or obstacle cuts segment A→B (no killing or reporting through a wall).
  blocked(ax: number, ay: number, bx: number, by: number) {
    return this.rects.some((r) => segmentHitsRect(ax, ay, bx, by, r)) || this.circles.some((c) => segmentHitsCircle(ax, ay, bx, by, c));
  }

  // In range AND in line of sight.
  reachable(ax: number, ay: number, bx: number, by: number, range: number) {
    return Math.hypot(bx - ax, by - ay) <= range && !this.blocked(ax, ay, bx, by);
  }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Liang–Barsky: does the segment enter the rectangle?
function segmentHitsRect(ax: number, ay: number, bx: number, by: number, r: Rect) {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, ax - r.x],
    [dx, r.x + r.w - ax],
    [-dy, ay - r.y],
    [dy, r.y + r.h - ay],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function segmentHitsCircle(ax: number, ay: number, bx: number, by: number, c: Circle) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((c.x - ax) * dx + (c.y - ay) * dy) / len2, 0, 1);
  return Math.hypot(ax + dx * t - c.x, ay + dy * t - c.y) < c.r;
}
