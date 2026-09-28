# WARSTRIKE

A browser FPS built from scratch with **Three.js + TypeScript**, taking inspiration from Warzone's gunplay and Blood Strike's pace.
The long-term goal is a battle royale. Build 0.2 has two maps: a **gun range** for dialling in movement and gunplay, and **Harbor Outskirts**, the first piece of the big map.

## Play

```bash
npm install
npm run dev        # http://localhost:5180
```

Or build a single self-contained file you can double-click or send to a friend:

```bash
npm run share      # → Warstrike.html (no server needed)
```

## What's new in build 0.2

**Harbor Outskirts**, the first chunk of the battle royale map (about 240 × 240 m), abandoned and overgrown:
- **Maple Street:** five enterable houses (two with an upstairs), furnished rooms, porches you can climb onto, a burnt-out ruin, fences, yards, a snapped power pole across the road.
- **Harbor Fuel gas station:** canopy and pumps, and an enterable **Harbor Mart**. A car has gone through the front window, and crates behind it lead up onto the roof.
- **East side:** Dale's Auto Repair, a trailer home, a billboard and wild fields.
- **Port of Calvert** past the chain-link fence:
  - a warehouse with a mezzanine and climbable pallet racks;
  - a container yard with open containers;
  - a 50 m gantry crane;
  - fuel tanks and the quay, with a container ship offshore.
- Wind-blown instanced grass, leaf-card trees, bushes and ivy. Hills and woods hide the map edge.
- 12 bots placed around the map: in buildings, on roofs, and strafing in the container aisles and on Maple Street.
- Walls are penetrable according to their material: siding and drywall let rounds through, brick and containers stop them.

**Range:** infinite reserve ammo.

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
- Infinite reserve ammo (build 0.2).
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
  world/             box colliders, the World interface, the geometry Builder (merges static meshes), the range
  world/town/        Harbor Outskirts: materials, props, buildings, port, vegetation, layout
  player/            movement: sprint, crouch, slide, mantle
  weapons/           gun stats, firing, recoil, ballistics, first-person view models
  targets/           steel plates and bots
  audio/             WebAudio sound synthesis
  ui/                HUD
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.
