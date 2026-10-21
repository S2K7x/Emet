import type { MapData } from "../../shared/map.ts";

interface Dot {
  x: number;
  y: number;
  color: string;
}

// HTML minimap (2D canvas). Small in the top right, tap = enlarged in the center.
// By default it only shows yourself: showing others would leak info you can't see on screen.
export class Minimap {
  private el = document.getElementById("minimap") as HTMLCanvasElement;
  // Full-screen backdrop under the enlarged map: a tap anywhere closes it (and doesn't move the player).
  private backdrop = document.getElementById("minimap-backdrop")!;
  private ctx = this.el.getContext("2d")!;
  private base?: HTMLCanvasElement; // pre-rendered background (zones, walls, obstacles)
  private big = false;

  constructor(private map: MapData) {
    this.el.style.aspectRatio = `${map.width} / ${map.height}`;
    this.el.onclick = () => this.toggle();
    this.backdrop.onpointerdown = (e) => {
      e.preventDefault();
      this.close();
    };
  }

  show(visible: boolean) {
    this.el.style.display = visible ? "block" : "none";
    if (!visible) this.close();
  }

  toggle() {
    this.big = !this.big;
    this.el.classList.toggle("big", this.big);
    this.backdrop.style.display = this.big ? "block" : "none";
  }

  close() {
    if (this.big) this.toggle();
  }

  draw(me: Dot | undefined, others: Dot[], view: { x: number; y: number; width: number; height: number }) {
    const rect = this.el.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (this.el.width !== w || this.el.height !== h || !this.base) {
      this.el.width = w;
      this.el.height = h;
      this.base = this.renderBase(w, h, dpr);
    }
    const s = w / this.map.width;
    const c = this.ctx;
    c.drawImage(this.base, 0, 0);

    // What the camera is showing right now.
    c.strokeStyle = "rgba(255,255,255,.9)";
    c.lineWidth = 2 * dpr;
    c.strokeRect(view.x * s, view.y * s, view.width * s, view.height * s);

    for (const o of others) this.dot(o, 3 * dpr, 1.5 * dpr);
    if (me) this.dot(me, (this.big ? 7 : 5) * dpr, 2.5 * dpr);
  }

  private dot(d: Dot, r: number, ring: number) {
    const s = this.el.width / this.map.width;
    const c = this.ctx;
    c.beginPath();
    c.arc(d.x * s, d.y * s, r, 0, Math.PI * 2);
    c.fillStyle = d.color;
    c.fill();
    c.lineWidth = ring;
    c.strokeStyle = "#fff";
    c.stroke();
  }

  private renderBase(w: number, h: number, dpr: number) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d")!;
    const s = w / this.map.width;

    for (const z of this.map.zones) {
      c.fillStyle = z.floor;
      c.fillRect(z.x * s, z.y * s, z.w * s, z.h * s);
    }
    c.fillStyle = "rgba(20,17,24,.45)";
    for (const p of this.map.props) {
      if (p.shape === "rect") c.fillRect(p.x * s, p.y * s, p.w! * s, p.h! * s);
      if (p.shape === "circle") {
        c.beginPath();
        c.arc(p.x * s, p.y * s, p.r! * s, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = "#141118";
    for (const [x, y, ww, hh] of this.map.walls) c.fillRect(x * s, y * s, Math.max(ww * s, dpr), Math.max(hh * s, dpr));

    // Zone names, only when it's big enough to read.
    if (w > 300 * dpr) {
      c.font = `800 ${Math.round(w / 28)}px Outfit, system-ui, sans-serif`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      for (const z of this.map.zones) {
        if (z.id === "hub") continue;
        c.fillStyle = z.accent;
        c.fillText(z.label, (z.labelAt?.[0] ?? z.x + z.w / 2) * s, (z.labelAt?.[1] ?? z.y + z.h / 2) * s);
      }
    }
    return canvas;
  }
}
