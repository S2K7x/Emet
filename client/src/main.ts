import type Phaser from "phaser";
import type { ServerMsg } from "../../shared/protocol.ts";
import { Net } from "./net.ts";
import { avatarSvg } from "./avatar.ts";

// Phaser (~1 MB) is only needed in game: the lobby shows first, the engine downloads in the background.
const gameModules = Promise.all([import("phaser"), import("./GameScene.ts")]);

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const nameInput = $<HTMLInputElement>("name");
const codeInput = $<HTMLInputElement>("code");
const errorBox = $("error");

nameInput.value = localStorage.getItem("emet.name") ?? "";
codeInput.value = new URLSearchParams(location.search).get("code") ?? "";

const net = new Net();
let slowTimer: ReturnType<typeof setTimeout> | undefined;
net.onStatus = (connected) => {
  $("net").textContent = game ? "Reconnecting…" : "Connecting to server…";
  $("net").style.display = connected ? "none" : "block";
  // A sleeping server (free hosting) takes ~30 s to wake up.
  clearTimeout(slowTimer);
  if (!connected && !game) slowTimer = setTimeout(() => ($("net").textContent = "Waking up the server (up to a minute)…"), 4000);
  if (connected && errorBox.textContent === "Server unreachable") errorBox.textContent = "";
};
net.onExpired = () => {
  // Away too long: back to the lobby, code prefilled.
  if (game) location.href = `?code=${codeInput.value}`;
};
let game: Phaser.Game | undefined;
let joining = false;

// Lobby: the card changes color like a character carousel.
const LOBBY_THEMES = [
  ["#f6b928", "#e8772e"],
  ["#6a4bd6", "#3d7be0"],
  ["#e03c31", "#c8243a"],
  ["#7fd63a", "#4f9a2a"],
];
let theme = 0;
const showTheme = () => {
  const [bg, hero] = LOBBY_THEMES[theme++ % LOBBY_THEMES.length];
  $("lobby").style.setProperty("--hero", bg);
  $("lobby-char").innerHTML = avatarSvg(hero);
};
showTheme();
const themeTimer = setInterval(showTheme, 2600);

net.onMessage = (msg) => {
  if (msg.t === "error") {
    errorBox.textContent = msg.message;
  } else if (msg.t === "joined" && !game && !joining) {
    joining = true;
    void startGame(msg);
  }
};

async function startGame(msg: Extract<ServerMsg, { t: "joined" }>) {
  const [{ default: Phaser }, { GameScene }] = await gameModules;
  $("lobby").style.display = "none";
  clearInterval(themeTimer);
  $("hud").style.display = "block";
  history.replaceState(null, "", `?code=${msg.code}`); // the page link = invite link
  codeInput.value = msg.code;
  // The font must be loaded before Phaser draws the map text.
  document.fonts.load('800 20px "Outfit"').catch(() => {});
  game = new Phaser.Game({
    type: Phaser.AUTO,
    backgroundColor: "#fdf3dc",
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: new GameScene(net, msg),
  });
}

function name() {
  localStorage.setItem("emet.name", nameInput.value);
  return nameInput.value.trim();
}

// If the server is unreachable, sending waits for reconnection: disable the buttons to avoid double clicks.
async function lobbySend(msg: Parameters<Net["send"]>[0]) {
  const buttons = [$<HTMLButtonElement>("create"), $<HTMLButtonElement>("join")];
  buttons.forEach((b) => (b.disabled = true));
  errorBox.textContent = "";
  try {
    await net.send(msg);
  } catch (e) {
    errorBox.textContent = (e as Error).message;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

$("create").onclick = () => lobbySend({ t: "create", name: name() });
$("join").onclick = () => lobbySend({ t: "join", code: codeInput.value.trim(), name: name() });

// Page reloaded (common on mobile): resume this tab's game.
const saved = Net.savedSession();
if (saved && saved.code === codeInput.value.toUpperCase()) net.resume(saved).catch(() => {});
