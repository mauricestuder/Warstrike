export type Quality = 'low' | 'high';

export interface Settings {
  /** Degrees of turn per mouse count ×100 (Valorant/CS style number). */
  sens: number;
  /** Multiplier applied while aiming down sights (1 = same feel, scaled by zoom). */
  adsSens: number;
  fov: number;
  quality: Quality;
  volume: number;
  showFps: boolean;
}

const KEY = 'warstrike.settings';
const DEFAULTS: Settings = { sens: 2.2, adsSens: 1, fov: 90, quality: 'high', volume: 0.7, showFps: true };

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
