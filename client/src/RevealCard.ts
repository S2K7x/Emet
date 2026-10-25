import type { ServerMsg } from "../../shared/protocol.ts";
import roles from "../../data/roles.json";
import powers from "../../data/powers.json";
import type { Net } from "./net.ts";
import { avatarSvg } from "./avatar.ts";

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;

const $ = (id: string) => document.getElementById(id)!;
const roleInfo = (id?: string) => powers.roles.find((r) => r.id === id);

// Full-screen role card (game start, death → ghost), with the pick-1-of-2 role choice.
export class RevealCard {
  private revealed = ""; // last role shown full screen
  private pickedKey = "";
  private last?: Snapshot;

  constructor(private net: Net, private you: string, private code: string) {
    $("rv-go").onclick = () => ($("reveal").style.display = "none");
  }

  update(s: Snapshot) {
    this.last = s;
    const reveal = $("reveal");
    if (s.phase !== "playing" || !s.you.role) {
      if (s.phase !== "meeting") this.revealed = "";
      reveal.style.display = "none";
      return;
    }
    this.updatePick(s);
    const key = s.you.alive ? `${s.you.role}:${s.you.power?.id ?? ""}` : "ghost";
    if (key === this.revealed) return;
    this.revealed = key;

    const team = s.you.alive ? s.you.role : "ghost";
    const r = roles[team];
    const info = team === "ghost" ? undefined : roleInfo(s.you.power?.id);
    const me = s.players.find((p) => p.id === this.you);
    reveal.style.setProperty("--hero", r.color);
    reveal.style.color = team === "innocent" ? "#141118" : "#ffffff";
    $("rv-name").textContent = info ? info.name : r.name;
    $("rv-tagline").textContent = info ? `${r.name} · ${info.power}` : r.tagline;
    $("rv-icon").innerHTML = `${info?.icon ?? r.icon}<b>${s.players.filter((p) => p.alive).length}</b>alive`;
    $("rv-char").innerHTML = avatarSvg(me?.color ?? "#ffffff", { sticker: true, ghost: team === "ghost", look: me?.look });
    $("rv-stat-label").textContent = "Room";
    $("rv-stat").textContent = this.code;
    reveal.style.display = "flex";
    const hide = () => {
      if (this.revealed !== key) return;
      if (this.last?.you.offer) return void setTimeout(hide, 1000); // still choosing
      reveal.style.display = "none";
    };
    setTimeout(hide, 5000);
  }

  // Role choice on the reveal card: tap one of the offered roles.
  private updatePick(s: Snapshot) {
    const box = $("rv-pick");
    const offer = s.you.alive ? s.you.offer : undefined;
    box.style.display = offer ? "flex" : "none";
    $("rv-pick-label").style.display = offer ? "block" : "none";
    if (!offer) return;
    $("rv-pick-label").textContent = `Pick your power · ${s.you.offerLeft}s`;
    const key = JSON.stringify([offer, s.you.power?.id]);
    if (key === this.pickedKey) return;
    this.pickedKey = key;
    box.innerHTML = "";
    for (const id of offer) {
      const info = roleInfo(id);
      if (!info) continue;
      const btn = document.createElement("button");
      btn.className = id === s.you.power?.id ? "on" : "";
      btn.innerHTML = `<b>${info.icon} ${info.name}</b><small>${info.power}</small>`;
      btn.onclick = () => this.net.send({ t: "pick", role: id });
      box.appendChild(btn);
    }
  }
}
