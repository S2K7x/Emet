import Phaser from "phaser";
import type { MapData, Prop, Zone } from "../../shared/map.ts";

const INK = 0x141118;
const FONT = "Outfit, system-ui, sans-serif";
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

// Draws the map (universe floors, walls, scenery) in a "toy" style: bright flat colors, thick black outlines.
export function drawMap(scene: Phaser.Scene, map: MapData) {
  const g = scene.add.graphics().setDepth(0);
  const rand = seeded(42); // same scenery for everyone

  for (const z of map.zones) {
    g.fillStyle(hex(z.floor)).fillRect(z.x, z.y, z.w, z.h);
    drawFloorPattern(g, z, rand);
    if (z.id !== "hub") {
      scene.add
        .text(z.labelAt?.[0] ?? z.x + z.w / 2, z.labelAt?.[1] ?? z.y + z.h / 2, z.label, { fontFamily: FONT, fontSize: "120px", fontStyle: "800", color: z.accent })
        .setOrigin(0.5)
        .setAlpha(z.id === "neon" ? 0.35 : 0.45)
        .setDepth(0);
    }
  }
  g.lineStyle(8, INK).strokeRect(0, 0, map.width, map.height);

  const walls = scene.add.graphics().setDepth(1);
  for (const [x, y, w, h] of map.walls) {
    walls.fillStyle(INK).fillRoundedRect(x, y, w, h, 6);
    walls.fillStyle(0x3b3448).fillRoundedRect(x + 4, y + 4, w - 8, Math.max(h - 14, 4), 4);
  }

  const props = scene.add.graphics().setDepth(1);
  for (const p of map.props) drawProp(scene, props, p);
}

function drawFloorPattern(g: Phaser.GameObjects.Graphics, z: Zone, rand: () => number) {
  const accent = hex(z.accent);
  const inside = (pad: number) => [z.x + pad + rand() * (z.w - pad * 2), z.y + pad + rand() * (z.h - pad * 2)];
  switch (z.id) {
    case "lune": // stardust and small craters
      for (let i = 0; i < 70; i++) {
        const [x, y] = inside(10);
        g.fillStyle(accent, 0.6).fillCircle(x, y, 2 + rand() * 3);
      }
      for (let i = 0; i < 8; i++) {
        const [x, y] = inside(40);
        g.lineStyle(3, accent, 0.6).strokeCircle(x, y, 12 + rand() * 14);
      }
      break;
    case "glace": // diagonal glints
      for (let i = 0; i < 26; i++) {
        const [x, y] = inside(30);
        const l = 30 + rand() * 50;
        g.lineStyle(5, 0xffffff, 0.8).lineBetween(x, y, x + l, y - l);
        g.lineStyle(3, accent, 0.5).lineBetween(x + 10, y + 6, x + 10 + l * 0.5, y + 6 - l * 0.5);
      }
      break;
    case "neon": // glowing grid
      g.lineStyle(2, accent, 0.25);
      for (let x = z.x + 40; x < z.x + z.w; x += 80) g.lineBetween(x, z.y, x, z.y + z.h);
      for (let y = z.y + 40; y < z.y + z.h; y += 80) g.lineBetween(z.x, y, z.x + z.w, y);
      for (let i = 0; i < 30; i++) {
        const [x, y] = inside(20);
        g.fillStyle(rand() < 0.5 ? accent : 0x46f0f0, 0.8).fillCircle(x, y, 2.5);
      }
      break;
    case "candy": // sprinkles
      for (let i = 0; i < 140; i++) {
        const [x, y] = inside(10);
        const colors = [0xff6fb5, 0x46c2f0, 0xffd400, 0x7fd63a, 0xffffff];
        const a = rand() * Math.PI;
        g.lineStyle(5, colors[Math.floor(rand() * colors.length)], 0.9).lineBetween(x, y, x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      }
      break;
    case "hub": // portal on the floor
      g.lineStyle(10, accent, 0.5).strokeCircle(z.x + z.w / 2, z.y + z.h / 2, 125);
      g.lineStyle(4, accent, 0.35).strokeCircle(z.x + z.w / 2, z.y + z.h / 2, 150);
      break;
  }
}

function drawProp(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, p: Prop) {
  const { x, y } = p;
  const w = p.w ?? 0;
  const h = p.h ?? 0;
  const r = p.r ?? 0;
  switch (p.type) {
    case "table": // meeting table + big button
      g.fillStyle(0xf6b928).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.fillStyle(0xe03c31).fillCircle(x, y, r * 0.38).lineStyle(4, INK).strokeCircle(x, y, r * 0.38);
      g.fillStyle(0xffffff, 0.6).fillCircle(x - r * 0.12, y - r * 0.14, r * 0.1);
      break;
    case "crater":
      g.fillStyle(0xb9b0d9).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.fillStyle(0x9d93c4).fillCircle(x + r * 0.1, y + r * 0.12, r * 0.72);
      g.fillStyle(0x8a80b3).fillCircle(x + r * 0.18, y + r * 0.2, r * 0.4);
      break;
    case "rocket": {
      const cx = x + w / 2;
      g.fillStyle(0xe03c31).fillTriangle(x - 12, y + h, x + 18, y + h - 50, x + 18, y + h);
      g.fillStyle(0xe03c31).fillTriangle(x + w + 12, y + h, x + w - 18, y + h - 50, x + w - 18, y + h);
      g.fillStyle(0xffffff).fillRoundedRect(x + 12, y + 40, w - 24, h - 40, 14);
      g.fillStyle(0xe03c31).fillTriangle(x + 12, y + 44, x + w - 12, y + 44, cx, y);
      g.lineStyle(5, INK).strokeRoundedRect(x + 12, y + 40, w - 24, h - 40, 14).strokeTriangle(x + 12, y + 44, x + w - 12, y + 44, cx, y);
      g.fillStyle(0x46c2f0).fillCircle(cx, y + 80, 16).lineStyle(4, INK).strokeCircle(cx, y + 80, 16);
      break;
    }
    case "flag":
      g.lineStyle(5, INK).lineBetween(x, y, x, y - 70);
      g.fillStyle(0xf6b928).fillRect(x, y - 70, 46, 30).lineStyle(4, INK).strokeRect(x, y - 70, 46, 30);
      break;
    case "igloo":
      g.fillStyle(0xffffff).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.lineStyle(3, 0x9fd3ec);
      for (const k of [0.75, 0.5, 0.25]) g.strokeCircle(x, y, r * k);
      g.fillStyle(0x2b2530).fillCircle(x, y + r * 0.9, 22);
      break;
    case "iceblock":
      g.fillStyle(0xbfe8f8).fillRoundedRect(x, y, w, h, 10).lineStyle(5, INK).strokeRoundedRect(x, y, w, h, 10);
      g.lineStyle(6, 0xffffff, 0.9).lineBetween(x + 16, y + h - 16, x + w * 0.45, y + 14);
      break;
    case "server":
      g.fillStyle(0x1b1530).fillRoundedRect(x, y, w, h, 8).lineStyle(4, INK).strokeRoundedRect(x, y, w, h, 8);
      for (let ly = y + 16; ly < y + h - 10; ly += 22) {
        g.fillStyle(0x3a3156).fillRect(x + 8, ly, w - 16, 12);
        const leds = scene.add.graphics().setDepth(1);
        leds.fillStyle(Math.random() < 0.5 ? 0x46f0f0 : 0xff4fd8).fillCircle(x + w - 16, ly + 6, 3);
        scene.tweens.add({ targets: leds, alpha: 0.2, duration: 400 + Math.random() * 900, yoyo: true, repeat: -1 });
      }
      break;
    case "arcade":
      g.fillStyle(0x6a4bd6).fillRoundedRect(x, y, w, h, 10).lineStyle(5, INK).strokeRoundedRect(x, y, w, h, 10);
      g.fillStyle(0x46f0f0).fillRoundedRect(x + 14, y + 14, w - 28, h * 0.45, 6).lineStyle(3, INK).strokeRoundedRect(x + 14, y + 14, w - 28, h * 0.45, 6);
      g.fillStyle(0xff4fd8).fillCircle(x + w * 0.35, y + h * 0.78, 8).fillStyle(0xffd400).fillCircle(x + w * 0.65, y + h * 0.78, 8);
      break;
    case "lollipop":
      g.fillStyle(0xff6fb5).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.lineStyle(9, 0xffffff);
      g.beginPath().arc(x, y, r * 0.65, 0, Math.PI * 1.4).strokePath();
      g.beginPath().arc(x, y, r * 0.3, Math.PI, Math.PI * 2.3).strokePath();
      break;
    case "cake":
      g.fillStyle(0xffd6a5).fillRoundedRect(x, y, w, h, 16).lineStyle(5, INK).strokeRoundedRect(x, y, w, h, 16);
      g.fillStyle(0xff8cc0).fillRoundedRect(x + 8, y + 8, w - 16, h * 0.55, 12);
      for (let dx = x + 24; dx < x + w - 10; dx += 30) g.fillCircle(dx, y + h * 0.55 + 6, 11);
      for (const k of [0.3, 0.5, 0.7]) {
        g.fillStyle(0xffffff).fillRect(x + w * k - 4, y + 18, 8, 26);
        g.fillStyle(0xffb000).fillCircle(x + w * k, y + 14, 6);
      }
      break;
  }
}

// Small reproducible pseudo-random generator (mulberry32).
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
