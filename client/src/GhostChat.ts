import type { ChatLine, ServerMsg } from "../../shared/protocol.ts";
import quickchat from "../../data/quickchat.json";
import type { Net } from "./net.ts";

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;

const $ = (id: string) => document.getElementById(id)!;
const LOG_LINES = 4;
const LINE_MS = 8000;

// In-game quick chat for ghosts. The server only delivers it to other ghosts.
export class GhostChat {
  private names = new Map<string, { name: string; color: string }>();
  private pending?: number; // phrase waiting for a {player} pick
  private last?: Snapshot;

  constructor(private net: Net) {
    $("gc-toggle").onclick = () => this.setOpen($("gc-panel").style.display !== "flex");
    const phrases = $("gc-phrases");
    quickchat.phrases.forEach((text, phrase) => {
      const btn = document.createElement("button");
      btn.textContent = text.replace("{player}", "…");
      btn.onclick = () => {
        if (text.includes("{player}")) return this.pickTarget(phrase);
        this.net.send({ t: "chat", phrase });
        this.setOpen(false);
      };
      phrases.appendChild(btn);
    });
  }

  update(s: Snapshot) {
    this.last = s;
    for (const p of s.players) this.names.set(p.id, { name: p.name, color: p.color });
    const ghostInGame = s.phase === "playing" && !!s.you.role && !s.you.alive;
    $("gc-toggle").style.display = ghostInGame ? "block" : "none";
    if (!ghostInGame) {
      this.setOpen(false);
      $("gc-log").innerHTML = "";
    }
  }

  // Short log in the corner; lines fade out on their own.
  add(line: ChatLine) {
    const row = document.createElement("div");
    const who = document.createElement("b");
    const from = this.names.get(line.from);
    who.textContent = `👻 ${from?.name ?? "?"}: `;
    who.style.color = from?.color ?? "#fff";
    row.append(who, this.text(line));
    const log = $("gc-log");
    log.appendChild(row);
    while (log.children.length > LOG_LINES) log.firstElementChild!.remove();
    setTimeout(() => row.remove(), LINE_MS);
  }

  text(line: ChatLine) {
    return quickchat.phrases[line.phrase]?.replace("{player}", line.target ? this.names.get(line.target)?.name ?? "?" : "?") ?? "";
  }

  private pickTarget(phrase: number) {
    this.pending = phrase;
    const box = $("gc-targets");
    box.innerHTML = "";
    for (const p of this.last?.players ?? []) {
      const btn = document.createElement("button");
      btn.textContent = p.name; // text, never HTML
      btn.style.borderColor = p.color;
      btn.onclick = () => {
        this.net.send({ t: "chat", phrase: this.pending!, target: p.id });
        this.setOpen(false);
      };
      box.appendChild(btn);
    }
    $("gc-phrases").style.display = "none";
    box.style.display = "flex";
  }

  private setOpen(open: boolean) {
    $("gc-panel").style.display = open ? "flex" : "none";
    $("gc-phrases").style.display = "flex";
    $("gc-targets").style.display = "none";
    this.pending = undefined;
  }
}
