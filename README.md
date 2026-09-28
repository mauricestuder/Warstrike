# WARSTRIKE

A browser FPS built from scratch with **Three.js + TypeScript**, taking inspiration from Warzone's gunplay and Blood Strike's pace.
The long-term goal is a battle royale; this first build is a **gun range** for getting movement and gunplay feeling right before anything else.

## Play

```bash
npm install
npm run dev        # http://localhost:5180
```

Or build a single self-contained file you can double-click or send to a friend:

```bash
npm run share      # → Warstrike.html (no server needed)
```

## What's in build 0.1

**Movement**
- Walk, sprint, and tactical sprint (double-tap Shift, with a stamina bar).
- Crouch (C toggles, Ctrl holds), slide from a sprint, and slide-jump that keeps your momentum.
- Mantle anything up to about 2 m: jump into a ledge.
- Step-up on stairs and small ledges; landing dip, head bob and slide roll on the camera.

**Gunplay**
- Three guns: **M7 Vanguard** (AR), **Viper-9** (SMG) and **Longbow .338** (sniper). Each has its own damage, falloff, RPM, ADS time, sprint-to-fire time and move speed.
- Travelling bullets with real drop (9.81 m/s²). The SMG is hitscan.
- Wall penetration by material: wood and thin concrete let rounds through at reduced damage; thick concrete, dirt and steel stop them.
- Recoil patterns that move your real aim and recover only the part you didn't pull down yourself.
- The crosshair shows your actual spread.
- Sniper scope with breath sway: hold Shift to steady it for 4 s.

**Range**
- Steel plates at 10 / 25 / 50 / 100 / 200 / 300 m. The ding arrives with the speed of sound.
- Strafing bots with 100 HP + 50 armour, and head / body / limb hitboxes.
- A wallbang lane with wood, 30 cm concrete and 1 m concrete walls.
- A movement course: mantle crates at 0.5–2 m, a tower with stairs, containers and a measured slide strip.

**Look and feel**
- Physical sky with image-based lighting, cascaded shadow maps, procedural PBR textures, haze, bloom and ACES tone mapping.
- Synthesized sound (no audio files): gunshots with echo, footsteps, hit and kill confirms.
- Settings for sensitivity, ADS sensitivity, FOV, volume and graphics quality.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint · double-tap: tactical sprint · scoped: hold breath |
| Space | Jump / mantle |
| C / Ctrl | Crouch (toggle / hold) · while sprinting: slide |
| Left / right mouse | Fire / aim |
| R | Reload |
| 1 2 3 / wheel | Switch weapon |
| Y | Inspect |
| T | Refill ammo |
| H | Show controls |
| Esc | Pause / settings |

## Project layout

```
src/
  Game.ts            frame loop, camera feel, damage and feedback
  core/              input (pointer lock), settings, math
  render/            renderer + post, procedural textures, materials, effects (decals, tracers, particles)
  world/             box colliders and the range map
  player/            movement: sprint, crouch, slide, mantle
  weapons/           gun stats, firing, recoil, ballistics, first-person view models
  targets/           steel plates and bots
  audio/             WebAudio sound synthesis
  ui/                HUD
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.
