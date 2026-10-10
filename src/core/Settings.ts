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
}

const KEY = 'warstrike.settings';
const DEFAULTS: Settings = { sens: 2.2, adsSens: 1, scopeSens: 1, view: 'third', fov: 90, quality: 'high', volume: 0.7, showFps: true };

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
