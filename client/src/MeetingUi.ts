import { SKIP, type ChatLine, type ServerMsg } from "../../shared/protocol.ts";
import quickchat from "../../data/quickchat.json";
import type { Net } from "./net.ts";
import { avatarSvg } from "./avatar.ts";

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;

const $ = (id: string) => document.getElementById(id)!;

// Meeting screen in HTML (more readable and touch-friendly than canvas).
export class MeetingUi {
  // Known names and colors, including players who became invisible (ghosts).
  private people = new Map<string, { name: string; color: string }>();
  private selected?: string;
  private renderedKey = "";
  private last?: Snapshot;

  constructor(private net: Net, private me: string) {
    $("mt-vote").onclick = () => this.selected && this.net.send({ t: "vote", target: this.selected });
    $("mt-skip").onclick = () => this.net.send({ t: "vote", target: SKIP });

    const quick = $("mt-quick");
    quickchat.phrases.forEach((text, phrase) => {
      const btn = document.createElement("button");
      btn.dataset.needsTarget = String(text.includes("{player}"));
      btn.textContent = text.replace("{player}", "…");
      btn.onclick = () => this.net.send({ t: "chat", phrase, target: text.includes("{player}") ? this.selected : undefined });
      quick.appendChild(btn);
    });
  }

  remember(s: Snapshot) {
    for (const p of s.players) this.people.set(p.id, { name: p.name, color: p.color });
  }

  update(s: Snapshot) {
    this.last = s;
    const m = s.meeting;
    const box = $("meeting");
    if (s.phase !== "meeting" || !m) {
      if (box.style.display !== "none") {
        box.style.display = "none";
        $("mt-log").innerHTML = "";
        this.selected = undefined;
        this.renderedKey = "";
      }
      return;
    }
    box.style.display = "flex";

    const stageLabel = { discussion: "Discussion", vote: "Vote", result: "Result" }[m.stage];
    $("mt-title").textContent =
      m.kind === "round" ? "⏰ Round over: who's lying?"
      : !m.body ? `${this.nameOf(m.reporter)} called an emergency meeting 🚨`
      : m.reporter === m.body ? `${this.nameOf(m.body)}'s body reported itself 🍁`
      : `${this.nameOf(m.reporter)} reported ${this.nameOf(m.body)}'s body`;
    $("mt-timer").textContent = `${stageLabel} · ${m.secondsLeft}s`;

    // Only rebuild the cards when something changed (otherwise clicks get lost).
    const key = JSON.stringify([s.players.map((p) => [p.id, p.alive]), m.stage, m.voted, m.myVote, this.selected, m.result, s.you.alive]);
    if (key === this.renderedKey) return;
    this.renderedKey = key;

    if (this.selected && !s.players.some((p) => p.id === this.selected && p.alive)) this.selected = undefined;

    const list = $("mt-players");
    list.innerHTML = "";
    for (const p of s.players) {
      const card = document.createElement("button");
      card.className = "card" + (p.alive ? "" : " dead") + (p.id === this.selected ? " selected" : "");
      const tags = [
        p.id === this.me ? `<span class="tag me">you</span>` : "",
        m.voted.includes(p.id) ? `<span class="tag voted">✔ voted</span>` : "",
        m.result ? `<span class="tag votes">${m.result.tally[p.id] ?? 0} vote${m.result.tally[p.id] === 1 ? "" : "s"}</span>` : "",
      ].join("");
      card.innerHTML = `<span class="face" style="--c:${p.color}">${avatarSvg(p.color, { look: p.look })}</span><span class="who"><span class="name"></span><span class="tags">${tags}</span></span>`;
      (card.querySelector(".name") as HTMLElement).textContent = p.name; // name = text, never HTML
      if (p.alive) card.onclick = () => {
        this.selected = this.selected === p.id ? undefined : p.id;
        this.update(this.last!);
      };
      list.appendChild(card);
    }

    const canVote = m.stage === "vote" && s.you.alive && !m.myVote;
    const vote = $("mt-vote") as HTMLButtonElement;
    vote.disabled = !canVote || !this.selected;
    vote.textContent = this.selected ? `Vote ${this.nameOf(this.selected)}` : "Pick a player";
    ($("mt-skip") as HTMLButtonElement).disabled = !canVote;
    $("mt-actions").style.display = s.you.alive && m.stage !== "result" ? "flex" : "none";

    for (const btn of $("mt-quick").querySelectorAll("button")) {
      btn.disabled = btn.dataset.needsTarget === "true" && !this.selected;
    }

    $("mt-result").textContent = !m.result
      ? m.myVote ? `Your vote: ${m.myVote === SKIP ? "skip" : this.nameOf(m.myVote)}` : ""
      : m.result.ejected
        ? `${this.nameOf(m.result.ejected)} was ejected` +
          (m.result.ejectedRole ? (m.result.ejectedRole === "killer" ? " — they were a killer!" : " — they were innocent…") : ".") +
          ` (skip: ${m.result.tally[SKIP] ?? 0})`
        : `No one was ejected (skip: ${m.result.tally[SKIP] ?? 0})`;
  }

  addChat(line: ChatLine) {
    const text = quickchat.phrases[line.phrase]?.replace("{player}", line.target ? this.nameOf(line.target) : "?") ?? "";
    const row = document.createElement("div");
    if (line.ghost) row.className = "ghost";
    const who = document.createElement("b");
    who.textContent = `${line.ghost ? "👻 " : ""}${this.nameOf(line.from)}: `;
    who.style.color = this.people.get(line.from)?.color ?? "#fff";
    row.append(who, text);
    const log = $("mt-log");
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  private nameOf(id: string) {
    return this.people.get(id)?.name ?? "?";
  }
}
