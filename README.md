# Hoard Defense

Two five-minute survival stages rendered in 2.5D: one controllable soldier, thousands of
weak enemies, and a ring of gold-hungry defense nodes. Enemies die in a hit or two, but
they never stop coming — the only way to keep up is to hoover up the gold they drop and
pour it into the nodes. Survive to the end of the clock and the stage boss walks in.

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
| Pause | `P` / `Esc` or the II button | the II button |
| Pick a perk | click / tap a card | click / tap a card |
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
assets/           Blender-rendered towers, floor tiles and golem frames, plus manifests
models/           golem.blend - the rigged, animated boss
tools/            render_assets.py and build_golem.py - the Blender scenes
css/style.css     HUD, menus, overlays
js/utils.js       math, formatting, the TILT projection constant
js/assets.js      loads the rendered art, with procedural fallbacks
js/arenas.js      stage definitions and unlock progress
js/spatial.js     uniform grid for crowd queries
js/input.js       keyboard + touch stick
js/audio.js       synthesised sound effects (no audio files)
js/music.js       reactive synthesised music loop
js/sprites.js     procedural character sprite baking
js/entities.js    player, enemies, bosses, bullets, coins, nodes
js/perks.js       level-up perk draft
js/camp.js        persistent bank, permanent upgrades, best-run records
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

## Lighting

The arena is torchlit. Flame poles stand around every arena's edge and beside every node
— along the corridor walls between the stairs on The Ascent — each with a flickering
three-tongue flame, a trail of embers and a warm light. A shallow darkness layer at
quarter resolution has that light cut out of it, along with the player's lamp, each
turret as it fires, muzzle flashes, the boss's eyes, the pulse charge and the ground
rings, and is composited over the world. It is shallow on purpose: the arena is readable
everywhere, and the light adds warmth and pools of brightness rather than being the only
way to see. A bloom
pass draws the emissive things small, blurs them and adds them back: bullets, turret
heads, the boss's eyes, embers. Each arena carries a colour grade and an ambience — dust
drifting across the Dust Bowl, embers rising in the Foundry and the Pit, mist along the
Bridge and the Ascent. All of it sits behind a Lighting toggle in settings for weak
devices; the game is fully playable with it off.

## Feel

Small things that make a hit land: dash afterimages, turret recoil with a muzzle flash,
hit sparks where rounds land, body-coloured gibs on a kill, ground shockwave rings on a
slam and a node upgrade, and a screen flash when a slam lands or a boss dies. And the
older set: hit stop freezes the simulation for a few frames on a
brute or boss kill, bullets shove bodies backwards, damage numbers float off the big
targets only (doing it for every grunt would be noise and needless cost), muzzle flashes,
and corpse decals that accumulate where the fighting actually is — a battlefield that
visibly wears down sells the scale of the hoard better than anything else on screen.

## Music

Synthesised too, and it reacts. A lookahead scheduler walks a 16-step bar and lays
notes onto the audio clock a fraction ahead of time, which is what keeps the beat steady
when a heavy frame lands. The simulation feeds it an intensity each frame: tempo climbs
from 112 to 158 bpm across the stage, hats come in once the crowd is real, the arpeggio
once it's dense, and a second octave stacks on when the boss is out. The title screen
gets a slow drone instead. Music ducks during pause and the perk draft, and has its own
volume, separate from effects.

## Rendered art

The towers and floors are rendered in Blender and shipped as PNGs in `assets/`. The
towers are round, crenellated sandstone drums in the Warwick Castle mould — arrow slits
from tier 2, machicolated corbels from tier 3, a turret cap from tier 4 — and the stone
is a procedural shader: a brick texture wrapped cylindrically for the coursing, noise for
per-block weathering, both feeding a bump so the relief reads at sprite size.

The camera is the important part. It is orthographic at the elevation whose sine is the
game's `TILT` (0.58), which is exactly the angle at which a circle on the ground renders
as the 0.58 ellipse the node pads already use — so a tower's round top sits flush on its
pad with no fudging in the renderer. Each sprite carries its ground origin and walkway
deck in `assets/manifest.js`, and the game mounts the gun on the deck from that.

### The golem

Every boss is the stone golem: a segmented creature of loose rock blocks with moss on
the upward faces and lit eyes, modelled, rigged and animated in `tools/build_golem.py`
and saved to `models/golem.blend` — open it in Blender and the skeleton, the walk cycle
and the slam are all there in Pose Mode.

The rig is honest about what a golem is. Each of the 26 blocks is bound rigidly to one
of 19 bones (every vertex weighted 1.0 to that bone), so the pieces move with the
skeleton but never stretch — which is how the references look. The walk cycle is 24
frames with legs and arms in counter-swing, a bob on each footfall and a twist against
the stride; the slam is a wind-up with both fists overhead and the torso back, then the
strike driven down in front. Eight walk frames and four slam frames are rendered from
the game camera, and the three bosses are colourways of the one render — a light hue
wash that keeps the grey and the moss and just leans them.

The camera frame is fitted to the evaluated geometry across every rendered pose rather
than guessed, because guessing clipped the raised fists straight off the wind-up. The
bone rotation convention was measured with diagnostic renders, not assumed.

To re-render after changing the models or shaders:

```
pip install bpy          # Blender as a Python module, no GUI needed
python3 tools/render_assets.py           # everything
python3 tools/render_assets.py towers    # or just the towers / ground
python3 tools/build_golem.py             # rebuild, re-rig and re-render the golem
```

Each tower takes about a second on CPU. The manifest is written as JavaScript rather
than JSON because `fetch()` of a local file is blocked over `file://`, and the game has
to keep opening straight from `index.html`. If an image fails to load, the renderer
falls back to the procedural pedestal it drew before the art existed.

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
- `js/arenas.js` — stage definitions; add an entry to add a stage
- `js/perks.js` — the perk table and `xpForLevel()`
- `js/entities.js` — `BOSS_TYPES` for boss stats and attack pattern; the `Ally` class
- `js/game.js` — `LOCK_COST`, what the Juggernaut's cage takes to open
- `js/camp.js` — `CAMP_UPGRADES` and `BANK_SHARE`, the cut of each run that comes home
- `js/music.js` — `MUSIC_ROOTS` and `MUSIC_LADDER` for the progression and arpeggio

The character art is deliberately placeholder. `bakeBiped()` is the only thing that
draws a figure, so swapping in real sprite sheets means replacing that one function —
the renderer just asks for a frame and blits it.

`window.__game` is exposed in the console for poking at a live run.
