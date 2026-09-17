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
- **SETTINGS** — sound, music and their volumes, camera distance, a graphics quality
  preset (low / medium / high), an FPS readout, dynamic lighting and screen shake (all
  persisted to `localStorage`, so they survive a reload)

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

## Walls

Gold has somewhere else to go. Each arena has build spots on the ground where
a wall can be raised, and a wall is the only thing in the game that changes
where the horde walks rather than how fast it dies.

A run goes up in three tiers - palisade, stone wall, rampart - and is made of
short segments with their own health. Bodies pressed against it chew through
a segment at a time, so a wall does not flip off whole: it develops a hole,
and the hole is where the next wave funnels. Standing at the build spot with
gold patches the holes before it will pay for the next tier, so a damaged run
never has to be overbuilt to be repaired. A boss walks through and takes the
wall with him.

Nothing about the funnel is computed. Only the component of a body's movement
that crosses the line is cancelled, so the crowd slides along the wall and
pours around its end or through a gap on its own. Placing the nodes' kill
zone over that gap is the whole of the strategy.

Walls are priced against turrets on purpose. Raising one run to the top costs
about two thirds of maxing a node, and the gold only comes from kills.

## Defense nodes

Six pads ring the arena. Feeding one costs 35 / 80 / 150 / 260 / 420 gold across five
tiers. Higher tiers fire faster and harder, gain splash damage from tier 2, and fire
three barrels at tier 5. Off-screen nodes are flagged by edge chevrons — solid when you
are carrying enough gold to finish the next tier.

## Project layout

```
index.html        ready to play, no build step
assets/           Blender-rendered towers, floors, golem and character frames, plus manifests
packs/            the Craftpix model packs, as shipped - source for the towers,
                  the walls and the arena dressing
models/           golem.blend and characters.blend - the rigged, animated figures
tools/            the Blender scenes: render_assets.py, build_golem.py,
                  build_characters.py, build_pack_towers.py
css/style.css     HUD, menus, overlays
js/utils.js       math, formatting, the TILT projection constant
js/assets.js      loads the rendered art, with procedural fallbacks
js/arenas.js      stage definitions and unlock progress
js/spatial.js     uniform grid for crowd queries
js/input.js       keyboard + touch stick
js/audio.js       synthesised sound effects (no audio files)
js/music.js       reactive synthesised music loop
js/sprites.js     character frame lookup, with a procedural fallback baker
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

## The camera

It follows the player, and that is the whole requirement. The camera holds about
1100 world pixels across and 950 down at the default distance, which on a 1900x1350
arena leaves it 800 pixels of travel across and 400 up and down. The character sits
around a twelfth of the screen's height.

The requirement is easy to break by accident. If the view is ever *larger* than the
arena on both axes, the clamp that keeps the camera inside the floor pins it to the
arena's centre and it stops moving — the game silently turns into a fixed map shot
with the player lost somewhere in it. Every camera complaint this project has had
turned out to be that, not the zoom level. So the smallest stages are pulled in until
at least one axis has somewhere to travel. One pinned axis is fine and normal: the
Bridge is a strip and the Ascent a shaft, and each follows along its long side.

A phone is too narrow to hold 950 world pixels of depth at that width, so width wins
there and it follows across only.

Camera distance is a slider in Settings and a pair of buttons on the HUD, saved under
`hoard.zoom2`. The key is versioned because the distance a given number means changed
when the camera became a follow camera.

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

### The tower families

Every arena builds its own kind of tower. The Dust Bowl raises elven archer
towers, the Foundry casts iron cannon towers, the Ascent is defended with the
orc fortress it climbs through, the Bridge with high elven spires, the Pit
with fire towers, the Crossroads with bolt throwers and the Bastion with
arcane ones. The models come from four Craftpix low-poly packs, kept in
`packs/` exactly as they were downloaded.

A family is five models from a single pack, one per node level, so the tower
keeps its silhouette and its palette as it grows. The two tower packs only
ship four tiers, so the fifth is that pack's heavier weapon on the same base:
at max level the tower does not just get taller, it re-arms. Level 0, the
bare foundation, is the same in every arena and still comes from
`render_assets.py`.

`tools/build_pack_towers.py` does the conversion. It unpacks the zips on
first run, strips the rigs, and stands each model on the origin. Then the
part that matters: it scales the model so that its *projected* height - its
real height times the cosine of the camera tilt, plus its footprint times the
sine - matches the tower tier it replaces, so the new art drops into the old
footprint without re-tuning a single arena. The shadow ellipse is measured
across the bottom fifth of the model rather than its bounding box, because a
tier-5 crown's spikes reach twice as wide as the tower actually stands.

Two things about these packs had to be measured rather than assumed. Their
FBX files store V the other way up and Blender's importer does not correct
it, so left alone every tower reads its wall colour off the roof band of the
64px palette and comes out green; rendering the albedo both ways settled it.
And the palettes are mid-tone colours meant to be shown unlit, which under
the tower rig's sun render to mud, so the packs get their own key, a cool
fill from the camera side, and a little emission to keep the shadow face
readable.

A family tower carries its own modelled weapon, so the game leaves off the
procedural barrels and the lamp it draws on a plain turret, and lights the
ground only when the tower fires.

### The walls and the dressing

The same two fortress packs supply the barricades and the props that dress
the arenas - braziers, an arsenal, barracks, the gate the horde pours
through. `tools/build_pack_props.py` renders them, taking the single tileable
pieces out of each pack's parts folder rather than the assembled runs, so a
wall can be any length.

Each barricade piece is rendered twice, once running east-west and once
north-south, because in this projection a wall seen broadside and a wall
receding from the camera are not the same picture. The receding one needed
two corrections that the broadside one did not: it is thickened, because a
wall pointing away from the camera shows almost nothing but its end and
renders as a stick, and it gets its own key light, because its long faces
turn east and west where the scene's usual sun never reaches them. Even so
it reads as the plainer of the two, which is a limit of the projection rather
than of the art.

### The characters

The player, the four enemy types and the Juggernaut are built the same way in
`tools/build_characters.py` and saved to `models/characters.blend`: rounded-block
humanoids on the golem's 19-bone rig layout, each with its own proportions (the runner
is lean and hunched, the tank is a barrel, the brute is twice the height with a club),
helmet and plating, and a weapon that swings with the walk — rifle, club or the Gatling
gun. Six walk frames per character are rendered from the game camera at 3x supersample
and shipped with a manifest of ground anchors and body heights, so the game scales each
one to a fixed on-screen height and stands it on its feet. Flipped and hit-flash
variants are built at load from the base frames, one canvas per variant, so a hit costs
a blit and not a filter. If any frame of a character fails to load, that character
falls back to the old procedural baker and the rest stay rendered.

To re-render after changing the models or shaders:

```
pip install bpy          # Blender as a Python module, no GUI needed
python3 tools/render_assets.py           # everything
python3 tools/render_assets.py towers    # or just the towers / ground
python3 tools/build_golem.py             # rebuild, re-rig and re-render the golem
python3 tools/build_characters.py        # rebuild, re-rig and re-render the characters
python3 tools/build_pack_towers.py       # every tower family
python3 tools/build_pack_towers.py orc   # or just these
python3 tools/build_pack_props.py        # walls and camp dressing
python3 tools/build_pack_props.py walls  # or just the barricades
```

Each tower takes about a second on CPU; the floor tiles are 512px and take a minute
each; the characters take a few minutes for all six. The manifest is written as JavaScript rather
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
rendering — and rendering is where a real GPU can still be brought to its knees by a
2D canvas, so the renderer avoids the things that do that:

- **No `ctx.filter` blur.** Canvas blur is a CPU readback on most browsers and cost more
  than the whole rest of the frame. Bloom and the light layer are additive blits of a
  few cached radial sprites onto a quarter-resolution canvas instead.
- **No per-frame gradients.** Every glow, torch and light is a sprite baked once per
  colour; the frame only ever calls `drawImage`.
- **Only the visible floor is filled.** The pattern fill covers the camera slice, not
  the whole arena.
- **The backing store is capped.** A 4K monitor at device pixel ratio 2 would otherwise
  ask the canvas for a 7680-pixel-wide frame. The quality preset caps the backing width
  (1280 / 1920 / 2560 for low / medium / high); high also enables the light layer and
  more ambient particles, low drops them.
- **Catch-up is bounded.** After a stall the fixed-step loop runs at most three steps
  per frame rather than spiralling.

The FPS readout in Settings shows the real number on your hardware; if it sits below
the display's refresh rate at *medium*, drop to *low*, and if it is pinned there, *high*
is free.

## Tuning

Most of the feel lives in a few constants:

- `js/game.js` — `WORLD_W/H`, `MAX_ENEMIES`, `DEPOSIT_RATE`, `NEIGHBOUR_VISITS`
- `js/waves.js` — `STAGE_DURATION`, `rate()`, `rollType()`, surge sizing
- `js/entities.js` — `ENEMY_TYPES`, `DefenseNode.COSTS`, node `stats`
- `js/utils.js` — `TILT`, the ground-plane foreshortening for the whole 2.5D look
- `js/sprites.js` — the `looks` table: size, colour and pose per character
- `js/arenas.js` — stage definitions; add an entry to add a stage. `towers`
  picks the turret family, `walls` the fortress the barricades come from, and
  `barricades` and `props` place the wall runs and the dressing
- `js/entities.js` — `Barricade.COSTS` and `Barricade.SEG_HP`, what a wall
  costs and how long it stands
- `js/perks.js` — the perk table and `xpForLevel()`
- `js/entities.js` — `BOSS_TYPES` for boss stats and attack pattern; the `Ally` class
- `js/game.js` — `LOCK_COST`, what the Juggernaut's cage takes to open
- `js/camp.js` — `CAMP_UPGRADES` and `BANK_SHARE`, the cut of each run that comes home
- `js/music.js` — `MUSIC_ROOTS` and `MUSIC_LADDER` for the progression and arpeggio

The character art is the Blender render; `CHAR_HEIGHT_PX` in `js/sprites.js` sets how
tall each figure stands on screen. `bakeBiped()` is only the fallback, so swapping in
different sprite sheets means writing a manifest in the shape of
`assets/char_manifest.js` — the renderer just asks `characterFrame()` for a frame and
blits it.

`window.__game` is exposed in the console for poking at a live run.
