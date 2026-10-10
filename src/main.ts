import './style.css';
import { loadSettings, saveSettings, type Quality } from './core/Settings';
import { Game, type MapId } from './Game';

const settings = loadSettings();
let game: Game | null = null;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const menu = byId('menu'), play = byId<HTMLButtonElement>('play'), leave = byId<HTMLButtonElement>('leave');
const maps = byId('maps'), sub = byId('sub');
const MAP_NAMES: Record<MapId, string> = { range: 'Gun range', town: 'Calvert', br: 'Battle royale' };

function resume() {
  if (!game) return;
  game.sfx.unlock();
  game.input.lock();
}

const TIPS = [
  'Double-tap Shift for a tactical sprint — the fastest way across open ground.',
  'Sprint, then crouch to slide. Jump out of a slide to keep its speed.',
  'Jump into a ledge and hold Space to mantle up to two metres.',
  'V switches between third and first person. Aiming always looks down the sights.',
  'Bullets drop and slow down: hold over far targets with the sniper.',
  'Thin walls and wood don\'t stop bullets. Concrete a metre thick does.',
  'Corn and bushes hide you from the bots — until you fire from inside them.',
  'Hold Shift while scoped to steady your breath for a few seconds.',
  'The bar under your crosshair is your magazine. It turns red when you\'re nearly empty.',
  'Plate up with 4 before you push: three plates soak 150 damage.',
];

const loader = byId('loader'), loadBar = byId('load-bar'), loadStep = byId('load-step'), loadPct = byId('load-pct');
const deploy = byId<HTMLButtonElement>('deploy');
/** Lets the browser paint the loading screen between build steps. */
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Shows the loading screen while the map builds a step at a time, then waits for you to deploy. */
async function start(map: MapId) {
  for (const b of maps.querySelectorAll('button')) b.disabled = true;
  menu.classList.add('hidden');
  byId('load-map').textContent = map === 'range' ? 'GUN RANGE' : map === 'br' ? 'BATTLE ROYALE · CALVERT' : 'CALVERT · FREE ROAM';
  byId('load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  loader.classList.remove('hidden', 'done');
  let tipT = setInterval(() => { byId('load-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)]; }, 4500);
  await nextFrame();
  const g = game = new Game(settings, map);
  (window as unknown as { game: Game }).game = g;
  await g.load(async (f, label) => {
    loadBar.style.transform = `scaleX(${f.toFixed(3)})`;
    loadStep.textContent = `${label}…`;
    loadPct.textContent = `${Math.round(f * 100)}%`;
    await nextFrame();
  });
  clearInterval(tipT);
  tipT = 0 as unknown as ReturnType<typeof setInterval>;
  loadStep.textContent = 'Ready';
  loader.classList.add('done');
  maps.classList.add('hidden');
  play.classList.remove('hidden');
  leave.classList.remove('hidden');
  play.textContent = 'PLAY';
  sub.textContent = `${MAP_NAMES[map]} · build 0.8`;
  g.renderer.gl.domElement.addEventListener('click', () => { if (game && !game.input.locked) resume(); });
  deploy.focus();
}

deploy.addEventListener('click', () => {
  loader.classList.add('hidden');
  menu.classList.remove('hidden');
  resume();
});

for (const b of maps.querySelectorAll<HTMLButtonElement>('button.map')) b.addEventListener('click', () => start(b.dataset.map as MapId));
play.addEventListener('click', resume);
leave.addEventListener('click', () => location.reload());
(window as unknown as { startMap: (m: MapId) => void }).startMap = start;
// "Play again" after a match: rebuild the battle royale straight away (you still click PLAY to grab the mouse).
if (sessionStorage.getItem('warstrike.autostart') === 'br') {
  sessionStorage.removeItem('warstrike.autostart');
  start('br');
}

document.addEventListener('pointerlockchange', () => {
  if (!game?.ready) return;
  const locked = document.pointerLockElement === game.renderer.gl.domElement;
  game.running = locked && !game.over;
  if (game.over) { menu.classList.add('hidden'); byId('end').classList.remove('hidden'); return; }
  menu.classList.toggle('hidden', locked);
  if (!locked) view.value = settings.view;
  if (locked) {
    play.textContent = 'RESUME';
    const key = `warstrike.welcomed.${game.map}`;
    if (!sessionStorage.getItem(key)) {
      game.hud.showHint(game.welcome, 7);
      sessionStorage.setItem(key, '1');
    }
  }
});

// --- Settings panel ---
const sliders: [string, keyof typeof settings, (v: number) => string][] = [
  ['sens', 'sens', (v) => v.toFixed(2)],
  ['ads', 'adsSens', (v) => v.toFixed(2)],
  ['scope', 'scopeSens', (v) => v.toFixed(2)],
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
const view = byId<HTMLSelectElement>('s-view');
view.value = settings.view;
view.addEventListener('change', () => { settings.view = view.value as 'third' | 'first'; saveSettings(settings); });
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
