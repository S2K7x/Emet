import Phaser from "phaser";
import type { BodyView, Look, PlayerView, ServerMsg } from "../../shared/protocol.ts";
import type { Net } from "./net.ts";
import { MeetingUi } from "./MeetingUi.ts";
import { avatarSvg, TEXTURE_BOX, textureSvg } from "./avatar.ts";
import roles from "../../data/roles.json";
import mapData from "../../data/map.json";
import { MapGeometry, type MapData } from "../../shared/map.ts";
import { drawMap } from "./MapView.ts";
import { Minimap } from "./Minimap.ts";
import config from "../../data/game.json";

const map = new MapGeometry(mapData as MapData);

type Joined = Extract<ServerMsg, { t: "joined" }>;
type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;

// Other players are drawn slightly behind so we can interpolate between two snapshots.
const INTERP_DELAY_MS = 100;

const INK = 0x141118;
const FONT = "Outfit, system-ui, sans-serif";

// Character art (see avatar.ts): center of the feet in the SVG box, and on-screen height in player radii.
const FEET = { x: 103, y: 214 };
const HEIGHT_IN_RADII = 3;
// Textures are rasterized larger than shown so they stay sharp on high-DPI screens.
const OVERSAMPLE = 3;

interface Avatar {
  body: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Container; // flipped to face the walking direction
  label: Phaser.GameObjects.Text;
  lastX: number;
}

const $ = (id: string) => document.getElementById(id)!;

export class GameScene extends Phaser.Scene {
  private snapshots: { local: number; players: Map<string, PlayerView> }[] = [];
  private latest?: Snapshot;
  private avatars = new Map<string, Avatar>();
  private corpses = new Map<string, Phaser.GameObjects.GameObject[]>();
  private pendingTextures = new Map<string, (() => void)[]>();
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private lastSent = { dx: 0, dy: 0 };
  private meetingUi: MeetingUi;
  private lastPhase?: string;
  private revealed = ""; // last role shown full screen
  private minimap = new Minimap(map.data);

  constructor(private net: Net, private joined: Joined) {
    super("game");
    this.meetingUi = new MeetingUi(net, joined.you);
  }

  create() {
    const { width, height } = this.joined.map;
    this.cameras.main.setBackgroundColor("#221a38");
    drawMap(this, map.data);
    this.cameras.main.setBounds(-200, -200, width + 400, height + 400);

    this.keys = this.input.keyboard!.addKeys({
      up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT", w: "W", a: "A", s: "S", d: "D",
    }) as typeof this.keys;
    this.input.keyboard!.on("keydown-SPACE", () => this.net.send({ t: "kill" }));

    $("start").onclick = () => this.net.send({ t: "start" });
    $("kill").onclick = () => this.net.send({ t: "kill" });
    $("report").onclick = () => this.net.send({ t: "report" });
    $("rv-go").onclick = () => ($("reveal").style.display = "none");
    this.input.keyboard!.on("keydown-R", () => this.net.send({ t: "report" }));
    this.input.keyboard!.on("keydown-M", () => this.minimap.toggle());
    this.minimap.show(config.minimap.enabled);

    this.net.onMessage = (msg) => {
      if (msg.t === "snapshot") this.pushSnapshot(msg);
      else if (msg.t === "chat") this.meetingUi.addChat(msg);
    };
  }

  private pushSnapshot(msg: Snapshot) {
    this.latest = msg;
    this.snapshots.push({ local: performance.now(), players: new Map(msg.players.map((p) => [p.id, p])) });
    if (this.snapshots.length > 20) this.snapshots.shift();
    this.syncCorpses(msg.bodies);
    this.meetingUi.remember(msg);
    this.meetingUi.update(msg);
    // Phase change: the server reset all intents, so we'll resend ours.
    if (msg.phase !== this.lastPhase) this.lastSent = { dx: NaN, dy: NaN };
    this.lastPhase = msg.phase;
    this.updateUi(msg);
  }

  update() {
    this.sendInput();
    this.render();
  }

  private sendInput() {
    const k = this.keys;
    let dx = (k.right.isDown || k.d.isDown ? 1 : 0) - (k.left.isDown || k.a.isDown ? 1 : 0);
    let dy = (k.down.isDown || k.s.isDown ? 1 : 0) - (k.up.isDown || k.w.isDown ? 1 : 0);

    // Touch / mouse: hold down = move toward the finger.
    const ptr = this.input.activePointer;
    if (ptr.isDown && dx === 0 && dy === 0) {
      const me = this.avatars.get(this.joined.you);
      if (me) {
        const world = ptr.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
        const vx = world.x - me.body.x;
        const vy = world.y - me.body.y;
        const len = Math.hypot(vx, vy);
        if (len > this.joined.radius) {
          dx = vx / len;
          dy = vy / len;
        }
      }
    }

    // Only send when the intent changes.
    if (this.latest?.phase === "meeting") return;
    if (Number.isNaN(this.lastSent.dx) || Math.abs(dx - this.lastSent.dx) > 0.05 || Math.abs(dy - this.lastSent.dy) > 0.05) {
      this.lastSent = { dx, dy };
      this.net.send({ t: "input", dx, dy });
    }
  }

  private render() {
    if (this.snapshots.length === 0) return;
    const target = performance.now() - INTERP_DELAY_MS;

    let a = this.snapshots[0];
    let b = this.snapshots[this.snapshots.length - 1];
    for (let i = 0; i < this.snapshots.length - 1; i++) {
      if (this.snapshots[i].local <= target && this.snapshots[i + 1].local >= target) {
        a = this.snapshots[i];
        b = this.snapshots[i + 1];
        break;
      }
    }
    const span = b.local - a.local;
    const alpha = span > 0 ? Phaser.Math.Clamp((target - a.local) / span, 0, 1) : 1;

    for (const [id, pb] of b.players) {
      const pa = a.players.get(id) ?? pb;
      const avatar = this.avatars.get(id) ?? this.createAvatar(pb);
      const x = Phaser.Math.Linear(pa.x, pb.x, alpha);
      const y = Phaser.Math.Linear(pa.y, pb.y, alpha);
      // Face the walking direction, waddle while moving.
      const vx = x - avatar.lastX;
      if (Math.abs(vx) > 0.3) avatar.sprite.scaleX = vx < 0 ? -1 : 1;
      const moving = Math.hypot(pb.x - pa.x, pb.y - pa.y) > 0.5;
      avatar.sprite.rotation = moving ? Math.sin(performance.now() / 70) * 0.09 : 0;
      avatar.sprite.y = moving ? -Math.abs(Math.sin(performance.now() / 70)) * 3 : 0;
      avatar.lastX = x;
      avatar.body.setPosition(x, y).setAlpha(pb.alive ? 1 : 0.35);
      avatar.label
        .setPosition(x, y - this.joined.radius * 1.1 - 12)
        .setAlpha(pb.alive ? 1 : 0.5)
        .setColor(pb.role === "killer" && this.latest?.phase !== "lobby" ? roles.killer.color : "#141118")
        .setText(pb.away ? `${pb.name} (offline)` : pb.name);
    }

    for (const [id, avatar] of this.avatars) {
      if (!b.players.has(id)) {
        avatar.body.destroy();
        avatar.label.destroy();
        this.avatars.delete(id);
      }
    }

    const dotOf = (id: string) => {
      const a = this.avatars.get(id);
      const p = b.players.get(id);
      return a && p ? { x: a.body.x, y: a.body.y, color: p.color } : undefined;
    };
    const others = config.minimap.showPlayers
      ? [...b.players.keys()].filter((id) => id !== this.joined.you).map(dotOf).filter((d) => d !== undefined)
      : [];
    this.minimap.draw(dotOf(this.joined.you), others, this.cameras.main.worldView);
  }

  private createAvatar(p: PlayerView): Avatar {
    const r = this.joined.radius;
    const feet = r * 0.9;
    const ground = this.add.graphics();
    ground.fillStyle(0x000000, 0.18).fillEllipse(0, feet, r * 2.1, r * 0.6);
    if (p.id === this.joined.you) ground.lineStyle(3, 0xffffff).strokeEllipse(0, feet, r * 2.6, r * 0.85);
    const sprite = this.add.container(0, 0);
    this.characterImage(p.color, p.look, (img) => sprite.add(img.setPosition(0, feet)));
    const body = this.add.container(p.x, p.y, [ground, sprite]).setDepth(2);
    const label = this.add
      .text(p.x, p.y, p.name, { fontFamily: FONT, fontSize: "15px", fontStyle: "800", color: "#141118", stroke: "#ffffff", strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(3);
    const avatar = { body, sprite, label, lastX: p.x };
    this.avatars.set(p.id, avatar);
    if (p.id === this.joined.you) this.cameras.main.startFollow(body, true, 0.15, 0.15);
    return avatar;
  }

  // Same SVG character as the HTML screens, rasterized once per color + look. Origin = center of the feet.
  private characterImage(color: string, look: Look, ready: (img: Phaser.GameObjects.Image) => void) {
    const key = `char:${color}:${look.skin}`;
    const k = (this.joined.radius * HEIGHT_IN_RADII) / FEET.y; // screen px per SVG unit
    const b = TEXTURE_BOX;
    const make = () => {
      if (!this.sys.isActive()) return;
      const img = this.add.image(0, 0, key).setScale(1 / OVERSAMPLE);
      img.setOrigin((FEET.x - b.x) / b.w, (FEET.y - b.y) / b.h);
      ready(img);
    };
    if (this.textures.exists(key)) return make();
    const pending = this.pendingTextures.get(key);
    if (pending) return pending.push(make);
    this.pendingTextures.set(key, [make]);
    const el = new Image();
    el.onload = () => {
      if (!this.textures.exists(key)) this.textures.addImage(key, el);
      this.pendingTextures.get(key)?.forEach((f) => f());
      this.pendingTextures.delete(key);
    };
    el.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(textureSvg(color, look, k * OVERSAMPLE));
  }

  private syncCorpses(bodies: BodyView[]) {
    const ids = new Set(bodies.map((b) => b.id));
    for (const [id, objs] of this.corpses) {
      if (!ids.has(id)) {
        objs.forEach((o) => o.destroy());
        this.corpses.delete(id);
      }
    }
    for (const b of bodies) {
      if (this.corpses.has(b.id)) continue;
      // The victim's character, knocked over, with a big cross.
      const r = this.joined.radius;
      const objs: Phaser.GameObjects.GameObject[] = [
        this.add.ellipse(b.x, b.y + r * 0.4, r * 3.4, r * 1.1, 0x000000, 0.2).setDepth(1),
        this.add.text(b.x, b.y - r * 0.2, "✖", { fontFamily: FONT, fontSize: "24px", fontStyle: "800", color: "#ffffff", stroke: "#141118", strokeThickness: 5 }).setOrigin(0.5).setDepth(1.1),
      ];
      this.corpses.set(b.id, objs);
      this.characterImage(b.color, b.look, (img) => {
        if (this.corpses.get(b.id) !== objs) return img.destroy();
        objs.push(img.setPosition(b.x + r * 1.1, b.y + r * 0.4).setRotation(-Math.PI / 2).setDepth(1));
      });
    }
  }

  private updateUi(s: Snapshot) {
    if (s.phase === "meeting" || s.phase === "ended") this.minimap.close(); // otherwise the backdrop would cover the meeting
    const isHost = s.host === this.joined.you;
    const count = s.players.length;

    $("hud").textContent =
      s.phase === "lobby"
        ? `Room ${this.joined.code} · ${count} player${count === 1 ? "" : "s"}` + (isHost ? "" : " · waiting for host")
        : `Room ${this.joined.code}`;

    const start = $("start") as HTMLButtonElement;
    start.style.display = isHost && (s.phase === "lobby" || s.phase === "ended") ? "block" : "none";
    start.disabled = count < this.joined.minPlayers;
    start.textContent =
      count < this.joined.minPlayers ? `Need ${this.joined.minPlayers} players` : s.phase === "ended" ? "Play again" : "Start game";

    const role = $("role");
    if (s.you.role) {
      const ghost = !s.you.alive;
      role.style.display = "block";
      role.className = ghost ? "ghost" : s.you.role;
      role.textContent = roles[ghost ? "ghost" : s.you.role].name;
    } else {
      role.style.display = "none";
    }
    this.updateReveal(s);

    const kill = $("kill") as HTMLButtonElement;
    const canKill = s.phase === "playing" && s.you.role === "killer" && s.you.alive;
    kill.style.display = canKill ? "block" : "none";
    if (canKill) {
      const cd = s.you.killCooldown ?? 0;
      kill.textContent = cd > 0 ? `Kill (${cd})` : "Kill";
      // Hint only: the server is what validates range.
      kill.disabled = cd > 0 || !this.targetInRange(s);
    }

    const report = $("report") as HTMLButtonElement;
    const canReport = s.phase === "playing" && s.you.alive;
    report.style.display = canReport ? "block" : "none";
    if (canReport) report.disabled = !this.bodyInRange(s);

    const end = $("end");
    end.style.display = s.phase === "ended" ? "flex" : "none";
    end.textContent = s.winner === "killer" ? "Killers win" : "Innocents win";
    if (s.winner) {
      end.style.setProperty("--hero", roles[s.winner].color);
      end.style.color = s.winner === "innocent" ? "#141118" : "#ffffff"; // light green: dark text
    }
  }

  // Full-screen card for each new role (game start, death → ghost).
  private updateReveal(s: Snapshot) {
    const reveal = $("reveal");
    if (s.phase !== "playing" || !s.you.role) {
      if (s.phase !== "meeting") this.revealed = "";
      reveal.style.display = "none";
      return;
    }
    const key = s.you.alive ? s.you.role : "ghost";
    if (key === this.revealed) return;
    this.revealed = key;

    const r = roles[key];
    const me = s.players.find((p) => p.id === this.joined.you);
    reveal.style.setProperty("--hero", r.color);
    reveal.style.color = key === "innocent" ? "#141118" : "#ffffff";
    $("rv-name").textContent = r.name;
    $("rv-tagline").textContent = r.tagline;
    $("rv-icon").innerHTML = `${r.icon}<b>${s.players.filter((p) => p.alive).length}</b>alive`;
    $("rv-char").innerHTML = avatarSvg(me?.color ?? "#ffffff", { sticker: true, ghost: key === "ghost", look: me?.look });
    $("rv-stat-label").textContent = "Room";
    $("rv-stat").textContent = this.joined.code;
    reveal.style.display = "flex";
    setTimeout(() => this.revealed === key && (reveal.style.display = "none"), 5000);
  }

  private bodyInRange(s: Snapshot) {
    const me = s.players.find((p) => p.id === this.joined.you);
    return !!me && s.bodies.some((b) => map.reachable(me.x, me.y, b.x, b.y, this.joined.reportRange));
  }

  private targetInRange(s: Snapshot) {
    const me = s.players.find((p) => p.id === this.joined.you);
    if (!me) return false;
    return s.players.some(
      (p) => p.id !== me.id && p.alive && p.role !== "killer" && map.reachable(me.x, me.y, p.x, p.y, this.joined.killRange),
    );
  }
}
