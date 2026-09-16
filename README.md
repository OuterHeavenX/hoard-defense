# Hoard Defense

A five-minute survival stage rendered in 2.5D: one controllable soldier, thousands of
weak enemies, and six gold-hungry defense nodes. Enemies die in a hit or two, but they
never stop coming — the only way to keep up is to hoover up the gold they drop and pour
it into the nodes ringing the arena.

**To play:** clone the repo and open `index.html` — no build step, no server, no
dependencies.

To put it online, enable GitHub Pages under *Settings → Pages* with the source set to
this branch and the `/ (root)` folder; it will then be served at
`https://outerheavenx.github.io/hoard-defense/`. A `.nojekyll` file is already included
so Pages serves the `js/` and `css/` folders untouched.

## The loop

1. **Shoot** — automatic, always locked on the nearest target. You never aim.
2. **Collect** — every kill drops gold, and gold near you gets magneted in.
3. **Deposit** — stand on a defense node's pad and your carried gold pours in.
   Each filled tier upgrades that node's turret.
4. **Survive** — hold out for the full 5:00. The hordes get bigger the whole way.

The tension is in step 3: depositing means standing still while a horde closes on you.
Hoard your gold too long and the turrets never come online; linger on a pad too long
and you get swarmed.

## Menus

The title screen runs a live attract battle behind it — a real simulation with the
crowd, turrets and brutes, not a backdrop image. From there:

- **PLAY** — start the stage
- **HOW TO PLAY** — controls and a short bestiary
- **SETTINGS** — sound on/off, volume, screen shake on/off (all persisted to
  `localStorage`, so they survive a reload)

Pausing offers resume, restart and quit to title.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | `WASD` / arrow keys | drag anywhere (virtual stick) |
| Dash | `Space` / `Shift` | — |
| Pause | `P` / `Esc` | — |
| Fire | automatic | automatic |

Dash gives a short burst of speed plus brief invulnerability on a 2.4s cooldown. It is
the main way out of a closing pocket.

## Enemies

| | Behaviour |
| --- | --- |
| **Grunt** (green) | The bulk of every horde. Slow, dies instantly. |
| **Runner** (orange) | Fast and fragile — these are what actually reach you. |
| **Tank** (blue) | Slower, takes a few hits, drops more gold. |
| **Brute** (pink) | Rare, huge health pool, hits hard, drops a pile of gold and a medkit. |

## Defense nodes

Six pads ring the arena. Feeding one costs 35 / 80 / 150 / 260 / 420 gold across five
tiers. Higher tiers fire faster and harder, gain splash damage from tier 2, and fire
three barrels at tier 5. Off-screen nodes are flagged by edge chevrons — solid when you
are carrying enough gold to finish the next tier.

## Project layout

```
index.html        ready to play, no build step
css/style.css     HUD, menus, overlays
js/utils.js       math, formatting, the TILT projection constant
js/spatial.js     uniform grid for crowd queries
js/input.js       keyboard + touch stick
js/audio.js       synthesised sound effects (no audio files)
js/sprites.js     procedural character sprite baking
js/entities.js    player, enemies, bullets, coins, nodes
js/waves.js       the 5 minute wave director
js/game.js        simulation
js/render.js      2.5D renderer
js/main.js        canvas sizing, fixed-step loop, menus, settings
```

Plain scripts, no modules, so `file://` works — double-clicking `index.html` is enough.

## How the 2.5D works

The simulation is unchanged and still runs on a flat top-down plane — only drawing is
projected. Screen Y is `worldY * TILT` minus the body's height, which tilts the ground
away from the camera and stands characters upright on it. Everything touching the floor
is then drawn back-to-front so near bodies overlap far ones; with a thousand of them,
that ordering is what sells the depth.

- **Depth sorting is a bucket sort** by world Y, not a comparison sort, so it stays
  linear as the crowd grows.
- **Shadows are one flat pass** before any body is drawn, so a shadow can never land on
  top of the figure standing in front of it.
- **The floor is the only thing drawn in squashed space**, so its texture foreshortens
  with the plane instead of sliding across it.

## Sound

Every cue is synthesised at runtime from oscillators and a shared noise buffer, so the
repo carries no audio files and nothing has to load. The throttling matters as much as
the synthesis: a five minute run kills upwards of 14,000 enemies, and one voice per kill
would both clip the output and tank the frame. Each cue has a minimum interval and a
global 18-voice cap. Measured under a 6,110-kill storm, voices peak at exactly the cap
and never exceed it.

Audio only starts after a click, per browser autoplay rules, and battle cues stay muted
while the title screen's attract loop plays.

## Performance notes

The stage is built to put ~1000+ bodies on screen at once, which shaped two decisions:

- **The crowd is drawn as sprite blits**, not as batched paths. Each character is baked
  once into a small offscreen canvas at load. Drawing hundreds of bodies as one giant
  path makes a rasterizer scan-convert a screen-sized bounding box per pass.
- **Separation is visit-capped.** Each body examines at most 20 neighbours from the
  spatial grid per frame. Without the cap, a dense pile-up degrades toward quadratic;
  with it, the cost per body is fixed and the crowd looks identical.

The simulation measures ~0.2ms per step at 400+ enemies, leaving the frame budget to
rendering.

## Tuning

Most of the feel lives in a few constants:

- `js/game.js` — `WORLD_W/H`, `MAX_ENEMIES`, `DEPOSIT_RATE`, `NEIGHBOUR_VISITS`
- `js/waves.js` — `STAGE_DURATION`, `rate()`, `rollType()`, surge sizing
- `js/entities.js` — `ENEMY_TYPES`, `DefenseNode.COSTS`, node `stats`
- `js/utils.js` — `TILT`, the ground-plane foreshortening for the whole 2.5D look
- `js/sprites.js` — the `looks` table: size, colour and pose per character

The character art is deliberately placeholder. `bakeBiped()` is the only thing that
draws a figure, so swapping in real sprite sheets means replacing that one function —
the renderer just asks for a frame and blits it.

`window.__game` is exposed in the console for poking at a live run.
