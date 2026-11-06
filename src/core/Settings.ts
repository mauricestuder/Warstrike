export type Quality = 'low' | 'high' | 'ultra';

export interface Settings {
  /** Degrees of turn per mouse count ×100 (Valorant/CS style number). */
  sens: number;
  /** Multiplier while aiming down red dots and iron sights (1 = same feel as hip fire, matched to the zoom). */
  adsSens: number;
  /** Multiplier while looking through the sniper scope (1 = matched to the zoom). */
  scopeSens: number;
  /** Third-person (over the shoulder) or first-person camera. Aiming down sights always goes to first person. */
  view: 'third' | 'first';
  fov: number;
  quality: Quality;
  volume: number;
  showFps: boolean;
  /** Arrow-key turn speed (× 150°/s). */
  keySens: number;
  /** Touch look speed (×). */
  touchSens: number;
  /** Gentle aim assist when you aim with the arrow keys or a touch screen (never with the mouse). */
  aimAssist: boolean;
  /** Play without capturing the mouse: arrow keys aim. */
  keyboardOnly: boolean;
}

const KEY = 'warstrike.settings';
const DEFAULTS: Settings = { sens: 2.2, adsSens: 1, scopeSens: 1, view: 'third', fov: 90, quality: 'high', volume: 0.7, showFps: true,
  keySens: 1, touchSens: 1, aimAssist: true, keyboardOnly: false };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* storage blocked: use defaults */ }
  return { ...DEFAULTS };
}

export function saveSettings(s: Settings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
