import minigames from "../../data/minigames.json";

// Task mini-games, in HTML (touch-friendly). Each one draws into `stage` and calls `done()` once won.
// The server only accepts the result after minSeconds, in range, without moving (see Room.finishTask).

type Params = Record<string, number | string>;
type Game = (stage: HTMLElement, p: Params, done: () => void, status: (text: string) => void) => () => void; // returns cleanup

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  parent.appendChild(e);
  return e;
};
const shake = (e: HTMLElement) => {
  e.classList.remove("shake");
  void e.offsetWidth;
  e.classList.add("shake");
};
// requestAnimationFrame loop with dt in seconds; returns stop().
const loop = (fn: (dt: number, t: number) => void) => {
  let last = performance.now();
  let id = requestAnimationFrame(function step(now) {
    fn(Math.min(0.05, (now - last) / 1000), now / 1000);
    last = now;
    id = requestAnimationFrame(step);
  });
  return () => cancelAnimationFrame(id);
};

const games: Record<string, Game> = {
  // 📡 Slide until your wave matches the target, then hold it there.
  tune(stage, p, done, status) {
    const canvas = el("canvas", "mg-wave", stage) as HTMLCanvasElement;
    canvas.width = 600;
    canvas.height = 300;
    const slider = el("input", "mg-slider", stage) as HTMLInputElement;
    Object.assign(slider, { type: "range", min: "0", max: "1", step: "0.001", value: String(Math.random() < 0.5 ? 0.05 : 0.95) });
    const target = rand(0.25, 0.75);
    let held = 0;
    const ctx = canvas.getContext("2d")!;
    const wave = (v: number, color: string, dash: number[], t: number) => {
      ctx.beginPath();
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = 8;
      for (let x = 0; x <= 600; x += 6) {
        const y = 150 + Math.sin((x / 600) * Math.PI * (2 + v * 8) + t * 3) * (40 + v * 60);
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    return loop((dt, t) => {
      const v = Number(slider.value);
      const close = Math.abs(v - target) < Number(p.tolerance);
      held = close ? held + dt : 0;
      ctx.clearRect(0, 0, 600, 300);
      wave(target, "rgba(20,17,24,.25)", [18, 14], t);
      wave(v, close ? "#2bb24c" : "#e03c31", [], t);
      status(close ? `Hold it… ${Math.min(100, Math.round((held / Number(p.hold)) * 100))}%` : "No signal");
      if (held >= Number(p.hold)) done();
    });
  },

  // 🪨 Tap the rocks drifting around.
  rocks(stage, p, done, status) {
    stage.classList.add("mg-field");
    const rocks = Array.from({ length: Number(p.count) }, () => {
      const b = el("button", "mg-emoji", stage, "🪨");
      const r = { b, x: rand(10, 80), y: rand(10, 80), vx: rand(-1, 1), vy: rand(-1, 1) };
      b.onpointerdown = () => {
        b.remove();
        rocks.splice(rocks.indexOf(r), 1);
        status(`${Number(p.count) - rocks.length}/${p.count}`);
        if (rocks.length === 0) done();
      };
      return r;
    });
    status(`0/${p.count}`);
    return loop((dt) => {
      const speed = (Number(p.speed) / stage.clientWidth) * 100 || 0;
      for (const r of rocks) {
        r.x += r.vx * speed * dt;
        r.y += r.vy * speed * dt;
        if (r.x < 2 || r.x > 86) r.vx *= -1;
        if (r.y < 2 || r.y > 86) r.vy *= -1;
        r.b.style.left = `${r.x}%`;
        r.b.style.top = `${r.y}%`;
      }
    });
  },

  // 🐟 Timing: reel in when the fish swims over the hook. It gets faster each catch.
  fish(stage, p, done, status) {
    const lane = el("div", "mg-lane", stage);
    const zone = el("div", "mg-zone", lane);
    const w = Number(p.zone);
    zone.style.left = `${50 - (w * 100) / 2}%`;
    zone.style.width = `${w * 100}%`;
    el("div", "mg-hook", lane, "🪝");
    const fish = el("div", "mg-fish", lane, "🐟");
    const reel = el("button", "mg-big", stage, "Reel!");
    let caught = 0;
    let phase = 0;
    let speed = 1.6;
    let x = 0;
    status(`0/${p.catches}`);
    reel.onpointerdown = () => {
      if (Math.abs(x - 0.5) <= w / 2) {
        caught++;
        speed *= 1.3;
        status(`${caught}/${p.catches} 🎣`);
        fish.textContent = "🐠";
        setTimeout(() => (fish.textContent = "🐟"), 300);
        if (caught >= Number(p.catches)) done();
      } else {
        shake(lane);
        status(`Missed! ${caught}/${p.catches}`);
      }
    };
    return loop((dt) => {
      phase += dt * speed;
      x = (Math.sin(phase) + 1) / 2;
      fish.style.left = `${x * 100}%`;
      fish.style.transform = `translateX(-50%) scaleX(${Math.cos(phase) > 0 ? -1 : 1})`;
    });
  },

  // 🧊 Mash to heat up faster than it cools down.
  defrost(stage, p, done, status) {
    const ice = el("div", "mg-ice", stage, "🧊");
    const bar = el("div", "mg-bar", stage);
    const fill = el("i", "", bar);
    const tap = el("button", "mg-big", stage, "🔥 Rub!");
    let heat = 0;
    tap.onpointerdown = () => {
      heat = Math.min(100, heat + Number(p.perTap));
      if (heat >= 100) done();
    };
    return loop((dt) => {
      heat = Math.max(0, heat - Number(p.decay) * dt);
      fill.style.width = `${heat}%`;
      ice.style.transform = `scale(${1 - heat / 220})`;
      ice.textContent = heat > 70 ? "💧" : "🧊";
      status(`${Math.round(heat)}°`);
    });
  },

  // 💾 Simon: watch the server lights, then repeat the sequence.
  servers(stage, p, done, status) {
    const colors = ["#e03c31", "#2bb24c", "#1f6feb", "#ffd400"];
    const grid = el("div", "mg-simon", stage);
    const pads = colors.map((c, i) => {
      const b = el("button", "mg-pad", grid);
      b.style.background = c;
      b.onpointerdown = () => press(i);
      return b;
    });
    const seq = Array.from({ length: Number(p.length) }, () => Math.floor(Math.random() * 4));
    let pos = 0;
    let listening = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const flash = (i: number) => {
      pads[i].classList.add("lit");
      timers.push(setTimeout(() => pads[i].classList.remove("lit"), 280));
    };
    const play = () => {
      listening = false;
      pos = 0;
      status("Watch…");
      seq.forEach((i, k) => timers.push(setTimeout(() => flash(i), 500 + k * 480)));
      timers.push(setTimeout(() => ((listening = true), status("Your turn")), 500 + seq.length * 480));
    };
    const press = (i: number) => {
      if (!listening) return;
      flash(i);
      if (i !== seq[pos]) {
        shake(grid);
        status("Error! Rebooting…");
        listening = false;
        timers.push(setTimeout(play, 700));
        return;
      }
      pos++;
      status(`${pos}/${seq.length}`);
      if (pos === seq.length) done();
    };
    play();
    return () => timers.forEach(clearTimeout);
  },

  // 🕹️ Whack-a-mole with aliens.
  whack(stage, p, done, status) {
    const grid = el("div", "mg-holes", stage);
    const holes = Array.from({ length: 9 }, () => el("button", "mg-hole", grid));
    let hits = 0;
    status(`0/${p.hits}`);
    holes.forEach((h) => {
      h.onpointerdown = () => {
        if (!h.textContent) return;
        h.textContent = "💥";
        h.classList.remove("up");
        hits++;
        status(`${hits}/${p.hits}`);
        if (hits >= Number(p.hits)) done();
        setTimeout(() => h.textContent === "💥" && (h.textContent = ""), 200);
      };
    });
    const timers: ReturnType<typeof setTimeout>[] = [];
    const spawn = () => {
      const free = holes.filter((h) => !h.textContent);
      const h = free[Math.floor(Math.random() * free.length)];
      if (h) {
        h.textContent = "👾";
        h.classList.add("up");
        timers.push(setTimeout(() => h.textContent === "👾" && ((h.textContent = ""), h.classList.remove("up")), Number(p.stay)));
      }
    };
    const every = setInterval(spawn, Number(p.every));
    spawn();
    return () => {
      clearInterval(every);
      timers.forEach(clearTimeout);
    };
  },

  // 🍭 Drag around the lollipop: count full turns.
  lollipop(stage, p, done, status) {
    const pad = el("div", "mg-swirl", stage);
    const pop = el("div", "mg-pop", pad, "🍭");
    const goal = Number(p.turns) * Math.PI * 2;
    let total = 0;
    let last: number | undefined;
    status(`0/${p.turns}`);
    const angle = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    };
    pad.onpointerdown = (e) => {
      try {
        pad.setPointerCapture(e.pointerId); // keep tracking when the finger leaves the circle
      } catch {
        /* unsupported pointer: tracking still works inside the circle */
      }
      last = angle(e);
    };
    pad.onpointermove = (e) => {
      if (last === undefined) return;
      const a = angle(e);
      let d = a - last;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      last = a;
      total += Math.abs(d); // either direction counts
      pop.style.transform = `rotate(${total}rad) scale(${1 - (total / goal) * 0.5})`;
      status(`${Math.min(Number(p.turns), Math.floor(total / (Math.PI * 2)))}/${p.turns}`);
      if (total >= goal) done();
    };
    pad.onpointerup = pad.onpointercancel = () => (last = undefined);
    return () => {};
  },

  // 🎂 Tap the frosting dots in order. A wrong dot wipes the cake.
  cake(stage, p, done, status) {
    stage.classList.add("mg-field", "mg-cake");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.classList.add("mg-lines");
    stage.appendChild(svg);
    const n = Number(p.dots);
    const pts: { x: number; y: number }[] = [];
    while (pts.length < n) {
      const q = { x: rand(10, 82), y: rand(10, 82) };
      if (pts.every((o) => Math.hypot(o.x - q.x, o.y - q.y) > 18)) pts.push(q);
    }
    let next = 0;
    const dots = pts.map((q, i) => {
      const b = el("button", "mg-dot", stage, String(i + 1));
      b.style.left = `${q.x}%`;
      b.style.top = `${q.y}%`;
      b.onpointerdown = () => {
        if (i !== next) {
          shake(stage);
          next = 0;
          svg.innerHTML = "";
          dots.forEach((d) => d.classList.remove("on"));
          status("Oops! Start again");
          return;
        }
        b.classList.add("on");
        if (i > 0) {
          const a = pts[i - 1];
          svg.insertAdjacentHTML("beforeend", `<line x1="${a.x + 6}" y1="${a.y + 6}" x2="${q.x + 6}" y2="${q.y + 6}"/>`);
        }
        next++;
        status(`${next}/${n}`);
        if (next === n) done();
      };
      return b;
    });
    status(`0/${n}`);
    return () => {};
  },
};

// The overlay: one mini-game at a time.
export class MiniGame {
  private cleanup?: () => void;
  station?: string;
  private won = false;

  constructor(private onDone: () => void, private onCancel: () => void) {
    document.getElementById("mg-close")!.onclick = () => {
      this.close();
      this.onCancel();
    };
  }

  get open() {
    return this.station !== undefined;
  }

  start(station: string, type: string, icon: string) {
    this.close();
    const def = (minigames.games as Record<string, Params>)[type];
    const game = games[type];
    if (!def || !game) return;
    this.station = station;
    this.won = false;
    const stage = document.getElementById("mg-stage")!;
    stage.innerHTML = "";
    stage.className = "";
    document.getElementById("mg-title")!.textContent = `${icon} ${def.title}`;
    document.getElementById("mg-hint")!.textContent = String(def.hint);
    const status = (t: string) => {
      if (!this.won) document.getElementById("mg-status")!.textContent = t; // input after the win changes nothing
    };
    status("");
    document.getElementById("minigame")!.style.display = "flex";
    this.cleanup = game(stage, def, () => this.win(), status);
  }

  // Won: tell the server (it may refuse if too fast; we keep retrying until the snapshot says done).
  private win() {
    if (this.won) return;
    this.won = true;
    this.cleanup?.();
    this.cleanup = undefined;
    document.getElementById("mg-status")!.textContent = "✔ Done!";
    document.getElementById("mg-stage")!.classList.add("mg-won");
    this.onDone();
  }

  // Called on each snapshot while winning: resend until the server agrees.
  get waitingForServer() {
    return this.won;
  }

  close() {
    this.cleanup?.();
    this.cleanup = undefined;
    this.station = undefined;
    this.won = false;
    document.getElementById("minigame")!.style.display = "none";
  }
}
