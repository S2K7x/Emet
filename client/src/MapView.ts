import Phaser from "phaser";
import type { Decor, MapData, Portal, Prop, Zone } from "../../shared/map.ts";
import config from "../../data/game.json";

const INK = 0x141118;
const FONT = "Outfit, system-ui, sans-serif";
const hex = (c: string) => Phaser.Display.Color.HexStringToColor(c).color;

// Light comes from the top left: every shadow falls down-right by the same offset.
const SHADOW = { dx: 8, dy: 12, alpha: 0.22 };

// Layers (players are at depth 2).
const D = { space: -1, floor: 0, decor: 0.2, door: 0.3, shadow: 0.5, solid: 1, weather: 4 };

// Draws the map in a "toy" style: bright flat colors, thick black outlines, one light source.
// The map is an island floating in the multiverse; each zone has its own floor, landmarks and ambient motion.
export function drawMap(scene: Phaser.Scene, map: MapData) {
  const rand = seeded(42); // same scenery for everyone
  makeTextures(scene);
  drawSpace(scene, map, rand);

  for (const z of map.zones) {
    // One layer per zone, in order: a later zone (the hub) covers animated layers of the ones before it.
    const floor = scene.add.graphics().setDepth(D.floor);
    floor.fillStyle(hex(z.floor)).fillRect(z.x, z.y, z.w, z.h);
    drawFloorPattern(scene, floor, z, rand);
  }
  for (const z of map.zones) {
    if (z.id === "hub") continue;
    scene.add
      .text(z.labelAt?.[0] ?? z.x + z.w / 2, z.labelAt?.[1] ?? z.y + z.h / 2, z.label, { fontFamily: FONT, fontSize: "120px", fontStyle: "800", color: z.accent })
      .setOrigin(0.5)
      .setAlpha(z.id === "neon" ? 0.3 : 0.4)
      .setDepth(D.floor);
  }

  const decor = scene.add.graphics().setDepth(D.decor);
  for (const d of map.decor ?? []) drawDecor(scene, decor, d, zoneAt(map, d.x, d.y), rand);

  for (const door of map.doors ?? []) drawDoor(scene, map, door);
  for (const portal of map.portals ?? []) drawPortal(scene, map, portal);

  // Island edge: thick outline and a cliff face under the bottom edge.
  const edge = scene.add.graphics().setDepth(D.floor);
  edge.fillStyle(0x000000, 0.3).fillRect(SHADOW.dx * 2, map.height, map.width, 48);
  edge.fillStyle(0x3a2f52).fillRect(0, map.height, map.width, 30).lineStyle(6, INK).strokeRect(0, map.height, map.width, 30);
  edge.lineStyle(8, INK).strokeRect(0, 0, map.width, map.height);

  // Shadows go on their own layer, under every wall and obstacle, so they never darken a neighbor's top.
  const shadows = scene.add.graphics().setDepth(D.shadow);
  const walls = scene.add.graphics().setDepth(D.solid);
  for (const [x, y, w, h] of map.walls) {
    shadows.fillStyle(0x000000, SHADOW.alpha).fillRoundedRect(x + SHADOW.dx, y + SHADOW.dy, w, h, 8);
    // Top face tinted toward the zone's color, front face (bottom band) in ink: reads as a raised block.
    const z = zoneAt(map, x + w / 2, y + h / 2);
    const top = mix(0x3b3448, z ? hex(z.accent) : 0x3b3448, 0.3);
    walls.fillStyle(INK).fillRoundedRect(x, y, w, h, 6);
    walls.fillStyle(top).fillRoundedRect(x + 4, y + 4, w - 8, Math.max(h - 18, 4), 4);
    walls.fillStyle(mix(top, 0xffffff, 0.25)).fillRoundedRect(x + 4, y + 4, w - 8, 5, { tl: 4, tr: 4, bl: 0, br: 0 });
  }

  const props = scene.add.graphics().setDepth(D.solid);
  for (const p of map.props) drawProp(scene, props, shadows, p);

  drawAmbience(scene, map, rand);
}

function zoneAt(map: MapData, x: number, y: number): Zone | undefined {
  let found: Zone | undefined;
  for (const z of map.zones) if (x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h) found = z; // later zones (hub) win
  return found;
}

function mix(a: number, b: number, t: number) {
  const c = Phaser.Display.Color.Interpolate.ColorWithColor(Phaser.Display.Color.ValueToColor(a), Phaser.Display.Color.ValueToColor(b), 100, t * 100);
  return Phaser.Display.Color.GetColor(c.r, c.g, c.b);
}

// Small textures shared by particles and twinkles.
function makeTextures(scene: Phaser.Scene) {
  if (scene.textures.exists("fx-dot")) return;
  const g = scene.make.graphics({}, false);
  g.fillStyle(0xffffff).fillCircle(4, 4, 4).generateTexture("fx-dot", 8, 8).clear();
  g.lineStyle(3, 0xffffff).strokeCircle(10, 10, 8).fillStyle(0xffffff, 0.8).fillCircle(7, 7, 2.5).generateTexture("fx-bubble", 20, 20).clear();
  g.fillStyle(0xffffff)
    .fillPoints([{ x: 8, y: 0 }, { x: 10, y: 6 }, { x: 16, y: 8 }, { x: 10, y: 10 }, { x: 8, y: 16 }, { x: 6, y: 10 }, { x: 0, y: 8 }, { x: 6, y: 6 }], true)
    .generateTexture("fx-star", 16, 16);
  g.destroy();
}

// Deep space around the island (visible at the camera margins).
function drawSpace(scene: Phaser.Scene, map: MapData, rand: () => number) {
  const g = scene.add.graphics().setDepth(D.space);
  const m = 700;
  g.fillStyle(0x221a38).fillRect(-m, -m, map.width + m * 2, map.height + m * 2);
  for (let i = 0; i < 260; i++) {
    const x = -m + rand() * (map.width + m * 2);
    const y = -m + rand() * (map.height + m * 2);
    g.fillStyle([0xffffff, 0xff8cc0, 0x9fd3ec, 0xf6b928][Math.floor(rand() * 4)], 0.4 + rand() * 0.5).fillCircle(x, y, 1 + rand() * 2.2);
  }
}

function drawFloorPattern(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, z: Zone, rand: () => number) {
  const floor = hex(z.floor);
  const accent = hex(z.accent);
  const inside = (pad: number) => [z.x + pad + rand() * (z.w - pad * 2), z.y + pad + rand() * (z.h - pad * 2)];
  switch (z.id) {
    case "lune": // soft regolith patches, stardust, small craters
      for (let i = 0; i < 36; i++) {
        const [x, y] = inside(40);
        g.fillStyle(mix(floor, accent, 0.35), 0.45).fillEllipse(x, y, 60 + rand() * 90, 40 + rand() * 50);
      }
      for (let i = 0; i < 70; i++) {
        const [x, y] = inside(10);
        g.fillStyle(accent, 0.6).fillCircle(x, y, 2 + rand() * 3);
      }
      for (let i = 0; i < 10; i++) {
        const [x, y] = inside(40);
        const r = 10 + rand() * 14;
        g.fillStyle(mix(floor, accent, 0.5)).fillCircle(x + 2, y + 3, r);
        g.lineStyle(3, accent, 0.8).strokeCircle(x, y, r);
      }
      break;
    case "glace": // staggered ice plates + glints
      for (let row = 0, y = z.y; y < z.y + z.h; row++, y += 110) {
        for (let x = z.x - (row % 2) * 70; x < z.x + z.w; x += 140) {
          g.lineStyle(2, 0xffffff, 0.7).strokeRect(Math.max(x, z.x), y, Math.min(140, z.x + z.w - Math.max(x, z.x)), 110);
        }
      }
      for (let i = 0; i < 18; i++) {
        const [x, y] = inside(30);
        const l = 30 + rand() * 50;
        g.lineStyle(5, 0xffffff, 0.8).lineBetween(x, y, x + l, y - l);
        g.lineStyle(3, accent, 0.5).lineBetween(x + 10, y + 6, x + 10 + l * 0.5, y + 6 - l * 0.5);
      }
      break;
    case "neon": { // glowing grid (pulses) and scattered LEDs
      const grid = scene.add.graphics().setDepth(D.floor);
      grid.lineStyle(6, accent, 0.08);
      for (let x = z.x + 40; x < z.x + z.w; x += 80) grid.lineBetween(x, z.y, x, z.y + z.h);
      for (let y = z.y + 40; y < z.y + z.h; y += 80) grid.lineBetween(z.x, y, z.x + z.w, y);
      grid.lineStyle(2, accent, 0.3);
      for (let x = z.x + 40; x < z.x + z.w; x += 80) grid.lineBetween(x, z.y, x, z.y + z.h);
      for (let y = z.y + 40; y < z.y + z.h; y += 80) grid.lineBetween(z.x, y, z.x + z.w, y);
      scene.tweens.add({ targets: grid, alpha: 0.45, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      for (let i = 0; i < 30; i++) {
        const [x, y] = inside(20);
        g.fillStyle(rand() < 0.5 ? accent : 0x46f0f0, 0.8).fillCircle(x, y, 2.5);
      }
      break;
    }
    case "candy": // candy checkerboard + sprinkles
      for (let y = z.y, r = 0; y < z.y + z.h; y += 100, r++) {
        for (let x = z.x + (r % 2) * 100; x < z.x + z.w; x += 200) g.fillStyle(0xffffff, 0.35).fillRect(x, y, 100, 100);
      }
      for (let i = 0; i < 140; i++) {
        const [x, y] = inside(10);
        const colors = [0xff6fb5, 0x46c2f0, 0xffd400, 0x7fd63a, 0xffffff];
        const a = rand() * Math.PI;
        g.lineStyle(5, colors[Math.floor(rand() * colors.length)], 0.9).lineBetween(x, y, x + Math.cos(a) * 10, y + Math.sin(a) * 10);
      }
      break;
    case "hub": { // tiled plaza, portal seal on the floor with rotating rings
      const cx = z.x + z.w / 2;
      const cy = z.y + z.h / 2;
      for (let y = z.y; y < z.y + z.h; y += 40) {
        for (let x = z.x; x < z.x + z.w; x += 40) if (((x - z.x) / 40 + (y - z.y) / 40) % 2 === 0) g.fillStyle(accent, 0.08).fillRect(x, y, 40, 40);
      }
      g.fillStyle(0xffffff, 0.6).fillCircle(cx, cy, 160);
      g.fillStyle(accent, 0.12).fillCircle(cx, cy, 160);
      for (const [r, dash, w, speed] of [[150, 18, 6, 40000], [125, 10, 10, -26000], [100, 30, 4, 18000]]) {
        const ring = scene.add.graphics({ x: cx, y: cy }).setDepth(D.floor);
        const n = Math.round((Math.PI * 2 * r) / (dash * 2));
        ring.lineStyle(w, accent, 0.6);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          ring.beginPath().arc(0, 0, r, a, a + (dash / r)).strokePath();
        }
        scene.tweens.add({ targets: ring, angle: speed > 0 ? 360 : -360, duration: Math.abs(speed), repeat: -1 });
      }
      break;
    }
  }
}

// Openings between zones: a shimmering portal threshold blending the two zones' colors.
function drawDoor(scene: Phaser.Scene, map: MapData, [x, y, w, h]: number[]) {
  const across = w > h; // gap in a horizontal wall = you walk through it vertically
  const cx = x + w / 2;
  const cy = y + h / 2;
  const a = zoneAt(map, across ? cx : x - 30, across ? y - 30 : cy);
  const b = zoneAt(map, across ? cx : x + w + 30, across ? y + h + 30 : cy);
  const ca = hex(a?.accent ?? "#ffffff");
  const cb = hex(b?.accent ?? "#ffffff");
  const g = scene.add.graphics().setDepth(D.door);
  if (across) g.fillGradientStyle(ca, ca, cb, cb, 0.7);
  else g.fillGradientStyle(ca, cb, ca, cb, 0.7);
  g.fillRect(x, y, w, h);
  // Chevrons in both directions.
  g.lineStyle(4, 0xffffff, 0.9);
  for (const s of [-1, 1]) {
    const px = across ? cx + s * w * 0.25 : cx;
    const py = across ? cy : cy + s * h * 0.25;
    if (across) g.lineBetween(px - 8, py - 6, px, py + 4).lineBetween(px, py + 4, px + 8, py - 6);
    else g.lineBetween(px - 6, py - 8, px + 4, py).lineBetween(px + 4, py, px - 6, py + 8);
  }
  scene.tweens.add({ targets: g, alpha: 0.45, duration: 900 + Math.random() * 400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
}

// Portal pad: a swirling ring in the pair's color, labeled with where it leads.
function drawPortal(scene: Phaser.Scene, map: MapData, p: Portal) {
  const r = config.portal.radius;
  const color = hex(p.color);
  const pad = scene.add.graphics().setDepth(D.door);
  pad.fillStyle(0x000000, 0.25).fillEllipse(p.x + 4, p.y + 6, r * 2.3, r * 1.5);
  pad.fillStyle(INK).fillEllipse(p.x, p.y, r * 2.3, r * 1.5);
  pad.fillStyle(color).fillEllipse(p.x, p.y, r * 2.3 - 10, r * 1.5 - 10);
  pad.fillStyle(mix(color, 0xffffff, 0.55)).fillEllipse(p.x, p.y, r * 1.1, r * 0.7);
  const swirl = scene.add.graphics({ x: p.x, y: p.y }).setDepth(D.door).setScale(1, 0.65);
  swirl.lineStyle(4, 0xffffff, 0.85);
  for (let i = 0; i < 3; i++) swirl.beginPath().arc(0, 0, r * 0.75, (i * Math.PI * 2) / 3, (i * Math.PI * 2) / 3 + 1.1).strokePath();
  scene.tweens.add({ targets: swirl, angle: 360, duration: 2600, repeat: -1 });
  const pair = map.portals?.find((q) => q.id === p.pair);
  const to = pair && zoneAt(map, pair.x, pair.y);
  if (to) {
    scene.add
      .text(p.x, p.y + r + 6, `🌌 ${to.label}`, { fontFamily: FONT, fontSize: "18px", fontStyle: "800", color: "#ffffff", stroke: "#141118", strokeThickness: 5 })
      .setOrigin(0.5, 0)
      .setDepth(D.door);
  }
}

function drawDecor(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, d: Decor, z: Zone | undefined, rand: () => number) {
  const { x, y } = d;
  const accent = hex(z?.accent ?? "#ffffff");
  const floor = hex(z?.floor ?? "#ffffff");
  switch (d.type) {
    case "footprints": { // boot prints from the rocket to the flag
      const x2 = d.x2 ?? x, y2 = d.y2 ?? y;
      const len = Math.hypot(x2 - x, y2 - y);
      const ux = (x2 - x) / len, uy = (y2 - y) / len;
      for (let t = 0, i = 0; t < len; t += 30, i++) {
        const side = i % 2 ? 9 : -9;
        g.fillStyle(mix(floor, INK, 0.25), 0.6).fillEllipse(x + ux * t - uy * side, y + uy * t + ux * side, 13, 9);
      }
      break;
    }
    case "rock": {
      const r = 10 + rand() * 8;
      g.fillStyle(0x000000, 0.15).fillEllipse(x + 4, y + r * 0.7, r * 2.2, r * 0.8);
      g.fillStyle(mix(accent, 0xffffff, 0.2)).fillCircle(x, y, r).lineStyle(3, INK).strokeCircle(x, y, r);
      g.fillStyle(mix(accent, INK, 0.2)).fillCircle(x + r * 0.3, y + r * 0.3, r * 0.35);
      break;
    }
    case "earth": { // hologram of home, slowly pulsing
      const e = scene.add.graphics({ x, y }).setDepth(D.decor);
      e.fillStyle(0x46c2f0).fillCircle(0, 0, 34).fillStyle(0x7fd63a).fillEllipse(-10, -8, 26, 18).fillEllipse(12, 12, 18, 14);
      e.lineStyle(4, INK).strokeCircle(0, 0, 34).lineStyle(3, 0xffffff, 0.6).strokeCircle(0, 0, 44);
      scene.tweens.add({ targets: e, alpha: 0.6, scale: 1.06, duration: 2200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      break;
    }
    case "crack": {
      const pts = [[0, 0], [24, 10], [38, -6], [62, 6], [84, -4]];
      g.lineStyle(4, 0x6fb6d8, 0.8).beginPath().moveTo(x, y);
      for (const [px, py] of pts) g.lineTo(x + px, y + py);
      g.strokePath();
      g.lineStyle(3, 0x6fb6d8, 0.8).lineBetween(x + 38, y - 6, x + 46, y - 26);
      break;
    }
    case "fishhole": {
      g.fillStyle(0xffffff).fillEllipse(x, y, 76, 40).lineStyle(4, INK).strokeEllipse(x, y, 76, 40);
      g.fillStyle(0x1f5f8b).fillEllipse(x, y + 2, 60, 28);
      g.fillStyle(0xff8c42).fillTriangle(x + 6, y - 2, x + 22, y - 14, x + 22, y + 8).lineStyle(3, INK).strokeTriangle(x + 6, y - 2, x + 22, y - 14, x + 22, y + 8);
      break;
    }
    case "snowpile":
      for (const [dx, dy, r] of [[-30, 6, 22], [0, 0, 30], [32, 8, 20]]) g.fillStyle(0xffffff).fillCircle(x + dx, y + dy, r);
      g.lineStyle(3, 0x9fd3ec).beginPath().arc(x, y, 30, Math.PI * 1.1, Math.PI * 1.9).strokePath();
      break;
    case "penguin": { // small idle penguin, waddles in place
      const p = scene.add.graphics({ x, y }).setDepth(D.decor);
      p.fillStyle(0x000000, 0.15).fillEllipse(0, 16, 30, 8);
      p.fillStyle(0x2b2530).fillEllipse(0, 0, 28, 36).fillStyle(0xffffff).fillEllipse(0, 4, 18, 24);
      p.fillStyle(0xffffff).fillCircle(-5, -8, 3.5).fillCircle(5, -8, 3.5).fillStyle(INK).fillCircle(-5, -8, 1.8).fillCircle(5, -8, 1.8);
      p.fillStyle(0xff9f1c).fillTriangle(-4, -3, 4, -3, 0, 3).fillEllipse(-6, 17, 10, 5).fillEllipse(6, 17, 10, 5);
      scene.tweens.add({ targets: p, angle: { from: -6, to: 6 }, duration: 700 + rand() * 300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      break;
    }
    case "cable": {
      const x2 = d.x2 ?? x, y2 = d.y2 ?? y;
      const curve = new Phaser.Curves.QuadraticBezier(new Phaser.Math.Vector2(x, y), new Phaser.Math.Vector2((x + x2) / 2, Math.max(y, y2) + 90), new Phaser.Math.Vector2(x2, y2));
      g.lineStyle(9, 0x0d0a18);
      curve.draw(g, 32);
      g.lineStyle(2, accent, 0.6);
      curve.draw(g, 32);
      break;
    }
    case "puddle": { // reflective puddle that shimmers
      const p = scene.add.graphics({ x, y }).setDepth(D.decor);
      p.fillStyle(0x46f0f0, 0.18).fillEllipse(0, 0, 130, 60).fillStyle(accent, 0.15).fillEllipse(14, 6, 80, 34);
      p.lineStyle(3, 0x46f0f0, 0.5).lineBetween(-30, -8, 4, -8).lineBetween(-10, 8, 30, 8);
      scene.tweens.add({ targets: p, alpha: 0.5, duration: 1300, yoyo: true, repeat: -1 });
      break;
    }
    case "hazard": {
      const w = d.w ?? 100;
      g.fillStyle(0xffd400).fillRect(x, y, w, 18);
      for (let sx = x; sx < x + w; sx += 24) g.fillStyle(INK).fillTriangle(sx, y + 18, sx + 12, y, sx + 18, y).fillTriangle(sx, y + 18, sx + 18, y, sx + 6, y + 18);
      break;
    }
    case "manhole":
      g.fillStyle(0x15102a).fillCircle(x, y, 28).lineStyle(4, 0x3a3156).strokeCircle(x, y, 28);
      g.lineStyle(3, 0x3a3156);
      for (const k of [-12, 0, 12]) g.lineBetween(x - 22, y + k, x + 22, y + k);
      break;
    case "neonsign": { // flickering neon text painted on the floor
      const t = scene.add
        .text(x, y, d.text ?? "", { fontFamily: FONT, fontSize: "44px", fontStyle: "800", color: "#ffd6f5" })
        .setOrigin(0.5)
        .setShadow(0, 0, "#ff4fd8", 18, true, true)
        .setDepth(D.decor);
      scene.time.addEvent({
        delay: 140,
        loop: true,
        callback: () => t.setAlpha(Math.random() < 0.07 ? 0.25 : 1),
      });
      break;
    }
    case "donut":
      g.fillStyle(0xc98a4b).fillCircle(x, y, 40).lineStyle(4, INK).strokeCircle(x, y, 40);
      g.fillStyle(0xff8cc0).fillCircle(x, y, 33);
      g.fillStyle(floor).fillCircle(x, y, 13).lineStyle(4, INK).strokeCircle(x, y, 13);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + rand();
        const r = 18 + rand() * 10;
        g.lineStyle(4, [0xffffff, 0x46c2f0, 0xffd400][i % 3]).lineBetween(x + Math.cos(a) * r, y + Math.sin(a) * r, x + Math.cos(a + 0.2) * r, y + Math.sin(a + 0.2) * r);
      }
      break;
    case "drip":
      g.fillStyle(0x6b3a1f).fillEllipse(x, y, 110, 50).fillEllipse(x + 40, y - 14, 40, 26).fillEllipse(x - 46, y + 10, 30, 20);
      g.fillStyle(0xffffff, 0.35).fillEllipse(x - 20, y - 8, 30, 8);
      break;
    case "gumdrop": {
      const c = [0x7fd63a, 0xff6fb5, 0x46c2f0, 0xffd400][Math.floor(rand() * 4)];
      g.fillStyle(0x000000, 0.15).fillEllipse(x + 4, y + 10, 34, 10);
      g.fillStyle(c).fillRoundedRect(x - 15, y - 14, 30, 26, { tl: 14, tr: 14, bl: 4, br: 4 }).lineStyle(3, INK).strokeRoundedRect(x - 15, y - 14, 30, 26, { tl: 14, tr: 14, bl: 4, br: 4 });
      g.fillStyle(0xffffff, 0.8).fillCircle(x - 6, y - 6, 2).fillCircle(x + 4, y - 2, 2).fillCircle(x - 2, y + 5, 2);
      break;
    }
    case "cookie":
      g.fillStyle(0xe8b26a).fillCircle(x, y, 32).lineStyle(4, INK).strokeCircle(x, y, 32);
      g.fillStyle(0x5a3b22);
      for (const [dx, dy] of [[-12, -10], [10, -14], [14, 8], [-6, 12], [0, -1]]) g.fillCircle(x + dx, y + dy, 5);
      break;
    case "plant":
      g.fillStyle(0x000000, 0.15).fillEllipse(x + 4, y + 16, 34, 10);
      g.fillStyle(0x2bb24c);
      for (const a of [-0.9, -0.3, 0.3, 0.9]) g.fillEllipse(x + Math.sin(a) * 14, y - 10 - Math.cos(a) * 10, 12, 26);
      g.fillStyle(0xd9773b).fillRoundedRect(x - 13, y - 4, 26, 22, 5).lineStyle(3, INK).strokeRoundedRect(x - 13, y - 4, 26, 22, 5);
      break;
  }
}

function drawProp(scene: Phaser.Scene, g: Phaser.GameObjects.Graphics, sh: Phaser.GameObjects.Graphics, p: Prop) {
  const { x, y } = p;
  const w = p.w ?? 0;
  const h = p.h ?? 0;
  const r = p.r ?? 0;
  sh.fillStyle(0x000000, SHADOW.alpha);
  if (p.shape === "circle") sh.fillCircle(x + SHADOW.dx, y + SHADOW.dy, r);
  if (p.shape === "rect") sh.fillRoundedRect(x + SHADOW.dx, y + SHADOW.dy, w, h, 10);
  switch (p.type) {
    case "table": // meeting table + big button
      g.fillStyle(0xd99a1e).fillCircle(x, y + 6, r).lineStyle(5, INK).strokeCircle(x, y + 6, r);
      g.fillStyle(0xf6b928).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.fillStyle(0xa8251d).fillCircle(x, y + 4, r * 0.38);
      g.fillStyle(0xe03c31).fillCircle(x, y, r * 0.38).lineStyle(4, INK).strokeCircle(x, y, r * 0.38);
      g.fillStyle(0xffffff, 0.6).fillCircle(x - r * 0.12, y - r * 0.14, r * 0.1);
      break;
    case "crater":
      g.fillStyle(0xb9b0d9).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.fillStyle(0x9d93c4).fillCircle(x + r * 0.1, y + r * 0.12, r * 0.72);
      g.fillStyle(0x8a80b3).fillCircle(x + r * 0.18, y + r * 0.2, r * 0.4);
      g.fillStyle(0xffffff, 0.5).fillEllipse(x - r * 0.45, y - r * 0.55, r * 0.5, r * 0.2);
      break;
    case "rocket": {
      const cx = x + w / 2;
      g.fillStyle(0xe03c31).fillTriangle(x - 12, y + h, x + 18, y + h - 50, x + 18, y + h);
      g.fillStyle(0xe03c31).fillTriangle(x + w + 12, y + h, x + w - 18, y + h - 50, x + w - 18, y + h);
      g.fillStyle(0xffffff).fillRoundedRect(x + 12, y + 40, w - 24, h - 40, 14);
      g.fillStyle(0xdcd6ea).fillRoundedRect(cx + 6, y + 40, w / 2 - 18, h - 40, { tl: 0, tr: 14, bl: 0, br: 14 });
      g.fillStyle(0xe03c31).fillTriangle(x + 12, y + 44, x + w - 12, y + 44, cx, y);
      g.lineStyle(5, INK).strokeRoundedRect(x + 12, y + 40, w - 24, h - 40, 14).strokeTriangle(x + 12, y + 44, x + w - 12, y + 44, cx, y);
      g.fillStyle(0x46c2f0).fillCircle(cx, y + 80, 16).lineStyle(4, INK).strokeCircle(cx, y + 80, 16);
      g.fillStyle(0xffffff, 0.8).fillCircle(cx - 5, y + 75, 4);
      // Idle exhaust puffs.
      const puff = scene.add.particles(cx, y + h + 6, "fx-dot", {
        speedY: { min: 10, max: 30 }, speedX: { min: -20, max: 20 }, scale: { start: 1.6, end: 3.5 },
        alpha: { start: 0.5, end: 0 }, lifespan: 1400, frequency: 220, tint: [0xffffff, 0xffd400],
      });
      puff.setDepth(D.shadow);
      break;
    }
    case "flag":
      sh.fillStyle(0x000000, SHADOW.alpha).fillEllipse(x + 4, y + 2, 20, 8);
      g.lineStyle(5, INK).lineBetween(x, y, x, y - 70);
      g.fillStyle(0xf6b928).fillRect(x, y - 70, 46, 30).lineStyle(4, INK).strokeRect(x, y - 70, 46, 30);
      g.fillStyle(0xffffff).fillCircle(x + 23, y - 55, 7);
      break;
    case "igloo":
      g.fillStyle(0xffffff).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.fillStyle(0xe2f3fb).fillCircle(x + r * 0.15, y + r * 0.15, r * 0.8);
      g.lineStyle(3, 0x9fd3ec);
      for (const k of [0.75, 0.5, 0.25]) g.strokeCircle(x, y, r * k);
      for (let a = 0; a < 6; a++) g.lineBetween(x + Math.cos(a) * r * 0.25, y + Math.sin(a) * r * 0.25, x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95);
      g.fillStyle(0x2b2530).fillCircle(x, y + r * 0.9, 22);
      break;
    case "iceblock":
      g.fillStyle(0x8fcfe8).fillRoundedRect(x, y + 10, w, h - 10, 10);
      g.fillStyle(0xbfe8f8).fillRoundedRect(x, y, w, h - 14, 10).lineStyle(5, INK).strokeRoundedRect(x, y, w, h, 10);
      g.lineStyle(6, 0xffffff, 0.9).lineBetween(x + 16, y + h - 26, x + w * 0.45, y + 14);
      g.lineStyle(4, 0xffffff, 0.6).lineBetween(x + w * 0.55, y + h - 30, x + w * 0.75, y + 18);
      break;
    case "server":
      g.fillStyle(0x1b1530).fillRoundedRect(x, y, w, h, 8).lineStyle(4, INK).strokeRoundedRect(x, y, w, h, 8);
      g.fillStyle(0x2a2246).fillRect(x + 4, y + 4, w - 8, 6);
      for (let ly = y + 16; ly < y + h - 10; ly += 22) {
        g.fillStyle(0x3a3156).fillRect(x + 8, ly, w - 16, 12);
        const leds = scene.add.graphics().setDepth(D.solid);
        leds.fillStyle(Math.random() < 0.5 ? 0x46f0f0 : 0xff4fd8).fillCircle(x + w - 16, ly + 6, 3);
        scene.tweens.add({ targets: leds, alpha: 0.2, duration: 400 + Math.random() * 900, yoyo: true, repeat: -1 });
      }
      break;
    case "arcade": {
      g.fillStyle(0x4a2fb0).fillRoundedRect(x, y, w, h, 10);
      g.fillStyle(0x6a4bd6).fillRoundedRect(x, y, w, h - 12, 10).lineStyle(5, INK).strokeRoundedRect(x, y, w, h, 10);
      g.fillStyle(0xff4fd8).fillCircle(x + w * 0.35, y + h * 0.74, 8).fillStyle(0xffd400).fillCircle(x + w * 0.65, y + h * 0.74, 8);
      // Screen with a looping glow.
      const screen = scene.add.graphics().setDepth(D.solid);
      screen.fillStyle(0x46f0f0).fillRoundedRect(x + 14, y + 14, w - 28, h * 0.42, 6).lineStyle(3, INK).strokeRoundedRect(x + 14, y + 14, w - 28, h * 0.42, 6);
      screen.fillStyle(0xffffff).fillRect(x + 24, y + 26, 10, 10).fillStyle(0xff4fd8).fillRect(x + w - 40, y + 30, 12, 12);
      scene.tweens.add({ targets: screen, alpha: 0.65, duration: 500 + Math.random() * 400, yoyo: true, repeat: -1 });
      break;
    }
    case "lollipop":
      g.fillStyle(0xd94c94).fillCircle(x + 4, y + 6, r);
      g.fillStyle(0xff6fb5).fillCircle(x, y, r).lineStyle(5, INK).strokeCircle(x, y, r);
      g.lineStyle(9, 0xffffff);
      g.beginPath().arc(x, y, r * 0.65, 0, Math.PI * 1.4).strokePath();
      g.beginPath().arc(x, y, r * 0.3, Math.PI, Math.PI * 2.3).strokePath();
      g.fillStyle(0xffffff, 0.7).fillEllipse(x - r * 0.45, y - r * 0.5, r * 0.4, r * 0.22);
      break;
    case "cake":
      g.fillStyle(0xe0b384).fillRoundedRect(x, y + 12, w, h - 12, 16);
      g.fillStyle(0xffd6a5).fillRoundedRect(x, y, w, h - 16, 16).lineStyle(5, INK).strokeRoundedRect(x, y, w, h, 16);
      g.fillStyle(0xff8cc0).fillRoundedRect(x + 8, y + 8, w - 16, h * 0.5, 12);
      for (let dx = x + 24; dx < x + w - 10; dx += 30) g.fillCircle(dx, y + h * 0.5 + 6, 11);
      for (const k of [0.3, 0.5, 0.7]) {
        g.fillStyle(0xffffff).fillRect(x + w * k - 4, y + 18, 8, 26);
        const flame = scene.add.graphics().setDepth(D.solid);
        flame.fillStyle(0xffb000).fillEllipse(x + w * k, y + 12, 10, 14).fillStyle(0xffffff).fillCircle(x + w * k, y + 14, 2.5);
        scene.tweens.add({ targets: flame, alpha: 0.6, duration: 160 + Math.random() * 120, yoyo: true, repeat: -1 });
      }
      break;
  }
}

// Ambient motion per zone: twinkling stars, snowfall, neon motes, candy bubbles.
function drawAmbience(scene: Phaser.Scene, map: MapData, rand: () => number) {
  for (const z of map.zones) {
    const area = new Phaser.Geom.Rectangle(z.x, z.y, z.w, z.h);
    switch (z.id) {
      case "lune":
        for (let i = 0; i < 22; i++) {
          const s = scene.add.image(z.x + rand() * z.w, z.y + rand() * z.h, "fx-star").setTint(0xffffff).setDepth(D.decor).setScale(0.6 + rand() * 0.8);
          scene.tweens.add({ targets: s, alpha: 0.1, scale: 0.3, duration: 900 + rand() * 1600, delay: rand() * 2000, yoyo: true, repeat: -1 });
        }
        break;
      case "glace":
        scene.add
          .particles(0, 0, "fx-dot", {
            emitZone: { type: "random", source: area as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource, quantity: 1 },
            speedY: { min: 18, max: 45 }, speedX: { min: -14, max: 14 }, scale: { min: 0.4, max: 1 },
            alpha: { start: 0.9, end: 0 }, lifespan: 6000, frequency: 110,
          })
          .setDepth(D.weather);
        break;
      case "neon":
        scene.add
          .particles(0, 0, "fx-dot", {
            emitZone: { type: "random", source: area as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource, quantity: 1 },
            speedY: { min: -25, max: -8 }, scale: { start: 0.8, end: 0.2 }, alpha: { start: 0.9, end: 0 },
            tint: [0xff4fd8, 0x46f0f0], lifespan: 4000, frequency: 160, blendMode: "ADD",
          })
          .setDepth(D.decor);
        break;
      case "candy":
        scene.add
          .particles(0, 0, "fx-bubble", {
            emitZone: { type: "random", source: area as unknown as Phaser.Types.GameObjects.Particles.RandomZoneSource, quantity: 1 },
            speedY: { min: -30, max: -12 }, speedX: { min: -8, max: 8 }, scale: { min: 0.6, max: 1.4 },
            alpha: { start: 0.6, end: 0 }, tint: [0xff6fb5, 0xffffff, 0x46c2f0], lifespan: 5000, frequency: 260,
          })
          .setDepth(D.weather);
        break;
    }
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
