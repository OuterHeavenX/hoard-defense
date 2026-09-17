/* Things to do in the arena other than hold still.

   A stage used to be one long defence with a clock on it. Now that a stage is
   much bigger than the screen, there is room for it to ask you to go
   somewhere, and going somewhere means leaving the turrets you just paid for.
   That trade is the whole point of an objective here: every one of them is a
   reason to be in the wrong place. */
'use strict';

const OBJECTIVE_TYPES = {
  /* A crate comes down somewhere out in the dark. Reach it before it is lost
     and it pays for a node. The horde is not interested in it; the risk is
     the walk. */
  drop: {
    label: 'SUPPLY DROP',
    call: 'REACH THE DROP',
    window: 40,
    colour: '#ffd34d',
    pulls: false,
    reward: 'a gold cache'
  },
  /* Ground that has to be stood on. It does not pull the crowd, because the
     crowd is already coming for whoever is standing there - pulling as well
     meant the player had to hold a spot with most of the horde converging on
     it, and fifteen seconds of that is not a fight, it is a countdown. What
     makes it hard is that standing still is the one thing this game never
     otherwise lets you do. */
  hold: {
    label: 'HOLD THE GROUND',
    call: 'HOLD THE MARKED GROUND',
    window: 52,
    need: 12,
    radius: 132,
    colour: '#8fe8c0',
    pulls: false,
    reward: 'a level'
  },
  /* A signal fire the horde wants out. It cannot move and it cannot fight, so
     keeping it alight means standing between it and everything. */
  beacon: {
    label: 'DEFEND THE BEACON',
    call: 'KEEP THE BEACON ALIGHT',
    window: 38,
    hp: 900,
    radius: 46,
    colour: '#ffa martian',
    pulls: true,
    reward: 'every turret a tier'
  }
};
OBJECTIVE_TYPES.beacon.colour = '#ff9d5c';

class Objective {
  constructor(kind, x, y) {
    this.kind = kind;
    this.spec = OBJECTIVE_TYPES[kind];
    this.x = x;
    this.y = y;
    this.left = this.spec.window;
    this.held = 0;
    this.hp = this.spec.hp || 0;
    this.maxHp = this.spec.hp || 0;
    this.state = 'active';     // active | won | lost
    this.flash = 0;
    this.bob = 0;
  }

  get radius() { return this.spec.radius || 70; }
  /* How far along it is, for the bar under the call-out. */
  get fill() {
    if (this.kind === 'hold') return clamp(this.held / this.spec.need, 0, 1);
    if (this.kind === 'beacon') return clamp(this.hp / this.maxHp, 0, 1);
    return clamp(1 - this.left / this.spec.window, 0, 1);
  }
}

/* Decides when an objective happens and where it lands. */
class ObjectiveDirector {
  constructor() {
    this.active = null;
    // Late enough that there is a defence to leave behind. At 42s the first
    // one landed before any turret was up, and walking out to it with the
    // whole horde following was just a way to die at two minutes.
    this.next = 72;
    this.done = 0;
    this.won = 0;
    this.order = ['drop', 'hold', 'beacon'];
    this.index = Math.floor(Math.random() * 3);
    this.banner = 0;
  }

  /* Somewhere worth walking to: far enough that leaving the nodes costs
     something, inside the floor, and not on top of a building. */
  findSpot(game, radius) {
    const p = game.player;
    for (let tries = 0; tries < 80; tries++) {
      const a = rand(0, TAU);
      const d = rand(620, 1250);
      const x = p.x + Math.cos(a) * d;
      const y = p.y + Math.sin(a) * d;
      if (x < 180 || y < 180 || x > WORLD_W - 180 || y > WORLD_H - 180) continue;
      let clear = true;
      for (const b of game.blocks) {
        if (dist2(x, y, b.x, b.y) < (b.r + radius + 130) ** 2) { clear = false; break; }
      }
      if (!clear) continue;
      for (const n of game.nodes) {
        if (dist2(x, y, n.x, n.y) < (n.padRadius + radius) ** 2) { clear = false; break; }
      }
      if (clear) return { x, y };
    }
    return null;
  }

  start(game) {
    const kind = this.order[this.index % this.order.length];
    this.index++;
    const spec = OBJECTIVE_TYPES[kind];
    const spot = this.findSpot(game, spec.radius || 70);
    if (!spot) { this.next = game.director.elapsed + 12; return; }
    this.active = new Objective(kind, spot.x, spot.y);
    this.banner = 2.6;
    game.announce(spec.call, spec.colour);
    game.audio.horde();
  }

  finish(game, won) {
    const o = this.active;
    o.state = won ? 'won' : 'lost';
    this.done++;
    if (won) {
      this.won++;
      game.rewardObjective(o);
    } else {
      game.announce(o.spec.label + ' LOST', '#ff7a6b');
    }
    this.active = null;
    this.next = game.director.elapsed + rand(46, 62);
  }

  update(dt, game) {
    const t = game.director.elapsed;
    this.banner = Math.max(0, this.banner - dt);

    if (!this.active) {
      // Nothing new once the clock is nearly out, or while a boss is up:
      // the boss is the objective at that point.
      if (t >= this.next && t < STAGE_DURATION - 55 && !game.boss) this.start(game);
      return;
    }

    const o = this.active;
    o.left -= dt;
    o.flash = Math.max(0, o.flash - dt * 3);
    o.bob += dt;

    const p = game.player;
    const near = dist2(p.x, p.y, o.x, o.y) < (o.radius + p.radius + 14) ** 2;

    if (o.kind === 'drop') {
      if (near) return this.finish(game, true);
    } else if (o.kind === 'hold') {
      if (near) {
        o.held += dt;
        if (o.held >= o.spec.need) return this.finish(game, true);
      }
    } else if (o.kind === 'beacon') {
      if (o.hp <= 0) return this.finish(game, false);
      if (o.left <= 0) return this.finish(game, true);   // it held out
    }

    if (o.left <= 0 && o.kind !== 'beacon') this.finish(game, false);
  }

  /* Where the crowd should walk while this is running. */
  focus() {
    const o = this.active;
    return o && o.spec.pulls ? o : null;
  }
}
