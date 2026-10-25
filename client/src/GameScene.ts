import Phaser from "phaser";
import type { BodyView, ItemView, Look, PlayerView, ServerMsg } from "../../shared/protocol.ts";
import type { Net } from "./net.ts";
import { MeetingUi } from "./MeetingUi.ts";
import { TEXTURE_BOX, textureSvg } from "./avatar.ts";
import roles from "../../data/roles.json";
import mapData from "../../data/map.json";
import { MapGeometry, type MapData } from "../../shared/map.ts";
import { drawMap } from "./MapView.ts";
import { Minimap } from "./Minimap.ts";
import { MiniGame } from "./MiniGames.ts";
import { GhostChat } from "./GhostChat.ts";
import { RevealCard } from "./RevealCard.ts";
import config from "../../data/game.json";
import powers from "../../data/powers.json";

type RoleInfo = (typeof powers.roles)[number];
const roleInfo = (id?: string): RoleInfo | undefined => powers.roles.find((r) => r.id === id);

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
  badge: Phaser.GameObjects.Text; // status emoji above the name
  shield: Phaser.GameObjects.Arc;
  skin: string; // color + look the sprite was drawn with (changes with a disguise)
  lastX: number;
}

const $ = (id: string) => document.getElementById(id)!;

export class GameScene extends Phaser.Scene {
  private snapshots: { local: number; players: Map<string, PlayerView> }[] = [];
  private latest?: Snapshot;
  private avatars = new Map<string, Avatar>();
  private corpses = new Map<string, Phaser.GameObjects.GameObject[]>();
  private items = new Map<string, Phaser.GameObjects.Text>();
  private stationMarks = new Map<string, Phaser.GameObjects.Text>(); // "!" over my unfinished stations
  private miniGame = new MiniGame(
    () => this.syncMiniGame(), // won: tell the server as soon as it can accept
    () => this.net.send({ t: "taskCancel" }),
  );
  private doneSent = false;
  private zoneId?: string; // zone I'm in, to announce its rule on entry
  private bannerTimer?: ReturnType<typeof setTimeout>;
  private pendingTextures = new Map<string, (() => void)[]>();
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d", Phaser.Input.Keyboard.Key>;
  private lastSent = { dx: 0, dy: 0 };
  private meetingUi: MeetingUi;
  private ghostChat: GhostChat;
  private revealCard: RevealCard;
  private lastPhase?: string;
  private minimap = new Minimap(map.data);

  constructor(private net: Net, private joined: Joined) {
    super("game");
    this.meetingUi = new MeetingUi(net, joined.you);
    this.ghostChat = new GhostChat(net);
    this.revealCard = new RevealCard(net, joined.you, joined.code);
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
    this.input.keyboard!.on("keydown-E", () => this.net.send({ t: "power" }));
    $("power").onclick = () => this.net.send({ t: "power" });
    $("use").onclick = () => this.use();
    this.input.keyboard!.on("keydown-F", () => this.use());
    this.input.keyboard!.on("keydown-ESC", () => {
      if (!this.miniGame.open) return;
      this.miniGame.close();
      this.net.send({ t: "taskCancel" });
    });
    this.drawStations();

    $("start").onclick = () => this.net.send({ t: "start" });
    $("kill").onclick = () => this.net.send({ t: "kill" });
    $("report").onclick = () => this.net.send({ t: "report" });
    this.input.keyboard!.on("keydown-R", () => this.net.send({ t: "report" }));
    this.input.keyboard!.on("keydown-M", () => this.minimap.toggle());
    this.minimap.show(config.minimap.enabled);

    this.net.onMessage = (msg) => {
      if (msg.t === "snapshot") this.pushSnapshot(msg);
      else if (msg.t === "chat" && this.latest?.phase === "playing") {
        // Ghost chat during the round (only ghosts ever receive it): log + bubble over the ghost.
        this.ghostChat.add(msg);
        this.bubble(msg.from, this.ghostChat.text(msg));
      } else if (msg.t === "chat") this.meetingUi.addChat(msg);
      else if (msg.t === "fx") this.showFx(msg);
    };
  }

  private pushSnapshot(msg: Snapshot) {
    this.latest = msg;
    this.snapshots.push({ local: performance.now(), players: new Map(msg.players.map((p) => [p.id, p])) });
    if (this.snapshots.length > 20) this.snapshots.shift();
    this.syncCorpses(msg.bodies);
    this.syncItems(msg.items ?? []);
    this.meetingUi.remember(msg);
    this.meetingUi.update(msg);
    this.ghostChat.update(msg);
    // Phase change: the server reset all intents, so we'll resend ours.
    if (msg.phase !== this.lastPhase) this.lastSent = { dx: NaN, dy: NaN };
    this.lastPhase = msg.phase;
    this.updateUi(msg);
    this.syncMiniGame();
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
    if (this.miniGame.open) dx = dy = 0; // busy with a task: stay put (moving would cancel it)
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
      let avatar = this.avatars.get(id) ?? this.createAvatar(pb);
      if (avatar.skin !== `${pb.color}:${pb.look.skin}`) avatar = this.reskin(id, avatar, pb);
      const x = Phaser.Math.Linear(pa.x, pb.x, alpha);
      const y = Phaser.Math.Linear(pa.y, pb.y, alpha);
      // Face the walking direction, waddle while moving.
      const vx = x - avatar.lastX;
      if (Math.abs(vx) > 0.3) avatar.sprite.scaleX = vx < 0 ? -1 : 1;
      const moving = Math.hypot(pb.x - pa.x, pb.y - pa.y) > 0.5;
      const st = new Set(pb.status ?? []);
      const t = performance.now();
      if (st.has("dance")) {
        avatar.sprite.rotation = Math.sin(t / 90) * 0.35;
        avatar.sprite.y = -Math.abs(Math.sin(t / 120)) * 12;
        avatar.sprite.scaleX = Math.sin(t / 400) < 0 ? -1 : 1;
      } else if (st.has("slip")) {
        avatar.sprite.rotation = t / 60;
        avatar.sprite.y = -this.joined.radius * 0.8;
      } else if (moving && map.ruleAt(x, y)?.id === "lowgravity") {
        // Moon: big floaty hops.
        avatar.sprite.rotation = Math.sin(t / 180) * 0.05;
        avatar.sprite.y = -Math.abs(Math.sin(t / 220)) * 16;
      } else {
        avatar.sprite.rotation = moving ? Math.sin(t / 70) * 0.09 : 0;
        avatar.sprite.y = moving ? -Math.abs(Math.sin(t / 70)) * 3 : 0;
      }
      avatar.lastX = x;
      avatar.body.setPosition(x, y).setAlpha(pb.alive ? 1 : 0.35);
      avatar.shield.setVisible(st.has("shield")).setScale(1 + Math.sin(t / 200) * 0.04);
      const badge = st.has("dj") ? "🎧🎶" : st.has("dance") ? "💃" : st.has("slip") ? "🍌" : "";
      avatar.badge.setText(badge).setPosition(x, y - this.joined.radius * 1.1 - 34 + Math.sin(t / 150) * 3);
      avatar.label
        .setPosition(x, y - this.joined.radius * 1.1 - 12)
        .setAlpha(pb.alive ? 1 : 0.5)
        .setColor(pb.role === "killer" && this.latest?.phase !== "lobby" ? roles.killer.color : "#141118")
        .setText(pb.away ? `${pb.name} (offline)` : this.latest?.phase === "ended" && roleInfo(pb.roleId) ? `${pb.name} ${roleInfo(pb.roleId)!.icon}` : pb.name);
    }

    for (const [id, avatar] of this.avatars) {
      if (!b.players.has(id)) {
        avatar.body.destroy();
        avatar.label.destroy();
        avatar.badge.destroy();
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
    this.drawDarkness();
  }

  // Lights out / dark zone: a hole of light centered on my avatar (the camera lags and stops at map edges).
  private drawDarkness() {
    const blind = this.latest?.you.blind;
    const me = this.avatars.get(this.joined.you);
    if (!blind || !me) return;
    const cam = this.cameras.main;
    const x = (me.body.x - cam.worldView.x) * cam.zoom;
    const y = (me.body.y - cam.worldView.y) * cam.zoom;
    const r = blind * cam.zoom;
    const dark = $("dark");
    dark.style.background = `radial-gradient(circle at ${x}px ${y}px, transparent ${r * 0.6}px, rgba(8,6,14,.97) ${r}px)`;
    dark.style.display = "block";
  }

  private createAvatar(p: PlayerView): Avatar {
    const r = this.joined.radius;
    const feet = r * 0.9;
    const ground = this.add.graphics();
    ground.fillStyle(0x000000, 0.18).fillEllipse(0, feet, r * 2.1, r * 0.6);
    if (p.id === this.joined.you) ground.lineStyle(3, 0xffffff).strokeEllipse(0, feet, r * 2.6, r * 0.85);
    const sprite = this.add.container(0, 0);
    this.characterImage(p.color, p.look, (img) => sprite.add(img.setPosition(0, feet)));
    const shield = this.add.circle(0, 0, r * 2, 0x6fd3ff, 0.22).setStrokeStyle(3, 0x6fd3ff, 0.9).setVisible(false);
    const body = this.add.container(p.x, p.y, [ground, sprite, shield]).setDepth(2);
    const label = this.add
      .text(p.x, p.y, p.name, { fontFamily: FONT, fontSize: "15px", fontStyle: "800", color: "#141118", stroke: "#ffffff", strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(3);
    const badge = this.add.text(p.x, p.y, "", { fontFamily: FONT, fontSize: "22px" }).setOrigin(0.5).setDepth(3);
    const avatar: Avatar = { body, sprite, label, badge, shield, skin: `${p.color}:${p.look.skin}`, lastX: p.x };
    this.avatars.set(p.id, avatar);
    if (p.id === this.joined.you) this.cameras.main.startFollow(body, true, 0.15, 0.15);
    return avatar;
  }

  // Speech bubble that follows a player for a few seconds.
  private bubble(id: string, text: string) {
    const avatar = this.avatars.get(id);
    if (!avatar) return;
    const t = this.add
      .text(0, 0, text, { fontFamily: FONT, fontSize: "14px", fontStyle: "700", color: "#ffffff", backgroundColor: "#2a1f50", padding: { x: 10, y: 6 }, wordWrap: { width: 200 } })
      .setOrigin(0.5, 1)
      .setDepth(5)
      .setAlpha(0.95);
    const follow = () => t.setPosition(avatar.body.x, avatar.body.y - this.joined.radius * 1.1 - 30);
    follow();
    this.events.on("update", follow);
    this.time.delayedCall(3500, () => {
      this.events.off("update", follow);
      t.destroy();
    });
  }

  // Quest stations: a glowing pad with an icon. Mine get a bouncing "!".
  private drawStations() {
    for (const st of map.data.stations) {
      this.add.circle(st.x, st.y, 34, 0xffffff, 0.55).setStrokeStyle(4, 0xf6b928).setDepth(0.9);
      this.add.text(st.x, st.y, st.icon, { fontFamily: FONT, fontSize: "30px" }).setOrigin(0.5).setDepth(0.95);
      this.add
        .text(st.x, st.y + 44, st.label, { fontFamily: FONT, fontSize: "12px", fontStyle: "800", color: "#141118", stroke: "#ffffff", strokeThickness: 4 })
        .setOrigin(0.5)
        .setDepth(0.95);
      const mark = this.add
        .text(st.x, st.y - 52, "!", { fontFamily: FONT, fontSize: "30px", fontStyle: "800", color: "#f6b928", stroke: "#141118", strokeThickness: 6 })
        .setOrigin(0.5)
        .setDepth(3)
        .setVisible(false);
      this.tweens.add({ targets: mark, y: st.y - 62, yoyo: true, repeat: -1, duration: 450, ease: "Sine.easeInOut" });
      this.stationMarks.set(st.id, mark);
    }
  }

  // Context button: the station I'm standing at, or the red button.
  private useTarget(s: Snapshot): "task" | "emergency" | undefined {
    const me = s.players.find((p) => p.id === this.joined.you);
    if (!me || s.phase !== "playing") return undefined;
    const todo = new Set((s.you.tasks ?? []).filter((t) => !t.done).map((t) => t.station));
    if (map.data.stations.some((st) => todo.has(st.id) && map.reachable(me.x, me.y, st.x, st.y, config.tasks.range))) return "task";
    const e = map.data.emergency;
    if (s.you.alive && (s.you.emergencies ?? 0) > 0 && Math.hypot(me.x - e.x, me.y - e.y) <= config.emergency.range) return "emergency";
    return undefined;
  }

  // The server says what I'm working on: open/close the mini-game to match, and report a win once allowed.
  private syncMiniGame() {
    const w = this.latest?.you.working;
    if (!w) {
      if (this.miniGame.open) this.miniGame.close();
      this.doneSent = false;
      return;
    }
    if (this.miniGame.station !== w.station) {
      const st = map.data.stations.find((s) => s.id === w.station);
      if (st) this.miniGame.start(st.id, st.game, st.icon);
      this.doneSent = false;
    }
    if (this.miniGame.waitingForServer && w.ready && !this.doneSent) {
      this.doneSent = true;
      this.net.send({ t: "taskDone" });
    }
  }

  private use() {
    const target = this.latest && this.useTarget(this.latest);
    if (target) this.net.send({ t: target });
  }

  // Disguise on/off: redraw the character with the new color and look.
  private reskin(id: string, avatar: Avatar, p: PlayerView): Avatar {
    avatar.skin = `${p.color}:${p.look.skin}`;
    const sprite = avatar.sprite;
    const feet = this.joined.radius * 0.9;
    this.characterImage(p.color, p.look, (img) => {
      if (this.avatars.get(id) !== avatar || avatar.skin !== `${p.color}:${p.look.skin}`) return img.destroy();
      sprite.removeAll(true);
      sprite.add(img.setPosition(0, feet));
    });
    return avatar;
  }

  private syncItems(items: ItemView[]) {
    const ids = new Set(items.map((i) => i.id));
    for (const [id, obj] of this.items) {
      if (!ids.has(id)) {
        obj.destroy();
        this.items.delete(id);
      }
    }
    for (const it of items) {
      if (this.items.has(it.id)) continue;
      this.items.set(it.id, this.add.text(it.x, it.y, "🍌", { fontFamily: FONT, fontSize: "28px" }).setOrigin(0.5).setDepth(1.2));
    }
  }

  // One-off effects: floating emoji on the map, or a banner for global ones.
  private showFx(fx: Extract<ServerMsg, { t: "fx" }>) {
    if (fx.kind === "banner") {
      const banner = $("banner");
      banner.textContent = fx.text ?? "";
      banner.style.display = "block";
      clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(() => (banner.style.display = "none"), 2500);
      return;
    }
    if (fx.x === undefined || fx.y === undefined) return;
    const emoji = { poof: "💨", shield: "🫧", pop: "💥", slip: "🍌💫", zap: "⚡", revive: "✨", chomp: "🦴", whiff: "❄️💫" }[fx.kind] ?? "❗";
    const text = this.add.text(fx.x, fx.y - 20, emoji, { fontFamily: FONT, fontSize: "40px" }).setOrigin(0.5).setDepth(4);
    this.tweens.add({ targets: text, y: fx.y - 90, alpha: 0, scale: 1.6, duration: 1200, ease: "Cubic.easeOut", onComplete: () => text.destroy() });
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

    const meNow = s.players.find((p) => p.id === this.joined.you);
    const zone = meNow && s.phase === "playing" ? map.zoneAt(meNow.x, meNow.y) : undefined;
    $("hud").textContent =
      s.phase === "lobby"
        ? `Room ${this.joined.code} · ${count} player${count === 1 ? "" : "s"}` + (isHost ? "" : " · waiting for host")
        : `Room ${this.joined.code}` + (zone?.rule ? ` · ${zone.rule.icon} ${zone.rule.label}` : "");
    // Entering a zone with a rule: announce it.
    if (zone?.id !== this.zoneId) {
      this.zoneId = zone?.id;
      if (zone?.rule && s.you.alive) this.showFx({ t: "fx", kind: "banner", text: `${zone.rule.icon} ${zone.label}: ${zone.rule.desc}` });
    }

    const start = $("start") as HTMLButtonElement;
    start.style.display = isHost && (s.phase === "lobby" || s.phase === "ended") ? "block" : "none";
    start.disabled = count < this.joined.minPlayers;
    start.textContent =
      count < this.joined.minPlayers ? `Need ${this.joined.minPlayers} players` : s.phase === "ended" ? "Play again" : "Start game";

    const role = $("role");
    if (s.you.role) {
      const ghost = !s.you.alive;
      const info = roleInfo(s.you.power?.id);
      role.style.display = "block";
      role.className = ghost ? "ghost" : s.you.role;
      role.textContent = ghost ? roles.ghost.name : info ? `${info.icon} ${info.name}` : roles[s.you.role].name;
      if (!ghost && s.you.role === "neutral") role.style.background = roles.neutral.color;
      else role.style.background = "";
      if (!ghost && s.you.power?.progress) role.insertAdjacentHTML("beforeend", `<small>${s.you.power.progress}</small>`);
    } else {
      role.style.display = "none";
    }
    this.revealCard.update(s);

    const kill = $("kill") as HTMLButtonElement;
    const canKill = s.phase === "playing" && s.you.role === "killer" && s.you.alive;
    kill.style.display = canKill ? "block" : "none";
    if (canKill) {
      const cd = s.you.killCooldown ?? 0;
      kill.textContent = cd > 0 ? `Kill (${cd})` : "Kill";
      // Hint only: the server is what validates range.
      kill.disabled = cd > 0 || !this.targetInRange(s);
    }

    const power = $("power") as HTMLButtonElement;
    const pw = s.you.power;
    const info = roleInfo(pw?.id);
    const canPower = s.phase === "playing" && s.you.alive && !!pw && !!info && info.uses !== 0 && pw.uses !== 0;
    power.style.display = canPower ? "block" : "none";
    if (canPower) {
      power.disabled = pw!.cooldown > 0;
      power.innerHTML = `${info!.icon} ${info!.button}${pw!.cooldown > 0 ? ` (${pw!.cooldown})` : ""}` + (pw!.uses !== undefined ? `<small>${pw!.uses} left</small>` : "");
    }

    // Clock, quest bar, task list, context button.
    const clock = $("clock");
    clock.style.display = s.clock ? "flex" : "none";
    if (s.clock) {
      const mmss = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
      $("clock-time").textContent = `⏰ ${mmss(s.clock.round)} · ${mmss(s.clock.total)}`;
      clock.classList.toggle("urgent", s.clock.total <= 30);
      (clock.querySelector("#taskbar i") as HTMLElement).style.width = `${Math.round((s.taskBar ?? 0) * 100)}%`;
    }
    const tasks = $("tasks");
    const myTasks = s.phase === "playing" ? s.you.tasks ?? [] : [];
    tasks.style.display = myTasks.length ? "block" : "none";
    if (myTasks.length) {
      const label = (id: string) => map.data.stations.find((st) => st.id === id);
      tasks.innerHTML = `<b>Tasks ${myTasks.filter((t) => t.done).length}/${myTasks.length}${s.you.role === "innocent" ? "" : " (fake)"}</b>` +
        myTasks.map((t) => `<div class="${t.done ? "done" : ""}">${label(t.station)?.icon} ${label(t.station)?.label}</div>`).join("");
    }
    for (const [id, mark] of this.stationMarks) mark.setVisible(myTasks.some((t) => t.station === id && !t.done));

    const use = $("use") as HTMLButtonElement;
    const target = this.useTarget(s);
    use.style.display = target ? "block" : "none";
    use.className = "action" + (target === "emergency" ? " emergency" : "") + (canKill ? " above" : "");
    if (target === "task") {
      const w = s.you.working;
      use.disabled = !!w;
      use.textContent = w ? "🎮 Playing…" : "🔧 Task";
    } else if (target === "emergency") {
      use.disabled = false;
      use.textContent = `🚨 Emergency (${s.you.emergencies})`;
    }

    if (!s.you.blind) $("dark").style.display = "none"; // drawn each frame in drawDarkness()

    const report = $("report") as HTMLButtonElement;
    const canReport = s.phase === "playing" && s.you.alive;
    report.style.display = canReport ? "block" : "none";
    if (canReport) report.disabled = !this.bodyInRange(s);

    const end = $("end");
    end.style.display = s.phase === "ended" ? "flex" : "none";
    const solo = roleInfo(s.winner);
    end.textContent = solo ? `${solo.icon} ${solo.name} wins!` : s.winner === "killer" ? "Killers win" : "Innocents win";
    if (s.winner) {
      end.style.setProperty("--hero", solo ? roles.neutral.color : roles[s.winner as "innocent" | "killer"].color);
      end.style.color = s.winner === "innocent" ? "#141118" : "#ffffff"; // light green: dark text
      // Everyone's role, revealed.
      const cast = s.players
        .map((p) => `${p.name}: ${roleInfo(p.roleId)?.icon ?? ""} ${roleInfo(p.roleId)?.name ?? roles[p.role ?? "innocent"].name}${p.role === "killer" ? " 🔪" : ""}`)
        .join(" · ");
      const small = document.createElement("small");
      small.textContent = cast;
      end.appendChild(small);
    }
  }

  private bodyInRange(s: Snapshot) {
    const me = s.players.find((p) => p.id === this.joined.you);
    return !!me && s.bodies.some((b) => map.reachable(me.x, me.y, b.x, b.y, this.joined.reportRange));
  }

  private targetInRange(s: Snapshot) {
    const me = s.players.find((p) => p.id === this.joined.you);
    if (!me) return false;
    return s.players.some(
      (p) =>
        p.id !== me.id && p.alive && p.role !== "killer" &&
        map.reachable(me.x, me.y, p.x, p.y, this.joined.killRange * (map.ruleAt(p.x, p.y)?.killRange ?? 1)),
    );
  }
}
