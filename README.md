# WARSTRIKE

A browser FPS built from scratch with **Three.js + TypeScript**, taking inspiration from Warzone's gunplay and Blood Strike's pace.
The long-term goal is a big battle royale. Build 0.7 has a **battle royale mode** on **Calvert**, a half-kilometre town, with 37 bots that fight back. There's also a **gun range** for dialling in movement and gunplay, and **free roam** on Calvert.

## Play

```bash
npm install
npm run dev        # http://localhost:5180
```

Or build a single self-contained file you can double-click or send to a friend:

```bash
npm run share      # → Warstrike.html (no server needed)
```

## What's new in build 0.7

**A new, much bigger map: Calvert.** It's about 480 × 480 m, over four times the old map. Harbor Outskirts is now its northern middle.

**Downtown** (south):
- **The street grid:** Harbor Road and Main Street, Elm and Oak Street, and 1st and 3rd Avenue, with sidewalks, crosswalks, traffic lights, street signs, a broken-down bus, a police roadblock and rain puddles that reflect the sky.
- **Buildings:** more than 30 three- to six-storey buildings: shops with signs and awnings, offices, flats, a bank, a pawn shop, a diner and a hotel.
  - **Every floor can be walked:** each building has a real staircase inside, and many go on up to a stair hut on the roof. The Grand Harbor Hotel roof is the highest point downtown.
- **The parking garage:** four open levels joined by ramps, with low walls to shoot over.
- **The town square:** a fountain with a statue, benches, lamps and trees, and City Hall with columns and a clock tower.
- **St. Mary's church:** a five-storey bell tower you can climb, and a graveyard.
- **Around the edges:** Calvert Park with a gazebo, a lumber yard, a cannery warehouse and a fire station.

**West side:**
- **The fish docks:** boat sheds, fishing boats on cradles, and the fish market with roof access.
- **Miller Farm:**
  - a red barn with a hayloft you can climb;
  - silos, grain bins, a farmhouse, a tractor, hay bales and fences;
  - a big cornfield. The corn is taller than you, so bots can't see you in it.
- **The woods:** cabins, a pond with reeds and a dock, a campground, and a fire lookout tower with a view over the whole west side.

**East side:**
- **The railway:** two tracks run the length of the map.
  - A freight train you can climb into (open boxcars, tank cars, flatcars carrying containers), plus a derailed boxcar.
  - A station with a platform and departure board, and a level crossing on Main Street.
- **Industry:**
  - **The grain terminal:** six concrete silos and a seven-storey head house you can climb.
  - **Calvert Steel Works:** a furnace hall with a mezzanine and a 48 m smokestack.
  - **A truck depot** under the water tower.
- **Calvert High:** a school with classrooms on two floors, a gym, and school buses.
  - **The stadium:** a football field, a grandstand with a press box, and floodlights.

**Graphics:**
- **Anti-tiling:** ground, roads, walls and plazas no longer show a repeating pattern.
- **New textures:**
  - stucco facades;
  - brick pavers;
  - gravel roofs;
  - board-and-batten barn wood;
  - dirt tracks with tyre ruts;
  - clay roof tiles;
  - corn.
- **A new Ultra setting:** ambient occlusion (soft contact shadows in corners and under things), 1024 px textures, and shadows drawn further out.
- **Lighting:** a clearer sky, a higher sun and softer bloom, so looking toward the sun no longer washes the picture out.

**Battle royale on the bigger map:**
- 37 bots instead of 12.
- More loot to match: about 80 supply boxes and around 1,000 items on the floor.
- 18 buy stations, at least one in every district.
- The gas circle starts big enough to cover the town and takes a bit longer to close.
- The map screen shows the whole town.
- Bots climb all the new stairs. A bot that lands on a roof with no way down gets back onto the ground after a few seconds instead of standing there.

**Faster under the hood:**
- Bullets and bot sight only test the walls along their path, not every wall on the map.
- The town is merged into bigger chunks, so fewer draw calls.
- Bots far away from you don't cast shadows.

## What came in build 0.6

**A fourth gun: the BRUISER 12 pump shotgun.**
- Each shell fires 8 pellets in a cone. Up close that's about 150 damage, enough to drop an unarmoured enemy in one shot. It falls off fast: about 65 at 10 m and almost nothing past 20 m.
- Aiming tightens the pellet cone by a quarter, and the crosshair opens to show the cone.
- Pump action: it racks after every shot, with the left hand riding the pump, and you hear the pump.
- It's slow to fire (about 72 shots a minute) and holds 6 shells. It has its own ammo, 12-gauge shells (orange boxes).
- Each shell counts as one hit for feedback: one hit marker, one sound and one damage number with the total.
- You find it in the loot and in supply boxes, and bots use it too (they close in to about 6 m).
- On the gun range it's slot 4.

## What came in build 0.5.1

**More loot:**
- 22 supply boxes around the map instead of 9.
- About three times as many guns lying on the floor (around 110 per match). Half of them have a box of matching ammo next to them.
- More floor loot overall (about 230 spots).

## What came in build 0.5

**Hide from the bots, and watch them climb:**
- **Bushes and trees block their sight.** Bullets still go through leaves, but bots can't see you through a bush or a tree crown.
  - Crouch behind a bush and you're hidden. Standing, your head shows over most of them.
  - Thin leaves only hide you at range.
  - Crouching in tall weeds hides you from anyone more than a few metres away.
  - When you shoot, your muzzle flash gives you away for a moment.
  - Bots also count bushes as cover when they look for a place to heal.
- **Bots use upper floors.** Their navigation grid now has several levels, so they climb the stairs in the two-storey houses and onto the warehouse deck.
  - They loot guns upstairs.
  - They chase you up the stairs.
  - Snipers like to take a high spot and hold it for a while.

## What came in build 0.4

**The bots fight back** (battle royale):
- **They drop in with you.** Every bot jumps from the plane at its own moment, skydives and parachutes toward a loot-rich spot, spread out from the others.
- **They loot.** A fresh bot runs to the nearest gun and picks it up (it's gone for you), and later swaps for better rarities. You can see the gun in its hands.
- **They move like you.** Bots use your own movement code (they step up stairs, jump and mantle), with a navigation grid and path finding to get around the town.
- **They see and hear.** Bots have a field of view and a sight range and need a clear line of sight. Crouching makes you harder to spot. Gunfire draws nearby bots to come and look.
- **They fight.** Bots react after a short delay and strafe while shooting. They keep the range their gun likes and fire in bursts.
  - Their aim starts loose and tightens as they track you. It gets worse when you move fast.
  - Snipers plant their feet to take the shot.
  - Bots reload, back off to cover to heal when they're hurt, and hunt you where they last saw you.
  - Without a gun they rush in and punch.
- **Fairness:**
  - Every bot has its own skill level.
  - Only two bots fight you at a time, unless you shoot the others.
  - Bots ignore each other while they loot after landing.
- **They fight each other**, so the kill feed fills with "Ghost_77 eliminated Reyes". They also move into the circle and die in the gas.
- When a bot dies, it drops the gun it was carrying.
- **Feedback when you're shot at:**
  - Each bot shot leaves a tracer, and their shots sound from where they are (panned, muffled and delayed with distance).
  - Bullets crack past your head when they miss.
  - A red arc points at whoever hit you, and footsteps sound nearby.
  - Gunfire near you shows as red dots on the minimap.
- Losing by a bot shows "ELIMINATED BY <name>" on the end screen.

## What came in build 0.3

**Battle royale** (menu → BATTLE ROYALE):
- **Plane drop:** a transport plane crosses the map on a random line. Jump from the rear ramp with Space, or get thrown out at the far edge.
  - **Freefall:** look down to dive faster; WASD steers.
  - **Parachute:** opens by itself at 55 m, or press Space earlier.
- **The gas:** five phases of closing circles (about 5½ minutes).
  - The next circle shows on the minimap (dashed) and on the full map (**M**).
  - Outside the circle you take damage that ignores armour, and it hurts more every phase.
  - You see a churning yellow wall, yellow fog and a warning, and you cough.
- **Health and armour:** 100 health that regenerates after 5 s without damage, plus three armour plates of 50 each.
  - Carry up to 5 plates and press **4** to plate up; hold it to insert several.
- **Loot:** about 120 items and 9 supply boxes, placed automatically on floors all over the map, mostly indoors.
  - **Guns** float above the ground with a glow in their rarity colour: Common (grey), Uncommon (green), Rare (blue), Epic (purple) or Legendary (gold).
    - Better rarity means more damage (up to +20%) and less recoil (down to −22%), and the gun's furniture takes the rarity colour.
    - Legendary guns are gold.
  - **Ammo boxes** for rifle, SMG and sniper rounds and shotgun shells, **armour plates** and **cash** are picked up just by walking over them.
  - **Supply boxes** (the gold beams) spill an Epic or Legendary gun, ammo, plates and cash.
  - You carry two guns plus your fists. **F** picks up a gun, or swaps it for the one in your hand.
- **Buy stations** (green $ on the map), where you spend the cash you collected:

  | Item | Price |
  | --- | --- |
  | 3 plates | $800 |
  | Full ammo | $600 |
  | Random Epic gun | $2,500 |
  | Random Legendary gun | $4,500 |

- **12 bots** (see builds 0.4 and 0.5 above for how they play). They stay down when killed and drop cash, ammo, sometimes a plate, and their gun.
- **Last one standing wins.** The Victory or Eliminated screen shows your placement, kills, damage, time survived, cash, items looted and longest kill.
- **HUD:**
  - armour, health, plates and cash;
  - players alive and kills;
  - gas timer;
  - kill feed;
  - minimap (a real top-down render of the map) and the full map on **M**;
  - pickup prompts.

**Fists:** press **X** to put your gun away. You walk about 10% faster and sprint about 10% faster than with a rifle. Left click punches (34 damage, more to the head).

**Movement:** about 10% faster overall. Walk 5.3, sprint 7.6, tactical sprint 9.3 m/s.

**Sound:** the deep echo after each shot is much shorter.

## What came in build 0.2

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

**Sound (0.2.1):** deeper, more realistic gunshots.
- Every shot has four layers: a supersonic crack, the muzzle blast, a low boom and a chest-thump below it. Like a real recording, it's slightly clipped.
- Each gun has four variants, so no two shots sound the same.
- Shots echo through convolution reverb shaped by the map: rolling echoes off the berms on the range, and fast slap-back off the houses and containers in town.

## What's in build 0.1

**Movement**
- Walk, sprint, and tactical sprint (double-tap Shift, with a stamina bar).
- Crouch (C toggles, Ctrl holds), slide from a sprint, and slide-jump that keeps your momentum.
- Mantle anything up to about 2 m: jump into a ledge.
- Step-up on stairs and small ledges; landing dip, head bob and slide roll on the camera.

**Gunplay**
- Three guns: **M7 Vanguard** (AR), **Viper-9** (SMG) and **Longbow .338** (sniper); build 0.6 added the **Bruiser 12** shotgun. Each has its own damage, falloff, RPM, ADS time, sprint-to-fire time and move speed.
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
- Synthesized sound (no audio files): gunshots with echo, footsteps, hit and kill confirms. (Gunshots reworked in 0.2.1.)
- Settings for sensitivity, ADS sensitivity, FOV, volume and graphics quality.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move |
| Shift | Sprint · double-tap: tactical sprint · scoped: hold breath |
| Space | Jump / mantle · in the plane: jump · falling: open parachute |
| C / Ctrl | Crouch (toggle / hold) · while sprinting: slide |
| Left / right mouse | Fire / aim |
| R | Reload |
| 1 2 3 4 / wheel | Switch weapon (range: 4 is the shotgun; battle royale: 4 is plate up) |
| X | Fists (run faster) · again: back to your gun |
| F | Pick up · open supply box · buy station |
| 4 | Plate up (hold for several) |
| M | Full map |
| Y | Inspect |
| T | Refill ammo (range and free roam) |
| H | Show controls |
| Esc | Pause / settings |

## Project layout

```
src/
  Game.ts            frame loop, camera feel, damage and feedback
  core/              input (pointer lock), settings, math
  render/            renderer + post, procedural textures, materials, effects (decals, tracers, particles)
  world/             box colliders, foliage (sight blockers), the World interface, the geometry Builder (merges static meshes), the range
  world/town/        Calvert: materials, props, buildings, multi-storey blocks, port, downtown, west (farm, woods), east (rail, industry, school), vegetation, layout
  br/                battle royale: match flow, loot and buy stations, gas zone, drop plane, minimap
  ai/                bot navigation grid (all floors) + A* path finding, and the bot brains (drop, loot, roam, fight)
  player/            movement: sprint, crouch, slide, mantle
  weapons/           gun stats, firing, recoil, ballistics, first-person view models
  targets/           steel plates and bots
  audio/             WebAudio sound synthesis
  ui/                HUD
```

See [docs/ROADMAP.md](docs/ROADMAP.md) for what's next.
