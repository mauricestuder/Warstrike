import './style.css';
import { loadSettings, saveSettings, type Quality } from './core/Settings';
import { Game, type MapId } from './Game';

const settings = loadSettings();
let game: Game | null = null;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = byId('menu'), play = byId<HTMLButtonElement>('play'), leave = byId<HTMLButtonElement>('leave');
const maps = byId('maps'), sub = byId('sub');
const MAP_NAMES: Record<MapId, string> = { range: 'Gun range', town: 'Harbor Outskirts' };

function resume() {
  if (!game) return;
  game.sfx.unlock();
  game.input.lock();
}

/** Builds the chosen map (the town takes a moment to generate), then drops you in. */
function start(map: MapId) {
  for (const b of maps.querySelectorAll('button')) b.disabled = true;
  sub.textContent = `Building ${MAP_NAMES[map]}…`;
  // Let the "Building…" text paint before the heavy work; pointer lock still counts as part of this click.
  setTimeout(() => {
    game = new Game(settings, map);
    (window as unknown as { game: Game }).game = game;
    maps.classList.add('hidden');
    play.classList.remove('hidden');
    leave.classList.remove('hidden');
    play.textContent = 'PLAY';
    sub.textContent = `${MAP_NAMES[map]} · build 0.2`;
    game.renderer.gl.domElement.addEventListener('click', () => { if (game && !game.input.locked) resume(); });
    resume();
  }, 30);
}

for (const b of maps.querySelectorAll<HTMLButtonElement>('button.map')) b.addEventListener('click', () => start(b.dataset.map as MapId));
play.addEventListener('click', resume);
leave.addEventListener('click', () => location.reload());
(window as unknown as { startMap: (m: MapId) => void }).startMap = start;

document.addEventListener('pointerlockchange', () => {
  if (!game) return;
  const locked = document.pointerLockElement === game.renderer.gl.domElement;
  game.running = locked;
  menu.classList.toggle('hidden', locked);
  if (locked) {
    play.textContent = 'RESUME';
    const key = `warstrike.welcomed.${game.map}`;
    if (!sessionStorage.getItem(key)) {
      game.hud.showHint(game.world.welcome, 7);
      sessionStorage.setItem(key, '1');
    }
  }
});

// --- Settings panel ---
const sliders: [string, keyof typeof settings, (v: number) => string][] = [
  ['sens', 'sens', (v) => v.toFixed(2)],
  ['ads', 'adsSens', (v) => v.toFixed(2)],
  ['fov', 'fov', (v) => `${v}°`],
  ['vol', 'volume', (v) => `${Math.round(v * 100)}%`],
];
for (const [id, key, fmt] of sliders) {
  const input = byId<HTMLInputElement>(`s-${id}`), out = byId<HTMLOutputElement>(`o-${id}`);
  input.value = String(settings[key]);
  out.textContent = fmt(Number(input.value));
  input.addEventListener('input', () => {
    (settings[key] as number) = Number(input.value);
    out.textContent = fmt(Number(input.value));
    saveSettings(settings);
    game?.applySettings();
  });
}
const quality = byId<HTMLSelectElement>('s-quality');
quality.value = settings.quality;
quality.addEventListener('change', () => {
  settings.quality = quality.value as Quality;
  saveSettings(settings);
  if (!game) { byId('quality-note').textContent = 'Applies when the map loads.'; return; }
  byId('quality-note').textContent = 'Reloading to apply graphics…';
  setTimeout(() => location.reload(), 300);
});
const fps = byId<HTMLInputElement>('s-fps');
fps.checked = settings.showFps;
fps.addEventListener('change', () => { settings.showFps = fps.checked; saveSettings(settings); game?.applySettings(); });

for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('.tabs button, .tab')) o.classList.remove('on');
    b.classList.add('on');
    byId(`tab-${b.dataset.tab}`).classList.add('on');
  });
}
byId('help-body').innerHTML = byId('tab-controls').innerHTML;
