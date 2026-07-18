/**
 * 10 cozy arcade pilot portraits — flat animated style matching PokyPlane.
 * 6 male · 4 female · American / Asian / Persian / European
 */

export const PROFILE_AVATARS = [
  {
    id: 'pilot_1',
    label: 'Jake — Sky Ace',
    gender: 'male',
    region: 'american',
    color: '#ff6b4a',
    bg: ['#ff8a5c', '#ff6b4a', '#c44d34'],
  },
  {
    id: 'pilot_2',
    label: 'Ken — Cloud Rider',
    gender: 'male',
    region: 'asian',
    color: '#3b82f6',
    bg: ['#93c5fd', '#3b82f6', '#1d4ed8'],
  },
  {
    id: 'pilot_3',
    label: 'Amir — Desert Hawk',
    gender: 'male',
    region: 'persian',
    color: '#d97706',
    bg: ['#fbbf24', '#d97706', '#0d9488'],
  },
  {
    id: 'pilot_4',
    label: 'Marco — Euro Jet',
    gender: 'male',
    region: 'european',
    color: '#6366f1',
    bg: ['#a5b4fc', '#6366f1', '#4338ca'],
  },
  {
    id: 'pilot_5',
    label: 'Lars — Frost Pilot',
    gender: 'male',
    region: 'european',
    color: '#06b6d4',
    bg: ['#67e8f9', '#06b6d4', '#0e7490'],
  },
  {
    id: 'pilot_6',
    label: 'Devon — Twilight Flyer',
    gender: 'male',
    region: 'american',
    color: '#a855f7',
    bg: ['#c084fc', '#7c3aed', '#f97316'],
  },
  {
    id: 'pilot_7',
    label: 'Mia — Sunburst',
    gender: 'female',
    region: 'american',
    color: '#f472b6',
    bg: ['#fda4af', '#f472b6', '#fb923c'],
  },
  {
    id: 'pilot_8',
    label: 'Yuki — Sakura Wing',
    gender: 'female',
    region: 'asian',
    color: '#ec4899',
    bg: ['#f9a8d4', '#ec4899', '#818cf8'],
  },
  {
    id: 'pilot_9',
    label: 'Shirin — Golden Horizon',
    gender: 'female',
    region: 'persian',
    color: '#eab308',
    bg: ['#fde047', '#eab308', '#e11d48'],
  },
  {
    id: 'pilot_10',
    label: 'Emma — Meadow Ace',
    gender: 'female',
    region: 'european',
    color: '#22c55e',
    bg: ['#86efac', '#22c55e', '#0ea5e9'],
  },
];

function grad(id, colors) {
  const stops = colors
    .map((c, i) => `<stop offset="${(i / (colors.length - 1)) * 100}%" stop-color="${c}"/>`)
    .join('');
  return `<linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">${stops}</linearGradient>`;
}

/** Shared face parts — arcade flat style */
function goggles(y = 38) {
  return `
    <ellipse cx="36" cy="${y}" rx="11" ry="9" fill="#1e293b" opacity="0.85"/>
    <ellipse cx="64" cy="${y}" rx="11" ry="9" fill="#1e293b" opacity="0.85"/>
    <ellipse cx="36" cy="${y}" rx="8" ry="6.5" fill="#7dd3fc" opacity="0.9"/>
    <ellipse cx="64" cy="${y}" rx="8" ry="6.5" fill="#7dd3fc" opacity="0.9"/>
    <ellipse cx="35" cy="${y - 1}" rx="3" ry="2" fill="#fff" opacity="0.55"/>
    <ellipse cx="63" cy="${y - 1}" rx="3" ry="2" fill="#fff" opacity="0.55"/>
    <rect x="44" y="${y - 3}" width="12" height="4" rx="2" fill="#334155"/>
  `;
}

function scarf(color = '#ff6b4a') {
  return `<path d="M28 72 Q50 88 72 72 L68 82 Q50 94 32 82 Z" fill="${color}"/>
    <path d="M32 82 Q50 90 68 82" stroke="rgba(0,0,0,0.15)" fill="none" stroke-width="1"/>`;
}

const FACES = {
  pilot_1: (skin, hair) => `
    <ellipse cx="50" cy="52" rx="26" ry="30" fill="${skin}"/>
    <path d="M24 42 Q50 18 76 42" fill="${hair}"/>
    <path d="M24 42 Q30 55 24 68 Q34 58 50 56 Q66 58 76 68 Q70 55 76 42" fill="${hair}"/>
    <ellipse cx="38" cy="54" rx="3" ry="4" fill="#1e293b"/>
    <ellipse cx="62" cy="54" rx="3" ry="4" fill="#1e293b"/>
    <path d="M44 66 Q50 72 56 66" stroke="#c2410c" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${goggles(40)}
    ${scarf('#ffd166')}
  `,
  pilot_2: (skin, hair) => `
    <ellipse cx="50" cy="52" rx="25" ry="29" fill="${skin}"/>
    <path d="M26 44 Q50 20 74 44 L74 52 Q50 38 26 52 Z" fill="${hair}"/>
    <ellipse cx="38" cy="54" rx="3.5" ry="4" fill="#0f172a"/>
    <ellipse cx="62" cy="54" rx="3.5" ry="4" fill="#0f172a"/>
    <path d="M46 66 Q50 70 54 66" stroke="#334155" stroke-width="1.8" fill="none"/>
    ${goggles(39)}
    <path d="M30 78 Q50 86 70 78" stroke="#1e40af" stroke-width="3" fill="none" stroke-linecap="round"/>
  `,
  pilot_3: (skin, hair) => `
    <ellipse cx="50" cy="52" rx="26" ry="30" fill="${skin}"/>
    <path d="M24 40 Q50 16 76 40 Q72 58 50 50 Q28 58 24 40" fill="${hair}"/>
    <path d="M30 36 Q50 28 70 36" stroke="${hair}" stroke-width="0" fill="${hair}" opacity="0"/>
    <ellipse cx="38" cy="54" rx="3.5" ry="4.5" fill="#1c1917"/>
    <ellipse cx="62" cy="54" rx="3.5" ry="4.5" fill="#1c1917"/>
  <path d="M42 68 Q50 74 58 68" stroke="#92400e" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path d="M34 62 Q38 64 42 62" stroke="#1c1917" stroke-width="1.2" fill="none"/>
    <path d="M58 62 Q62 64 66 62" stroke="#1c1917" stroke-width="1.2" fill="none"/>
    ${scarf('#0d9488')}
    <ellipse cx="50" cy="34" rx="8" ry="4" fill="none" stroke="#d97706" stroke-width="2"/>
  `,
  pilot_4: (skin, hair) => `
    <ellipse cx="50" cy="52" rx="25" ry="29" fill="${skin}"/>
    <path d="M26 42 Q50 22 74 42 Q70 60 50 54 Q30 60 26 42" fill="${hair}"/>
    <ellipse cx="38" cy="54" rx="3" ry="4" fill="#1e293b"/>
    <ellipse cx="62" cy="54" rx="3" ry="4" fill="#1e293b"/>
    <path d="M44 66 Q50 71 56 66" stroke="#b45309" stroke-width="1.8" fill="none"/>
    ${goggles(40)}
    <rect x="42" y="74" width="16" height="6" rx="2" fill="#4338ca"/>
  `,
  pilot_5: (skin, hair) => `
    <ellipse cx="50" cy="52" rx="25" ry="29" fill="${skin}"/>
    <path d="M26 44 Q50 18 74 44 L72 56 Q50 46 28 56 Z" fill="${hair}"/>
    <ellipse cx="38" cy="54" rx="3" ry="3.5" fill="#0f172a"/>
    <ellipse cx="62" cy="54" rx="3" ry="3.5" fill="#0f172a"/>
    <path d="M45 66 Q50 69 55 66" stroke="#64748b" stroke-width="1.5" fill="none"/>
    ${goggles(38)}
    <path d="M34 76 L66 76 L62 84 L38 84 Z" fill="#0e7490"/>
    <circle cx="50" cy="30" r="3" fill="#e2e8f0"/>
  `,
  pilot_6: (skin, hair) => `
    <ellipse cx="50" cy="52" rx="26" ry="30" fill="${skin}"/>
    <path d="M24 42 Q50 20 76 42 Q74 62 50 56 Q26 62 24 42" fill="${hair}"/>
    <ellipse cx="38" cy="54" rx="3.5" ry="4" fill="#0f172a"/>
    <ellipse cx="62" cy="54" rx="3.5" ry="4" fill="#0f172a"/>
    <ellipse cx="38" cy="53" rx="1" ry="1.2" fill="#fff" opacity="0.5"/>
    <ellipse cx="62" cy="53" rx="1" ry="1.2" fill="#fff" opacity="0.5"/>
    <path d="M44 67 Q50 73 56 67" stroke="#7c2d12" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${goggles(40)}
    ${scarf('#a855f7')}
  `,
  pilot_7: (skin, hair) => `
    <ellipse cx="50" cy="54" rx="24" ry="28" fill="${skin}"/>
    <path d="M28 46 Q50 24 72 46 Q68 62 50 56 Q32 62 28 46" fill="${hair}"/>
    <ellipse cx="38" cy="56" rx="3.5" ry="4.5" fill="#1e293b"/>
    <ellipse cx="62" cy="56" rx="3.5" ry="4.5" fill="#1e293b"/>
    <ellipse cx="39" cy="55" rx="1.2" ry="1.5" fill="#fff" opacity="0.45"/>
    <ellipse cx="63" cy="55" rx="1.2" ry="1.5" fill="#fff" opacity="0.45"/>
    <path d="M44 68 Q50 74 56 68" stroke="#db2777" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="34" cy="62" rx="4" ry="2.5" fill="#fda4af" opacity="0.45"/>
    <ellipse cx="66" cy="62" rx="4" ry="2.5" fill="#fda4af" opacity="0.45"/>
    <path d="M30 78 Q50 90 70 78 L66 86 Q50 96 34 86 Z" fill="#fb923c"/>
  `,
  pilot_8: (skin, hair) => `
    <ellipse cx="50" cy="54" rx="23" ry="27" fill="${skin}"/>
    <path d="M30 48 Q50 26 70 48 L68 58 Q50 48 32 58 Z" fill="${hair}"/>
    <circle cx="28" cy="52" r="5" fill="${hair}"/>
    <circle cx="72" cy="52" r="5" fill="${hair}"/>
    <ellipse cx="38" cy="56" rx="3.5" ry="4" fill="#1e293b"/>
    <ellipse cx="62" cy="56" rx="3.5" ry="4" fill="#1e293b"/>
    <path d="M46 69 Q50 72 54 69" stroke="#be185d" stroke-width="1.6" fill="none"/>
    <ellipse cx="35" cy="63" rx="3.5" ry="2" fill="#fbcfe8" opacity="0.5"/>
    <ellipse cx="65" cy="63" rx="3.5" ry="2" fill="#fbcfe8" opacity="0.5"/>
    <path d="M32 80 Q50 92 68 80" stroke="#818cf8" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="40" cy="30" r="2" fill="#f9a8d4" opacity="0.8"/>
    <circle cx="60" cy="28" r="2.5" fill="#f9a8d4" opacity="0.7"/>
  `,
  pilot_9: (skin, hair) => `
    <ellipse cx="50" cy="54" rx="24" ry="28" fill="${skin}"/>
    <path d="M26 46 Q50 22 74 46 Q70 64 50 58 Q30 64 26 46" fill="${hair}"/>
    <ellipse cx="38" cy="56" rx="3.5" ry="4.5" fill="#1c1917"/>
    <ellipse cx="62" cy="56" rx="3.5" ry="4.5" fill="#1c1917"/>
    <path d="M44 69 Q50 75 56 69" stroke="#b45309" stroke-width="2" fill="none" stroke-linecap="round"/>
    <ellipse cx="34" cy="62" rx="4" ry="2.5" fill="#fcd34d" opacity="0.35"/>
    <ellipse cx="66" cy="62" rx="4" ry="2.5" fill="#fcd34d" opacity="0.35"/>
    <path d="M28 78 Q50 94 72 78 L68 88 Q50 100 32 88 Z" fill="#e11d48"/>
    <path d="M42 32 Q50 26 58 32" stroke="#eab308" stroke-width="2" fill="none"/>
    <circle cx="50" cy="28" r="3" fill="#fde047"/>
  `,
  pilot_10: (skin, hair) => `
    <ellipse cx="50" cy="54" rx="24" ry="28" fill="${skin}"/>
    <path d="M28 46 Q50 24 72 46 Q50 40 28 46" fill="${hair}"/>
    <path d="M28 46 Q34 68 28 78 Q40 66 50 62 Q60 66 72 78 Q66 68 72 46" fill="${hair}"/>
    <ellipse cx="38" cy="56" rx="3" ry="4" fill="#1e293b"/>
    <ellipse cx="62" cy="56" rx="3" ry="4" fill="#1e293b"/>
    <path d="M45 69 Q50 73 55 69" stroke="#ca8a04" stroke-width="1.6" fill="none"/>
    <ellipse cx="35" cy="62" rx="3.5" ry="2" fill="#fecdd3" opacity="0.45"/>
    <ellipse cx="65" cy="62" rx="3.5" ry="2" fill="#fecdd3" opacity="0.45"/>
    ${goggles(41)}
    <rect x="40" y="78" width="20" height="5" rx="2" fill="#22c55e"/>
  `,
};

const PALETTES = {
  pilot_1: { skin: '#f5c99a', hair: '#c2410c' },
  pilot_2: { skin: '#f0c8a0', hair: '#1e293b' },
  pilot_3: { skin: '#d4a574', hair: '#1c1917' },
  pilot_4: { skin: '#f0b88a', hair: '#3f3f46' },
  pilot_5: { skin: '#f5d0b5', hair: '#cbd5e1' },
  pilot_6: { skin: '#8d5524', hair: '#1c1917' },
  pilot_7: { skin: '#f5c99a', hair: '#ea580c' },
  pilot_8: { skin: '#f5d0b5', hair: '#1e293b' },
  pilot_9: { skin: '#d4a574', hair: '#1c1917' },
  pilot_10: { skin: '#f0b88a', hair: '#a16207' },
};

export function getAvatarMeta(id) {
  return PROFILE_AVATARS.find((a) => a.id === id) || PROFILE_AVATARS[0];
}

export function avatarSvg(id, size = 100) {
  const meta = getAvatarMeta(id);
  const pal = PALETTES[id] || PALETTES.pilot_1;
  const face = FACES[id]?.(pal.skin, pal.hair) || FACES.pilot_1(pal.skin, pal.hair);
  const gid = `bg-${id}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" class="pilot-face-svg" aria-hidden="true">
    <defs>${grad(gid, meta.bg)}</defs>
    <rect width="100" height="100" rx="18" fill="url(#${gid})"/>
    <circle cx="82" cy="18" r="14" fill="#fff" opacity="0.12"/>
    <circle cx="18" cy="82" r="10" fill="#fff" opacity="0.08"/>
    <ellipse cx="50" cy="108" rx="40" ry="20" fill="rgba(0,0,0,0.08)"/>
    ${face}
    <path d="M20 18 L28 14 L24 22 Z" fill="#fff" opacity="0.35"/>
  </svg>`;
}

export function mountAvatar(el, id, size) {
  if (!el) return;
  el.innerHTML = avatarSvg(id, size);
  el.classList.add('pilot-avatar-mount');
  el.dataset.avatarId = id;
}
