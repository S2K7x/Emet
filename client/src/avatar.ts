// "Chibi helmet" character in SVG (HTML screens). The color is the player's.
// sticker: white outline around the character (not the shadow), so it stays readable on a background of the same color.
export function avatarSvg(color: string, { sticker = false, ghost = false } = {}): string {
  return `<svg class="hero-char" overflow="visible" viewBox="0 0 220 230" aria-hidden="true">
  <defs><filter id="sticker" x="-20%" y="-20%" width="140%" height="140%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="5" result="grow"/>
    <feFlood flood-color="#fff"/><feComposite in2="grow" operator="in"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter></defs>
  <ellipse cx="105" cy="218" rx="70" ry="9" fill="#000" opacity=".18"/>
  <g${sticker ? ' filter="url(#sticker)"' : ""}${ghost ? ' opacity=".55"' : ""}>
  <rect x="62" y="168" width="30" height="46" rx="10" fill="#2b2530"/>
  <rect x="112" y="168" width="30" height="46" rx="10" fill="#2b2530"/>
  <rect x="58" y="118" width="88" height="66" rx="18" fill="#2b2530"/>
  <rect x="78" y="124" width="48" height="58" rx="8" fill="#fff"/>
  <rect x="94" y="124" width="16" height="58" fill="${color}"/>
  <rect x="40" y="128" width="40" height="52" rx="8" fill="${color}" stroke="#2b2530" stroke-width="5"/>
  <rect x="38" y="14" width="128" height="116" rx="20" fill="${color}"/>
  <rect x="128" y="14" width="38" height="116" rx="20" fill="#000" opacity=".14"/>
  <path d="M90 14h24v44h34v40c0 10-8 18-18 18H74c-10 0-18-8-18-18V58h34z" fill="#fff"/>
  <path d="M68 70l26 9-3 10-25-7z" fill="#17131c"/>
  <path d="M136 70l-26 9 3 10 25-7z" fill="#17131c"/>
  <path d="M102 92l4 10-4 10-4-10z" fill="#17131c"/>
  <g transform="translate(150 152) rotate(42)">
    <rect x="-6" y="-150" width="12" height="136" rx="3" fill="#e9e6ef"/>
    <rect x="0" y="-150" width="6" height="136" rx="3" fill="#c9c4d4"/>
    <rect x="-18" y="-18" width="36" height="10" rx="4" fill="#5a3b22"/>
    <rect x="-6" y="-10" width="12" height="28" rx="4" fill="#3a2716"/>
  </g>
  <circle cx="150" cy="152" r="15" fill="#2b2530"/>
  </g>
</svg>`;
}
