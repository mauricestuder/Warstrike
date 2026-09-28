import './style.css';
import { loadSettings, saveSettings, type Quality } from './core/Settings';
import { Game } from './Game';

const settings = loadSettings();
const game = new Game(settings);
(window as unknown as { game: Game }).game = game;

const menu = document.getElementById('menu')!;
const play = document.getElementById('play') as HTMLButtonElement;
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function start() {
  game.sfx.unlock();
  game.input.lock();
}

play.addEventListener('click', start);
// Clicking the game view while paused also resumes.
game.renderer.gl.domElement.addEventListener('click', () => { if (!game.input.locked) start(); });

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === game.renderer.gl.domElement;
  game.running = locked;
  menu.classList.toggle('hidden', locked);
  if (locked) {
    play.textContent = 'RESUME';
    if (!sessionStorage.getItem('warstrike.welcomed')) {
      game.hud.showHint('Welcome to the range · steel downrange, bots right, wallbang lane left, movement course behind you', 6);
      sessionStorage.setItem('warstrike.welcomed', '1');
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
    game.applySettings();
  });
}
const quality = byId<HTMLSelectElement>('s-quality');
quality.value = settings.quality;
quality.addEventListener('change', () => {
  settings.quality = quality.value as Quality;
  saveSettings(settings);
  byId('quality-note').textContent = 'Reloading to apply graphics…';
  setTimeout(() => location.reload(), 300);
});
const fps = byId<HTMLInputElement>('s-fps');
fps.checked = settings.showFps;
fps.addEventListener('change', () => { settings.showFps = fps.checked; saveSettings(settings); game.applySettings(); });

for (const b of document.querySelectorAll<HTMLButtonElement>('.tabs button')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('.tabs button, .tab')) o.classList.remove('on');
    b.classList.add('on');
    byId(`tab-${b.dataset.tab}`).classList.add('on');
  });
}
byId('help-body').innerHTML = byId('tab-controls').innerHTML;
