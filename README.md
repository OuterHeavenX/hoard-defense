# Hoard Defense

A five-minute survival stage: one controllable soldier, thousands of weak enemies,
and six gold-hungry defense nodes. Enemies die in a hit or two, but they never stop
coming — the only way to keep up is to hoover up the gold they drop and pour it into
the nodes ringing the arena.

**[Play it here](https://outerheavenx.github.io/hoard-defense/)** — or clone the repo
and open `index.html`. No build step, no server, no dependencies.

## The loop

1. **Shoot** — automatic, always locked on the nearest target. You never aim.
2. **Collect** — every kill drops gold, and gold near you gets magneted in.
3. **Deposit** — stand on a defense node's pad and your carried gold pours in.
   Each filled tier upgrades that node's turret.
4. **Survive** — hold out for the full 5:00. The hordes get bigger the whole way.

The tension is in step 3: depositing means standing still while a horde closes on you.
Hoard your gold too long and the turrets never come online; linger on a pad too long
and you get swarmed.

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
js/utils.js       math and formatting helpers
js/spatial.js     uniform grid for crowd queries
js/input.js       keyboard + touch stick
js/entities.js    player, enemies, bullets, coins, nodes
js/waves.js       the 5 minute wave director
js/game.js        simulation
js/render.js      renderer
js/main.js        canvas sizing, fixed-step loop, UI wiring
```

Plain scripts, no modules, so `file://` works — double-clicking `index.html` is enough.

## Performance notes

The stage is built to put ~1000+ bodies on screen at once, which shaped two decisions:

- **The crowd is drawn as sprite blits**, not as batched paths. Each enemy type is baked
  once into a small offscreen canvas. Drawing hundreds of bodies as one giant path makes
  a rasterizer scan-convert a screen-sized bounding box per pass.
- **Separation is visit-capped.** Each body examines at most 20 neighbours from the
  spatial grid per frame. Without the cap, a dense pile-up degrades toward quadratic;
  with it, the cost per body is fixed and the crowd looks identical.

The simulation measures ~0.3ms/frame at 600 enemies, leaving the frame budget to rendering.

## Tuning

Most of the feel lives in a few constants:

- `js/game.js` — `WORLD_W/H`, `MAX_ENEMIES`, `DEPOSIT_RATE`, `NEIGHBOUR_VISITS`
- `js/waves.js` — `STAGE_DURATION`, `rate()`, `rollType()`, surge sizing
- `js/entities.js` — `ENEMY_TYPES`, `DefenseNode.COSTS`, node `stats`

`window.__game` is exposed in the console for poking at a live run.
