import type { Look } from "../../shared/protocol.ts";

// Chibi characters in SVG (HTML screens and in-game textures). Each skin is tinted with the player's color,
// which stays the dominant area so players remain recognizable by color in meetings.
// sticker: white outline around the character (not the shadow), so it stays readable on a background of the same color.

const INK = "#2b2530";
const DARK = "#17131c";
const S = `stroke="${INK}" stroke-width="5" stroke-linejoin="round"`;

type Draw = (c: string) => string;

// Nexus: the original helmet.
const helmet: Draw = (c) => `
  <rect x="62" y="168" width="30" height="46" rx="10" fill="${INK}"/>
  <rect x="112" y="168" width="30" height="46" rx="10" fill="${INK}"/>
  <rect x="58" y="118" width="88" height="66" rx="18" fill="${INK}"/>
  <rect x="78" y="124" width="48" height="58" rx="8" fill="#fff"/>
  <rect x="94" y="124" width="16" height="58" fill="${c}"/>
  <rect x="40" y="128" width="40" height="52" rx="8" fill="${c}" stroke="${INK}" stroke-width="5"/>
  <rect x="38" y="14" width="128" height="116" rx="20" fill="${c}"/>
  <rect x="128" y="14" width="38" height="116" rx="20" fill="#000" opacity=".14"/>
  <path d="M90 14h24v44h34v40c0 10-8 18-18 18H74c-10 0-18-8-18-18V58h34z" fill="#fff"/>
  <path d="M68 70l26 9-3 10-25-7z" fill="${DARK}"/>
  <path d="M136 70l-26 9 3 10 25-7z" fill="${DARK}"/>
  <path d="M102 92l4 10-4 10-4-10z" fill="${DARK}"/>
`;

// Moon: bubble-helmet astronaut with an antenna and a backpack.
const astro: Draw = (c) => `
  <rect x="136" y="112" width="34" height="64" rx="12" fill="${INK}"/>
  <rect x="64" y="166" width="32" height="40" rx="12" fill="${c}" ${S}/>
  <rect x="110" y="166" width="32" height="40" rx="12" fill="${c}" ${S}/>
  <rect x="58" y="198" width="42" height="18" rx="9" fill="${INK}"/>
  <rect x="106" y="198" width="42" height="18" rx="9" fill="${INK}"/>
  <rect x="54" y="114" width="98" height="70" rx="28" fill="${c}" ${S}/>
  <rect x="120" y="114" width="32" height="70" rx="16" fill="#000" opacity=".12"/>
  <rect x="82" y="132" width="40" height="26" rx="7" fill="#fff" stroke="${INK}" stroke-width="4"/>
  <circle cx="94" cy="145" r="5" fill="#e03c31"/><circle cx="110" cy="145" r="5" fill="#ffd400"/>
  <circle cx="44" cy="150" r="14" fill="${c}" ${S}/>
  <line x1="103" y1="18" x2="103" y2="6" stroke="${INK}" stroke-width="5"/>
  <circle cx="103" cy="7" r="7" fill="#ffd400" stroke="${INK}" stroke-width="4"/>
  <circle cx="103" cy="72" r="56" fill="${c}" ${S}/>
  <rect x="54" y="46" width="98" height="58" rx="29" fill="${DARK}"/>
  <path d="M68 62q10-11 26-11" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".8"/>
  <ellipse cx="88" cy="78" rx="7" ry="10" fill="#fff"/><ellipse cx="118" cy="78" rx="7" ry="10" fill="#fff"/>`;

// Ice: furry parka with a hidden face and a striped scarf.
const parka: Draw = (c) => `
  <rect x="64" y="170" width="30" height="44" rx="10" fill="${INK}"/>
  <rect x="112" y="170" width="30" height="44" rx="10" fill="${INK}"/>
  <rect x="52" y="114" width="102" height="74" rx="24" fill="${c}" ${S}/>
  <rect x="120" y="114" width="34" height="74" rx="17" fill="#000" opacity=".12"/>
  <line x1="103" y1="130" x2="103" y2="180" stroke="#fff" stroke-width="5" stroke-dasharray="7 6"/>
  <rect x="48" y="174" width="110" height="18" rx="9" fill="#fff" ${S}/>
  <ellipse cx="44" cy="150" rx="15" ry="20" fill="${c}" ${S}/>
  <rect x="38" y="16" width="130" height="116" rx="54" fill="${c}" ${S}/>
  <circle cx="103" cy="16" r="13" fill="#fff" ${S}/>
  <ellipse cx="103" cy="78" rx="48" ry="42" fill="#fff" ${S} stroke-dasharray="10 3"/>
  <ellipse cx="103" cy="80" rx="35" ry="30" fill="${DARK}"/>
  <circle cx="90" cy="78" r="8" fill="#fff"/><circle cx="116" cy="78" r="8" fill="#fff"/>
  <circle cx="92" cy="80" r="3.5" fill="${DARK}"/><circle cx="118" cy="80" r="3.5" fill="${DARK}"/>
  <ellipse cx="80" cy="94" rx="6" ry="3.5" fill="#ff8fb8"/><ellipse cx="126" cy="94" rx="6" ry="3.5" fill="#ff8fb8"/>
  <rect x="58" y="114" width="90" height="20" rx="10" fill="#fff" ${S}/>
  <rect x="78" y="116" width="10" height="16" fill="${c}"/><rect x="100" y="116" width="10" height="16" fill="${c}"/><rect x="122" y="116" width="10" height="16" fill="${c}"/>
  <path d="M128 128l8 34-16 2-6-34z" fill="#fff" ${S}/>`;

// Neon: angular cyber helmet with an LED visor.
const neon: Draw = (c) => `
  <path d="M62 166h30v48H62zM112 166h30v48h-30z" fill="${INK}"/>
  <path d="M70 176v28M134 176v28" stroke="#3ff6ff" stroke-width="4" stroke-linecap="round"/>
  <path d="M56 116h94l-8 70H64z" fill="${c}" ${S}/>
  <path d="M126 116h24l-8 70h-20z" fill="#000" opacity=".14"/>
  <path d="M80 132h46l-6 20H86z" fill="${DARK}"/>
  <path d="M90 142h26" stroke="#3ff6ff" stroke-width="4" stroke-linecap="round"/>
  <rect x="32" y="126" width="30" height="48" rx="8" fill="${c}" ${S} transform="rotate(10 47 150)"/>
  <path d="M38 160h18" stroke="#3ff6ff" stroke-width="4" stroke-linecap="round" transform="rotate(10 47 150)"/>
  <path d="M150 30l14-24 4 30z" fill="${INK}"/>
  <path d="M58 18h90l20 38v46l-20 24H58l-20-24V56z" fill="${c}" ${S}/>
  <path d="M128 18h20l20 38v46l-20 24h-20z" fill="#000" opacity=".14"/>
  <path d="M38 64l-14 6v26l14 6zM168 64l14 6v26l-14 6z" fill="${INK}"/>
  <rect x="48" y="58" width="110" height="34" rx="8" fill="${DARK}"/>
  <rect x="62" y="66" width="32" height="14" rx="4" fill="#3ff6ff" opacity=".35"/>
  <rect x="112" y="66" width="32" height="14" rx="4" fill="#3ff6ff" opacity=".35"/>
  <rect x="66" y="69" width="24" height="8" rx="3" fill="#3ff6ff"/>
  <rect x="116" y="69" width="24" height="8" rx="3" fill="#3ff6ff"/>
  <path d="M86 106h34" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>`;

// Candy: glossy gummy bear with sprinkles.
const gummy: Draw = (c) => `
  <ellipse cx="78" cy="204" rx="20" ry="13" fill="${c}" ${S}/>
  <ellipse cx="128" cy="204" rx="20" ry="13" fill="${c}" ${S}/>
  <ellipse cx="103" cy="160" rx="52" ry="46" fill="${c}" ${S}/>
  <ellipse cx="103" cy="166" rx="30" ry="26" fill="#fff" opacity=".28"/>
  <ellipse cx="50" cy="150" rx="14" ry="20" fill="${c}" ${S} transform="rotate(25 50 150)"/>
  <ellipse cx="156" cy="150" rx="14" ry="20" fill="${c}" ${S} transform="rotate(-25 156 150)"/>
  <circle cx="58" cy="28" r="20" fill="${c}" ${S}/><circle cx="148" cy="28" r="20" fill="${c}" ${S}/>
  <circle cx="58" cy="28" r="9" fill="#000" opacity=".15"/><circle cx="148" cy="28" r="9" fill="#000" opacity=".15"/>
  <ellipse cx="103" cy="72" rx="62" ry="54" fill="${c}" ${S}/>
  <path d="M60 50q12-24 40-26" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round" opacity=".7"/>
  <path d="M72 130q8-6 18-4" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" opacity=".6"/>
  <ellipse cx="103" cy="92" rx="22" ry="16" fill="#fff" opacity=".35"/>
  <circle cx="82" cy="72" r="8" fill="${DARK}"/><circle cx="124" cy="72" r="8" fill="${DARK}"/>
  <circle cx="85" cy="69" r="3" fill="#fff"/><circle cx="127" cy="69" r="3" fill="#fff"/>
  <ellipse cx="103" cy="86" rx="8" ry="6" fill="${DARK}"/>
  <path d="M94 96q9 8 18 0" stroke="${DARK}" stroke-width="4" fill="none" stroke-linecap="round"/>
  <ellipse cx="68" cy="90" rx="8" ry="4.5" fill="#ff8fb8"/><ellipse cx="138" cy="90" rx="8" ry="4.5" fill="#ff8fb8"/>
  <g stroke-width="5" stroke-linecap="round">
    <path d="M118 40l8-4" stroke="#ff6fb5"/><path d="M136 54l4 7" stroke="#46c2f0"/>
    <path d="M86 42l-3 7" stroke="#ffd400"/><path d="M108 28l7 2" stroke="#fff"/>
  </g>`;

// Nexus wanderer: gnome with a pointy hat, a big beard and a star.
const gnome: Draw = (c) => `
  <ellipse cx="78" cy="208" rx="20" ry="10" fill="${INK}"/>
  <ellipse cx="128" cy="208" rx="20" ry="10" fill="${INK}"/>
  <path d="M66 112h74l18 94H48z" fill="${c}" ${S}/>
  <path d="M120 112h20l18 94h-26z" fill="#000" opacity=".14"/>
  <circle cx="46" cy="164" r="13" fill="${INK}"/><circle cx="160" cy="164" r="13" fill="${INK}"/>
  <path d="M56 100q-2 56 47 84 49-28 47-84z" fill="#fff" ${S}/>
  <path d="M103 122q-16-6-30 6 14 10 30 0 16 10 30 0-14-12-30-6z" fill="#fff" ${S}/>
  <circle cx="103" cy="110" r="15" fill="#ff9f8a" ${S}/>
  <circle cx="98" cy="105" r="4" fill="#fff" opacity=".7"/>
  <path d="M40 98C58 62 78 34 100 6c4-5 12-3 12 4 6 34 30 64 54 88z" fill="${c}" ${S}/>
  <path d="M112 10c6 34 30 64 54 88h-30C124 72 114 40 112 10z" fill="#000" opacity=".14"/>
  <rect x="34" y="88" width="138" height="20" rx="10" fill="${c}" ${S}/>
  <rect x="34" y="88" width="138" height="20" rx="10" fill="#000" opacity=".18"/>
  <path d="M103 46l5 11 12 1-9 8 3 12-11-6-11 6 3-12-9-8 12-1z" fill="#ffd400" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;

// Where the character holds the sword, and the hand drawn over its handle.
interface Skin { draw: Draw; hand: [number, number]; handFill?: (c: string) => string }

const SKINS: Record<string, Skin> = {
  helmet: { draw: helmet, hand: [150, 152] },
  astro: { draw: astro, hand: [154, 154] },
  parka: { draw: parka, hand: [156, 156] },
  neon: { draw: neon, hand: [152, 156] },
  gummy: { draw: gummy, hand: [158, 152], handFill: (c) => c },
  gnome: { draw: gnome, hand: [160, 164] },
};

// Everyone carries a sword, whatever their role: it gives nothing away.
const sword = (x: number, y: number) => `<g transform="translate(${x} ${y}) rotate(42)">
    <rect x="-6" y="-150" width="12" height="136" rx="3" fill="#e9e6ef"/>
    <rect x="0" y="-150" width="6" height="136" rx="3" fill="#c9c4d4"/>
    <rect x="-18" y="-18" width="36" height="10" rx="4" fill="#5a3b22"/>
    <rect x="-6" y="-10" width="12" height="28" rx="4" fill="#3a2716"/>
  </g>`;

// Character body only (no shadow, no filter), in the 0 0 220 230 box. The sword tip can reach x≈250.
export function characterSvg(color: string, look: Look = { skin: "helmet" }): string {
  const skin = SKINS[look.skin] ?? SKINS.helmet;
  const [hx, hy] = skin.hand;
  const fist = `<circle cx="${hx}" cy="${hy}" r="15" fill="${skin.handFill?.(color) ?? INK}"${skin.handFill ? ` ${S}` : ""}/>`;
  return skin.draw(color) + sword(hx, hy) + fist;
}

export function avatarSvg(color: string, { sticker = false, ghost = false, look = { skin: "helmet" } as Look } = {}): string {
  return `<svg class="hero-char" overflow="visible" viewBox="0 0 220 230" aria-hidden="true">
  <defs><filter id="sticker" x="-20%" y="-20%" width="140%" height="140%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="grow"/>
    <feFlood flood-color="#fff"/><feComposite in2="grow" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter></defs>
  <ellipse cx="105" cy="218" rx="70" ry="9" fill="#000" opacity=".18"/>
  <g${sticker ? ' filter="url(#sticker)"' : ""}${ghost ? ' opacity=".55"' : ""}>${characterSvg(color, look)}
  </g>
</svg>`;
}

// Standalone SVG for a Phaser texture: wider box so the sword fits, explicit pixel size.
export const TEXTURE_BOX = { x: -10, y: -12, w: 280, h: 236 };
export function textureSvg(color: string, look: Look, scale: number): string {
  const b = TEXTURE_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${b.w * scale}" height="${b.h * scale}" viewBox="${b.x} ${b.y} ${b.w} ${b.h}">${characterSvg(color, look)}</svg>`;
}
