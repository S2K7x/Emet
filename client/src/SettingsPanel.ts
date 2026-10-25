import type { ServerMsg } from "../../shared/protocol.ts";
import { formatSetting, settingDefs } from "../../shared/settings.ts";
import type { Net } from "./net.ts";

type Snapshot = Extract<ServerMsg, { t: "snapshot" }>;

const $ = (id: string) => document.getElementById(id)!;

// Game settings in the lobby and on the end screen: the host tunes them with − / +, others just see them.
// The server validates every change; this only sends intents.
export class SettingsPanel {
  private drawn = "";

  constructor(private net: Net, private you: string) {
    $("set-toggle").onclick = () => ($("settings").style.display = "flex");
    $("set-close").onclick = () => ($("settings").style.display = "none");
    $("settings").onclick = (e) => {
      if (e.target === $("settings")) $("settings").style.display = "none";
    };
  }

  update(s: Snapshot) {
    const values = s.settings;
    $("set-toggle").style.display = values ? "block" : "none";
    if (!values) {
      $("settings").style.display = "none";
      return;
    }
    const host = s.host === this.you;
    const key = JSON.stringify([values, host]);
    if (key === this.drawn) return;
    this.drawn = key;
    $("set-note").textContent = host ? "You're the host: changes apply to the next game." : "Only the host can change these.";
    const rows = $("set-rows");
    rows.innerHTML = "";
    for (const d of settingDefs) {
      const v = values[d.id];
      if (v === undefined) continue;
      const row = document.createElement("div");
      row.className = "set-row";
      const label = document.createElement("span");
      label.textContent = d.label;
      const value = document.createElement("b");
      value.textContent = formatSetting(d, v);
      row.append(label);
      if (host) {
        const step = d.bool ? 1 : d.step ?? 1;
        const minus = this.button("−", d.bool ? v === 0 : v <= (d.min ?? 0), () => this.net.send({ t: "setting", id: d.id, value: d.bool ? 0 : v - step }));
        const plus = this.button("+", d.bool ? v === 1 : v >= (d.max ?? Infinity), () => this.net.send({ t: "setting", id: d.id, value: d.bool ? 1 : v + step }));
        row.append(minus, value, plus);
      } else {
        row.append(value);
      }
      rows.append(row);
    }
  }

  private button(text: string, disabled: boolean, onClick: () => void) {
    const b = document.createElement("button");
    b.textContent = text;
    b.disabled = disabled;
    b.onclick = onClick;
    return b;
  }
}
