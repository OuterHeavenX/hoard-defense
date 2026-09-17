/* Core simulation + renderer for the Hoard Defense mockup stage. */
'use strict';

let WORLD_W = 1900;          // set from the active arena
let WORLD_H = 1350;
const MAX_WORLD_H = 3600;    // ceiling used to size fixed-length buffers
const MAX_ENEMIES = 1400;
const MAX_BRUTES = 9;          // brutes are set-pieces, not a crowd
const MAX_COINS = 420;
const MAX_PARTICLES = 420;
const MAX_DECALS = 260;        // fading remains left on the battlefield
const MAX_NUMBERS = 40;        // floating damage numbers, big hits only
const NEIGHBOUR_VISITS = 20;   // bodies examined per enemy per frame (hard cap)
const BOSS_AT = 42;            // seconds left when the boss walks in
const LOCK_COST = 1200;        // gold to break the Juggernaut's cage
const DEPOSIT_RATE = 420;      // gold/second - fast enough that a run-through pays

class Game {
  constructor(canvas, hud) {
    this.arena = ARENAS[0];
    WORLD_W = this.arena.width;
    WORLD_H = this.arena.height;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.hud = hud;
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.shakeEnabled = true;
    this.lightingEnabled = true;
    this.quality = 'medium';
    this.zoom = 0.8;            // camera distance multiplier, player-adjustable
    this.grid = new SpatialGrid(WORLD_W + 400, MAX_WORLD_H + 400, 48);
    this.ground = makeGroundPattern(this.ctx, this.arena.ground, this.arena.tile);
    this.screen = { w: 960, h: 600 };   // css pixels
    this.view = { w: 960, h: 600 };     // world units visible
    this.dpr = 1;
    this.scale = 1;
    this.state = 'menu';
    this.reset();
  }

  reset() {
    const startAt = this.arena.playerStart || { x: WORLD_W / 2, y: WORLD_H / 2 };
    this.player = new Player(startAt.x, startAt.y);
    this.director = new WaveDirector(this.arena);
    this.enemies = [];
    this.enemyPool = [];
    this.bullets = [];
    this.bulletPool = [];
    this.coins = [];
    this.coinPool = [];
    this.particles = [];
    this.particlePool = [];
    this.nodes = this.buildNodes();
    this.torches = this.buildTorches();
    this.barricades = this.buildBarricades();
    this.wallSegs = this.buildWallSegs();
    this.props = this.buildProps();
    this.activeBarricade = null;
    this.kills = 0;
    this.goldBanked = 0;
    this.decals = [];
    this.decalPool = [];
    this.numbers = [];
    this.numberPool = [];
    this.boss = null;
    this.bruteCount = 0;
    this.hitStop = 0;
    this.nova = null;
    this.muzzle = null;
    this.pendingLevels = 0;
    this.trail = [];            // dash afterimages
    this.rings = [];            // ground shockwaves (slams, upgrades)
    this.ambient = [];          // drifting dust / embers / mist
    this.ambientTimer = 0;

    // Perk state. Every perk lands on one of these.
    this.level = 1;
    this.xp = 0;
    this.xpNeeded = xpForLevel(1);
    this.perkStacks = {};
    this.perkChoices = null;
    this.goldMul = 1;
    this.depositMul = 1;
    this.turretDamageMul = 1;
    this.turretRateMul = 1;
    this.scavenger = 0;
    this.novaLevel = 0;
    this.novaTimer = 0;
    this.draftSize = 3;
    this.revives = 0;
    this.ally = null;
    this.allyReached = false;
    this.lockNode = null;
    this.runSummary = null;   // filled once, when the run ends
    this.shake = 0;
    this.banner = null;
    this.camera = { x: this.player.x, y: this.player.y };
    this.timeLeft = STAGE_DURATION;
    this.activeNode = null;
    // What the crowd walks toward. The player in a real run; the arena
    // centre while the title screen plays its attract loop.
    this.focus = { x: this.player.x, y: this.player.y };
    this.attract = false;
  }

  /* Flame poles: around the arena's edge and one beside every node, or
     along the corridor walls between the stairs on the gauntlet. They are
     the arena's light - the fight happens in torchlight, not in the dark. */
  /* Barricade runs come from the arena. They are only ever lines, because a
     line is enough to make the horde choose a side and cheap enough to test
     a thousand bodies against. */
  buildBarricades() {
    const seg = typeof PROP_MANIFEST !== 'undefined' ? PROP_MANIFEST.seg : 46;
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    return (this.arena.barricades || []).map(
      (b) => new Barricade(cx + b.x, cy + b.y, b.len, b.vertical, seg));
  }

  /* One drawable per segment, made once. Segments never move, so the only
     per-frame work is deciding which ones are still standing. */
  buildWallSegs() {
    const out = [];
    for (const bar of this.barricades) {
      for (let i = 0; i < bar.count; i++) {
        const c = bar.segCentre(i);
        out.push({ kind: 'wall', x: c.x, y: c.y, bar, i });
      }
    }
    return out;
  }

  buildProps() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    return (this.arena.props || []).map((p) => ({ kind: 'prop', x: cx + p.x, y: cy + p.y, name: p.kind }));
  }

  buildTorches() {
    const out = [];
    const put = (x, y) => out.push({ kind: 'torch', x, y, phase: rand(0, TAU), flicker: 1 });
    if (this.arena.mode === 'gauntlet') {
      for (let y = 180; y < WORLD_H - 120; y += 300) {
        put(52, y);
        put(WORLD_W - 52, Math.min(WORLD_H - 120, y + 150));
      }
    } else {
      const inset = 64, step = 340;
      for (let x = inset + 120; x < WORLD_W - inset - 60; x += step) { put(x, inset); put(x, WORLD_H - inset); }
      for (let y = inset + 120; y < WORLD_H - inset - 60; y += step) { put(inset, y); put(WORLD_W - inset, y); }
    }
    for (const n of this.nodes) if (!n.lock) put(n.x + 74, n.y - 58);
    return out;
  }

  buildNodes() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    return this.arena.nodes.map(([dx, dy]) => new DefenseNode(cx + dx, cy + dy));
  }

  /* Swap the active stage. Must happen before reset() so the node layout,
     ground palette and camera limits all come from the right arena. */
  setZoom(z) {
    this.zoom = clamp(z, 0.45, 1.3);
    this.resize(this.screen.w, this.screen.h, this.dpr);
    return this.zoom;
  }

  setArena(arena) {
    this.arena = arena;
    WORLD_W = arena.width;
    WORLD_H = arena.height;
    this.ground = makeGroundPattern(this.ctx, arena.ground, arena.tile);
    this.grid = new SpatialGrid(WORLD_W + 400, MAX_WORLD_H + 400, 48);
    this.resize(this.screen.w, this.screen.h, this.dpr);
  }

  start(arena) {
    if (arena) this.setArena(arena);
    this.reset();
    if (this.arena.ally) {
      this.ally = new Ally(this.arena.ally.x, this.arena.ally.y);
      this.ally.caged = true;
      // Rushing the cage must cost something, or the climb is a 15s sprint
      // past everything. Gold only comes from kills, so the lock makes the
      // gauntlet the price of the rescue.
      this.lockNode = new DefenseNode(this.arena.ally.x, this.arena.ally.y + 70,
        { costs: [LOCK_COST], maxLevel: 1, lock: true });
      this.nodes.push(this.lockNode);
    }
    Camp.applyTo(this);
    this.audio.suspended = false;
    this.state = 'playing';
    this.announce('HOLD THE LINE', '#8fe8c0');
  }

  /* A self-running battle behind the title screen: pre-built turrets, no
     player, crowd walking the centre. Never ends, never hurts anybody. */
  startAttract() {
    this.reset();
    this.attract = true;
    this.audio.suspended = true;
    this.state = 'menu';
    this.focus = { x: WORLD_W / 2, y: WORLD_H / 2 };
    for (const node of this.nodes) node.level = 1 + randInt(0, 1);
    this.director.elapsed = 120;
    // Seeded as a ring already closing on the centre: spawning them at the
    // arena edge would leave the title screen empty for the ~15s it takes
    // them to walk into frame.
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    for (let i = 0; i < 460; i++) {
      const a = rand(0, TAU), r = rand(170, 620);
      this.spawnEnemy(pick(['grunt', 'grunt', 'runner', 'tank']),
                      cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9);
    }
    for (let i = 0; i < 4; i++) {
      const a = rand(0, TAU);
      this.spawnEnemy('brute', cx + Math.cos(a) * 430, cy + Math.sin(a) * 380);
    }
  }

  updateAttract(dt) {
    this.director.update(dt, this);
    if (this.director.elapsed > 240) this.director.elapsed = 120;
    this.rebuildGrid();
    this.updateEnemies(dt);
    this.updateNodes(dt);
    this.updateBullets(dt);
    this.updateParticles(dt);
    this.updateEffects(dt);
    // Drift the camera slowly around the arena centre.
    const t = performance.now() / 1000;
    this.camera.x = WORLD_W / 2 + Math.cos(t * 0.08) * 240;
    this.camera.y = WORLD_H / 2 + Math.sin(t * 0.06) * 150;
    this.clampCamera();
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      c.life -= dt;
      if (c.life <= 0) {
        c.alive = false;
        this.coins[i] = this.coins[this.coins.length - 1];
        this.coins.pop();
        this.coinPool.push(c);
      }
    }
  }

  announce(text, color) {
    this.banner = { text, color, life: 2.2 };
    if (!this.attract && (text.startsWith('HORDE') || text.startsWith('FINAL'))) this.audio.horde();
  }

  /* The world zooms out on small screens so a phone still sees a horde. */
  resize(cssW, cssH, dpr) {
    this.dpr = dpr;
    this.screen.w = cssW;
    this.screen.h = cssH;
    // A third-person follow camera, which means the view has to be SMALLER
    // than the arena. That was the bug behind every camera complaint so far:
    // at the old distance the view was wider and taller than the stage, so
    // clampCamera pinned it to the arena's centre and it never followed the
    // player at all. What looked like a zoom problem was a static map shot.
    //
    // The two numbers are what the camera holds at zoom 1: about 1100 world
    // px across, and 551 px of projected height, which is ~950 px of world Y
    // once the tilt unsquashes it. On a 1900x1350 arena that leaves the
    // camera 800px of travel across and 400 up and down - it moves with you,
    // and the character is about a twelfth of the screen's height.
    //
    // A phone is too narrow to hold 950 world px of Y at that width, so the
    // width wins there and it follows across only, which is what it already
    // did. Ground runs to the edge of the window on open arenas, so a view
    // reaching past a small stage shows floor rather than a black frame.
    let scale = clamp(this.zoom * Math.min(cssW / 1100, cssH / 551), 0.3, 3.2);

    // A stage small enough that the view covers it on BOTH axes pins the
    // camera dead centre, and the whole thing goes back to being a map shot.
    // One pinned axis is normal - the Bridge is a strip, the Ascent a shaft -
    // but both is the failure, so the smallest arenas are pulled in until at
    // least one axis has somewhere to travel.
    const worldPH = WORLD_H * TILT;
    if (cssW / scale >= WORLD_W && cssH / scale >= worldPH) {
      scale = clamp(Math.max(cssW / WORLD_W, cssH / worldPH) * 1.08, scale, 3.2);
    }
    this.scale = scale;
    this.view.w = cssW / this.scale;
    this.view.h = cssH / this.scale;
  }

  // ---------------------------------------------------------------- spawning

  spawnEnemy(type, x, y) {
    if (this.enemies.length >= MAX_ENEMIES) return null;
    if (type === 'brute') {
      if (this.bruteCount >= MAX_BRUTES) return null;
      this.bruteCount++;
    }
    const e = (this.enemyPool.pop() || new Enemy()).reset(type, x, y, this.director.hpScale);
    this.enemies.push(e);
    return e;
  }

  /* Random point just outside the arena on a random side. */
  edgePoint(side = randInt(0, 3), spread = 1) {
    const m = 70;
    switch (side) {
      case 0: return { x: rand(-m, WORLD_W + m), y: -m * spread };
      case 1: return { x: WORLD_W + m * spread, y: rand(-m, WORLD_H + m) };
      case 2: return { x: rand(-m, WORLD_W + m), y: WORLD_H + m * spread };
      default: return { x: -m * spread, y: rand(-m, WORLD_H + m) };
    }
  }

  spawnAtEdge(type) {
    const p = this.edgePoint(pick(this.arena.spawnSides || [0, 1, 2, 3]));
    this.spawnEnemy(type, p.x, p.y);
  }

  /* World position of a staircase doorway, just inside the wall. */
  stairPoint(stair) {
    return { x: stair.side === 'left' ? 14 : WORLD_W - 14, y: stair.y };
  }

  /* Spawn in the doorway; height is anchored to wall distance from then on. */
  spawnAtStair(type, stair) {
    const p = this.stairPoint(stair);
    const e = this.spawnEnemy(type, p.x + rand(-6, 6), p.y + rand(-34, 34));
    if (e) e.z = STAIR_RISE * STAIR_STEPS;
    return e;
  }

  spawnClusterAtStair(type, count, stair) {
    for (let i = 0; i < count; i++) this.spawnAtStair(type, stair);
  }

  /* A packed blob of enemies pouring in from one side. */
  spawnCluster(type, count, side) {
    const anchor = this.edgePoint(side);
    const spread = Math.sqrt(count) * 13;
    for (let i = 0; i < count; i++) {
      this.spawnEnemy(type, anchor.x + rand(-spread, spread), anchor.y + rand(-spread, spread));
    }
  }

  spawnBullet(x, y, dx, dy, speed, damage, opts) {
    const b = (this.bulletPool.pop() || new Bullet()).reset(x, y, dx, dy, speed, damage, opts);
    if (b.pierce > 0) { b.hits = b.hits || []; b.hits.length = 0; }
    this.bullets.push(b);
  }

  spawnCoin(x, y, value, kind = 'gold') {
    if (this.coins.length >= MAX_COINS) return;
    const c = (this.coinPool.pop() || new Coin()).reset(x, y, value);
    c.pickup = kind;
    this.coins.push(c);
  }

  burst(x, y, count, color, power = 130) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) return;
      const a = rand(0, TAU), s = rand(0.3, 1) * power;
      const p = (this.particlePool.pop() || new Particle())
        .reset(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.18, 0.45), color,
               rand(1.5, 3.5), rand(8, 26), rand(60, 190));
      this.particles.push(p);
    }
  }

  // ----------------------------------------------------------------- updates

  update(dt) {
    if (this.state !== 'playing') return;

    // Hit stop: a couple of frozen frames make a heavy kill land.
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      this.updateParticles(dt);
      this.updateNumbers(dt);
      return;
    }

    this.input.update();
    this.focus.x = this.player.x;
    this.focus.y = this.player.y;
    this.director.update(dt, this);
    this.timeLeft -= dt;

    this.updateBoss(dt);
    this.updatePlayer(dt);
    this.updateAlly(dt);
    this.rebuildGrid();
    this.updateEnemies(dt);
    this.updateNodes(dt);
    this.updateBarricades(dt);
    this.updateBullets(dt);
    this.updateCoins(dt);
    this.updateParticles(dt);
    this.updateDecals(dt);
    this.updateNumbers(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);

    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    this.shake = Math.max(0, this.shake - dt * 22);

    if (this.player.hp <= 0) {
      if (this.revives > 0) {
        this.revive();
      } else {
        this.state = 'lost';
        this.finishRun(false);
      }
    } else if (this.timeLeft <= 0) {
      // The clock running out no longer ends the stage - the boss does.
      this.timeLeft = 0;
      if (!this.boss) this.spawnBoss();
    }
  }

  updatePlayer(dt) {
    const p = this.player;
    if (this.input.takeDash() && p.dash()) {
      this.burst(p.x, p.y, 10, '#8fd8ff', 180);
      this.audio.dash();
    }
    if (p.dashTimer > 0 && this.trail.length < 12) {
      this.trail.push({ x: p.x, y: p.y, facing: p.facing, flip: p.flip, anim: p.anim, life: 0.28, maxLife: 0.28 });
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }

    p.dashTimer = Math.max(0, p.dashTimer - dt);
    p.dashCooldown = Math.max(0, p.dashCooldown - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.hurtFlash = Math.max(0, p.hurtFlash - dt);

    if (p.dashTimer > 0) {
      p.vx = damp(p.vx, 0, 6, dt);
      p.vy = damp(p.vy, 0, 6, dt);
    } else {
      const targetVx = this.input.moveX * p.speed;
      const targetVy = this.input.moveY * p.speed;
      p.vx = damp(p.vx, targetVx, 16, dt);
      p.vy = damp(p.vy, targetVy, 16, dt);
    }

    p.x = clamp(p.x + p.vx * dt, p.radius, WORLD_W - p.radius);
    p.y = clamp(p.y + p.vy * dt, p.radius, WORLD_H - p.radius);
    p.anim += Math.hypot(p.vx, p.vy) * dt * 0.07;

    if (this.novaLevel > 0) {
      this.novaTimer -= dt;
      if (this.novaTimer <= 0) {
        this.novaTimer = Math.max(1.4, 4 - this.novaLevel * 0.6);
        const radius = 120 + this.novaLevel * 35;
        this.splash(p.x, p.y, radius, 12 + this.novaLevel * 8);
        this.nova = { x: p.x, y: p.y, radius, life: 0.35, maxLife: 0.35 };
      }
    }
    if (this.nova) {
      this.nova.life -= dt;
      if (this.nova.life <= 0) this.nova = null;
    }
    if (this.muzzle) {
      this.muzzle.life -= dt;
      if (this.muzzle.life <= 0) this.muzzle = null;
    }

    // Auto-fire at whatever is closest; aim drives the sprite's facing too.
    // The target is cached between shots: nearestEnemy is a full-crowd scan.
    p.fireTimer -= dt;
    const target = this.acquire(p, p.x, p.y, p.range);
    if (target) {
      const a = Math.atan2(target.y - p.y, target.x - p.x);
      p.facing = a;
      if (p.fireTimer <= 0) {
        p.fireTimer = p.fireInterval;
        const spread = rand(-0.05, 0.05);
        this.spawnBullet(
          p.x + Math.cos(a) * 16, p.y + Math.sin(a) * 16,
          Math.cos(a + spread), Math.sin(a + spread),
          680, p.damage, { pierce: p.pierce, life: p.range / 680 + 0.1, color: '#ffe9a8' }
        );
      }
    } else if (Math.hypot(p.vx, p.vy) > 12) {
      p.facing = Math.atan2(p.vy, p.vx);
    }
  }

  /* Reuses holder.target while it is alive and in range, otherwise rescans. */
  acquire(holder, x, y, range) {
    const t = holder.target;
    if (t && t.alive && dist2(x, y, t.x, t.y) <= range * range) return t;
    return (holder.target = this.nearestEnemy(x, y, range));
  }

  nearestEnemy(x, y, range) {
    let best = null, bestD = range * range;
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const d = dist2(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  rebuildGrid() {
    this.grid.clear();
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      this.grid.insert(e);
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    const focus = this.focus;
    const list = this.enemies;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.flash = Math.max(0, e.flash - dt * 4);
      e.touchTimer = Math.max(0, e.touchTimer - dt);

      // Seek the player with a little sway so the mass doesn't look rigid.
      let dx = focus.x - e.x, dy = focus.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;
      e.wobble += dt * 3;
      const sway = Math.sin(e.wobble) * 0.18;
      let mx = dx * Math.cos(sway) - dy * Math.sin(sway);
      let my = dx * Math.sin(sway) + dy * Math.cos(sway);

      // Separation. The visit cap is what keeps a 900-strong pile-up linear:
      // sampling a bounded slice of the neighbourhood looks identical once the
      // crowd is this dense, and costs a fixed amount per body.
      let sx = 0, sy = 0, visits = 0;
      this.grid.forEachNear(e.x, e.y, (o) => {
        if (++visits > NEIGHBOUR_VISITS) return false;
        if (o === e) return;
        const ox = e.x - o.x, oy = e.y - o.y;
        const min = (e.radius + o.radius) * 0.62;   // <1 so the crowd packs and overlaps
        const d2 = ox * ox + oy * oy;
        if (d2 > 0.01 && d2 < min * min) {
          const d = Math.sqrt(d2);
          const push = (min - d) / min;
          sx += (ox / d) * push;
          sy += (oy / d) * push;
        }
      });

      e.vx = mx * e.speed + sx * 48;
      e.vy = my * e.speed + sy * 48;
      const wasX = e.x, wasY = e.y;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (this.barricades.length) this.blockAtWall(e, wasX, wasY);

      // Stride speed follows actual movement so the crowd never moonwalks.
      e.anim += Math.hypot(e.vx, e.vy) * dt * 0.09;
      if (Math.abs(e.vx) > 6) e.flip = e.vx < 0;
      if (e.z > 0) {
        const fromWall = Math.min(e.x, WORLD_W - e.x);
        e.z = Math.max(0, Math.min(e.z, STAIR_RISE * STAIR_STEPS * (1 - fromWall / STAIR_LENGTH)));
      }

      if (this.attract) continue;

      const ally = this.ally;
      if (ally && ally.active && e.touchTimer <= 0) {
        const reach = e.radius + ally.radius;
        if (dist2(e.x, e.y, ally.x, ally.y) < reach * reach) {
          e.touchTimer = 0.6;
          this.damageAlly(e.damage * 0.6);
        }
      }

      // Contact damage, rate limited per enemy.
      const touch = e.radius + p.radius;
      if (e.touchTimer <= 0 && dist2(e.x, e.y, p.x, p.y) < touch * touch) {
        e.touchTimer = 0.6;
        if (p.hurt(e.damage)) {
          this.shake = Math.min(14, this.shake + 4);
          this.burst(p.x, p.y, 6, '#ff6b6b', 150);
          this.audio.hurt();
        }
      }
    }
  }

  /* Stops a body at a standing wall and lets it chew. Only the component
     crossing the line is cancelled, so the horde slides along the wall and
     pours around the end or through a hole on its own - the funnel is the
     wall's shape, not a path anyone had to compute. The side to push back to
     comes from where the body was a frame ago, not from which side of the
     line it landed on, so a fast runner is never spat out the far side. */
  blockAtWall(e, wasX, wasY) {
    const bars = this.barricades;
    for (let b = 0; b < bars.length; b++) {
      const bar = bars[b];
      if (bar.level === 0) continue;
      const i = bar.segmentAt(e.x, e.y, e.radius * 0.55);
      if (i < 0) continue;

      // A boss walks through the wall and takes it with him.
      if (e.type === 'boss') {
        if (bar.damageSegment(i, 420 * (e.slamming ? 3 : 1))) this.breakSegment(bar, i);
        continue;
      }

      const gap = bar.half + e.radius * 0.55;
      if (bar.vertical) {
        e.x = bar.x + (wasX < bar.x ? -gap : gap);
        e.vx = 0;
      } else {
        e.y = bar.y + (wasY < bar.y ? -gap : gap);
        e.vy = 0;
      }
      if (e.touchTimer <= 0) {
        e.touchTimer = 0.6;
        // Scaled well down from what a body does to the player: a wall is
        // meant to buy a horde's worth of seconds, not fall to the first rank.
        if (bar.damageSegment(i, e.damage * 0.5)) this.breakSegment(bar, i);
      }
    }
  }

  breakSegment(bar, i) {
    const c = bar.segCentre(i);
    this.burst(c.x, c.y, 14, '#b9a78a', 190);
    this.addDecal(c.x, c.y, 26, 'rgba(30,24,18,0.5)');
    this.shake = Math.min(12, this.shake + 2);
    this.audio.hurt();
    if (bar.standing === 0) this.announce('WALL DOWN', '#ffb36b');
  }

  /* Pour into a wall the same way as into a turret: stand on the line and it
     takes the gold, patching holes before it will raise another tier. */
  updateBarricades(dt) {
    const p = this.player;
    this.activeBarricade = null;
    for (const bar of this.barricades) {
      bar.pulse = Math.max(0, bar.pulse - dt * 1.6);
      bar.recentFeed = Math.max(0, bar.recentFeed - dt);
      for (let i = 0; i < bar.count; i++) {
        if (bar.hit[i] > 0) bar.hit[i] = Math.max(0, bar.hit[i] - dt * 4);
      }

      if (dist2(p.x, p.y, bar.padX, bar.padY) > bar.padRadius * bar.padRadius) continue;
      this.activeBarricade = bar;

      if (this.activeNode || p.gold < 1) continue;
      const spent = bar.feed(Math.min(p.gold, DEPOSIT_RATE * this.depositMul * dt));
      if (spent > 0) {
        p.gold -= spent;
        this.audio.deposit();
      }
      if (bar.pulse === 1) {
        const c = bar.segCentre((bar.count / 2) | 0);
        this.announce(['', 'PALISADE', 'STONE WALL', 'RAMPART'][bar.level], '#ffd9a0');
        this.burst(c.x, c.y, 20, '#ffd9a0', 220);
        this.rings.push({ x: c.x, y: c.y, r: 20, maxR: 180, life: 0.5, maxLife: 0.5, color: '255,217,160' });
        this.audio.upgrade();
      }
    }
  }

  damageEnemy(e, amount, knockX, knockY) {
    if (!e.alive) return;
    e.hp -= amount;
    e.flash = 1;

    // A spark where the round lands - rate limited by the particle cap.
    if (knockX !== undefined && this.particles.length < MAX_PARTICLES - 40) {
      const p = (this.particlePool.pop() || new Particle())
        .reset(e.x - knockX * e.radius, e.y - knockY * e.radius,
               -knockX * rand(60, 160) + rand(-40, 40), -knockY * rand(60, 160) + rand(-40, 40),
               rand(0.08, 0.16), '#fff1b0', rand(1.5, 2.5), 14, rand(40, 120));
      this.particles.push(p);
    }

    // Only the chunky bodies get knockback and a number; doing it for every
    // grunt would be noise on screen and a needless cost.
    if (e.type === 'boss' || e.type === 'brute') {
      this.addNumber(e.x, e.y, Math.round(amount), e.type === 'boss' ? '#ffd34d' : '#ffe9a8');
      if (knockX !== undefined && e.type !== 'boss') {
        e.x += knockX * 3;
        e.y += knockY * 3;
      }
    } else if (knockX !== undefined) {
      e.x += knockX * 6;
      e.y += knockY * 6;
    }

    if (e.hp > 0) return;

    e.alive = false;
    if (e.type === 'brute') this.bruteCount--;
    this.kills++;
    this.audio.kill();
    this.addXp(e.type === 'boss' ? 70 : e.type === 'brute' ? 14 : e.type === 'tank' ? 4 : 1);

    const d = e.def;
    this.addDecal(e.x, e.y, e.radius * e.scale, d.dark);
    if (e.type === 'boss') this.addDecal(e.x, e.y, e.radius * 2.2, d.dark);
    // Gibs: a few body-coloured chunks that arc and bounce, plus the dark spray.
    this.burst(e.x, e.y, e.type === 'brute' ? 24 : 5, d.dark, e.type === 'brute' ? 260 : 120);
    this.burst(e.x, e.y, e.type === 'brute' ? 10 : 3, d.color, e.type === 'brute' ? 200 : 110);
    for (let i = 0; i < d.coins; i++) {
      this.spawnCoin(e.x + rand(-8, 8), e.y + rand(-8, 8), d.value);
    }
    if (e.type === 'brute') {
      this.spawnCoin(e.x, e.y, 18, 'health');
      this.shake = Math.min(16, this.shake + 6);
      this.hitStop = Math.max(this.hitStop, 0.05);
      this.audio.bruteKill();
    }
    if (e.type === 'boss') this.spawnCoin(e.x, e.y, 60, 'health');
  }

  revive() {
    const p = this.player;
    this.revives--;
    p.hp = Math.ceil(p.maxHp * 0.4);
    p.invuln = 1.6;
    p.hurtFlash = 0;
    this.hitStop = 0.2;
    this.shake = 20;
    this.burst(p.x, p.y, 40, '#7bf0a6', 300);
    this.splash(p.x, p.y, 180, 40);     // clears the pocket that killed you
    this.announce('SECOND CHANCE', '#7bf0a6');
    this.audio.upgrade();
  }

  /* Banks the run's takings and records the result. Runs once per run;
     both the win and the loss path route through here. */
  finishRun(won) {
    if (this.runSummary || this.attract) return;
    // A clear held the whole stage by definition; the clock keeps running
    // through the boss fight, so timeLeft alone would under-report it.
    const survived = won ? STAGE_DURATION : Math.min(STAGE_DURATION, STAGE_DURATION - this.timeLeft);
    const kept = Camp.deposit(this.goldBanked);
    const improved = Records.submit(this.arena.id, {
      kills: this.kills, level: this.level, survived, cleared: won
    });
    this.runSummary = { kept, improved, survived };
  }

  /* Camp deployment: beside the player at the start of any stage. On The
     Ascent the caged one at the top is the story; the owned one still walks
     in with you. */
  deployAlly() {
    if (this.ally && !this.ally.caged) return;
    if (this.ally && this.ally.caged) {
      // Owned and on The Ascent: he is with you from the start; the cage
      // at the top is empty and reaching it still triggers the finale.
      this.ally.caged = false;
      this.ally.x = this.player.x + 40;
      this.ally.y = this.player.y + 30;
      return;
    }
    this.ally = new Ally(this.player.x + 40, this.player.y + 30);
  }

  /* The player reaches the cage. */
  freeAlly() {
    if (this.allyReached) return;
    this.allyReached = true;
    if (this.ally && this.ally.caged) {
      this.ally.caged = false;
      this.burst(this.ally.x, this.ally.y, 40, '#ffd34d', 300);
    }
    this.announce('THE JUGGERNAUT IS FREE', '#ffd34d');
    this.audio.upgrade();
    this.shake = 14;
    // His jailer comes down the top stairs.
    if (!this.boss) this.spawnBoss(this.arena.ally.x, this.arena.ally.y - 60);
  }

  updateAlly(dt) {
    const a = this.ally;
    if (!a) return;
    const p = this.player;
    a.hurtTimer = Math.max(0, a.hurtTimer - dt);

    if (a.caged) return;      // freed by paying the lock node, see updateNodes

    if (a.down) {
      a.downTimer -= dt;
      a.firing = false;
      a.spin = 0;
      if (a.downTimer <= 0) {
        a.hp = Math.ceil(a.maxHp * 0.5);
        this.burst(a.x, a.y, 20, '#7bf0a6', 200);
        this.announce('JUGGERNAUT UP', '#7bf0a6');
      }
      return;
    }

    // Follow: close to a trailing point, but never crowd the player.
    const dx = p.x - a.x, dy = p.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    const want = d > 90 ? a.speed : d > 60 ? a.speed * 0.5 : 0;
    a.vx = damp(a.vx, (dx / d) * want, 10, dt);
    a.vy = damp(a.vy, (dy / d) * want, 10, dt);
    a.x = clamp(a.x + a.vx * dt, a.radius, WORLD_W - a.radius);
    a.y = clamp(a.y + a.vy * dt, a.radius, WORLD_H - a.radius);
    a.anim += Math.hypot(a.vx, a.vy) * dt * 0.06;

    // Gatling: spin up on a target, spin down without one.
    const target = this.acquire(a, a.x, a.y, a.range);
    a.fireTimer -= dt;
    if (target) {
      a.facing = Math.atan2(target.y - a.y, target.x - a.x);
      a.flip = Math.cos(a.facing) < 0;
      a.spin = Math.min(a.spinUp, a.spin + dt);
      a.firing = a.spin >= a.spinUp;
      if (a.firing && a.fireTimer <= 0) {
        a.fireTimer = a.fireInterval;
        const spread = rand(-0.09, 0.09);
        this.spawnBullet(
          a.x + Math.cos(a.facing) * 30, a.y + Math.sin(a.facing) * 30,
          Math.cos(a.facing + spread), Math.sin(a.facing + spread),
          760, a.damage, { pierce: 1, life: a.range / 760 + 0.05, color: '#ffc16b', z: 26, radius: 3 }
        );
        this.audio.gatling();
      }
    } else {
      a.spin = Math.max(0, a.spin - dt * 1.6);
      a.firing = false;
      if (Math.hypot(a.vx, a.vy) > 12) { a.facing = Math.atan2(a.vy, a.vx); a.flip = a.vx < 0; }
    }
  }

  damageAlly(amount) {
    const a = this.ally;
    if (!a || !a.active || a.hurtTimer > 0) return;
    a.hp -= amount;
    a.hurtTimer = 0.3;
    if (a.hp <= 0) {
      a.hp = 0;
      a.downTimer = a.downFor;
      this.burst(a.x, a.y, 30, '#2f3a2a', 260);
      this.announce('JUGGERNAUT DOWN', '#ff7a6b');
      this.audio.hurt();
      this.shake = 12;
    }
  }

  /* 0..1 - how loud the fight should sound. Feeds the music each frame. */
  intensity() {
    if (this.attract || this.state === 'menu') return 0;
    return clamp(this.director.progress * 0.85 + (this.boss ? 0.3 : 0), 0, 1);
  }

  addXp(amount) {
    if (this.attract) return;
    this.xp += amount;
    while (this.xp >= this.xpNeeded) {
      this.xp -= this.xpNeeded;
      this.level++;
      this.xpNeeded = xpForLevel(this.level);
      this.pendingLevels = (this.pendingLevels || 0) + 1;
    }
  }

  /* Called by the loop between frames so the draft never interrupts a step. */
  takeLevelUp() {
    if (!this.pendingLevels || this.state !== 'playing') return null;
    this.pendingLevels--;
    this.perkChoices = rollPerks(this, this.draftSize);
    if (!this.perkChoices.length) return null;   // everything maxed
    this.state = 'levelup';
    this.audio.upgrade();
    return this.perkChoices;
  }

  choosePerk(perk) {
    applyPerk(this, perk);
    this.perkChoices = null;
    this.state = 'playing';
  }

  addDecal(x, y, size, color) {
    if (this.decals.length >= MAX_DECALS) {
      // Recycle the oldest rather than skipping, so remains keep accumulating
      // where the fighting actually is.
      this.decalPool.push(this.decals.shift());
    }
    const d = this.decalPool.pop() || {};
    d.x = x; d.y = y; d.size = size * rand(0.8, 1.3);
    d.life = 14; d.maxLife = 14; d.color = color;
    this.decals.push(d);
  }

  addNumber(x, y, text, color) {
    if (this.numbers.length >= MAX_NUMBERS) return;
    const n = this.numberPool.pop() || {};
    n.x = x; n.y = y; n.z = 34; n.vz = 70;
    n.text = text; n.color = color; n.life = 0.85; n.maxLife = 0.85;
    this.numbers.push(n);
  }

  /* Radial damage used by upgraded turrets. Grid-bounded: upgraded nodes fire
     often enough that a full-crowd scan per blast is not affordable. */
  splash(x, y, radius, damage) {
    const r2 = radius * radius;
    this.grid.forEachInRect(x - radius, y - radius, x + radius, y + radius, (e) => {
      if (e.alive && dist2(x, y, e.x, e.y) < r2) this.damageEnemy(e, damage);
    });
    this.burst(x, y, 8, '#ffb36b', 200);
  }

  spawnBoss(atX, atY) {
    if (this.boss) return;
    const p = this.player;
    const a = rand(0, TAU);
    const x = atX !== undefined ? clamp(atX, 60, WORLD_W - 60) : clamp(p.x + Math.cos(a) * 520, 60, WORLD_W - 60);
    const y = atY !== undefined ? clamp(atY, 60, WORLD_H - 60) : clamp(p.y + Math.sin(a) * 420, 60, WORLD_H - 60);
    this.boss = new Boss(this.arena.boss, x, y, (1 + this.director.progress * 0.5) * (this.arena.bossScale || 1));
    this.enemies.push(this.boss);
    this.announce(this.boss.name, '#ff7a6b');
    this.audio.horde();
    this.shake = 18;
  }

  updateBoss(dt) {
    // Spawns in the last stretch so the run builds to it rather than stopping.
    if (!this.boss && this.timeLeft <= BOSS_AT && !this.attract) this.spawnBoss();
    const b = this.boss;
    if (!b) return;

    if (!b.alive) {
      this.boss = null;
      this.state = 'won';
      Progress.markCleared(this.arena.id);
      this.finishRun(true);
      this.shake = 26;
      this.hitStop = 0.28;
      this.burst(b.x, b.y, 60, b.def.dark, 360);
      this.rings.push({ x: b.x, y: b.y, r: 30, maxR: 420, life: 0.9, maxLife: 0.9, color: '255,220,160' });
      this.flashScreen = 0.6;
      return;
    }

    b.telegraph = Math.max(0, b.telegraph - dt);
    b.slamHold = Math.max(0, (b.slamHold || 0) - dt);
    b.attackTimer -= dt;

    if (b.def.attack === 'charge' && b.charging > 0) {
      b.charging -= dt;
      if (b.charging <= 0) b.speed = b.def.speed;
    } else if (b.attackTimer <= 0 && b.telegraph <= 0) {
      b.telegraph = 0.7;                       // wind-up the player can read
      b.attackTimer = b.def.attackInterval;
      b.pendingAttack = true;
    } else if (b.pendingAttack && b.telegraph <= 0) {
      b.pendingAttack = false;
      b.slamHold = 0.35;             // the strike frame lingers, then recovers
      if (b.def.attack === 'slam') {
        this.splash(b.x, b.y, 200, 26);
        this.burst(b.x, b.y, 34, '#ffb36b', 280);
        this.burst(b.x, b.y, 30, '#5a4a3a', 220);       // dust
        this.rings.push({ x: b.x, y: b.y, r: 40, maxR: 260, life: 0.55, maxLife: 0.55, color: '255,180,120' });
        this.flashScreen = 0.35;
        this.shake = 16;
        for (let i = 0; i < 12; i++) {
          const a = rand(0, TAU);
          this.spawnEnemy('grunt', b.x + Math.cos(a) * 90, b.y + Math.sin(a) * 90);
        }
        if (dist2(b.x, b.y, this.player.x, this.player.y) < 200 * 200 && this.player.hurt(24)) {
          this.audio.hurt();
        }
      } else {
        b.speed = b.def.speed * 3.4;           // charge
        b.charging = 1.5;
        for (let i = 0; i < 6; i++) {
          const a = rand(0, TAU);
          this.spawnEnemy('runner', b.x + Math.cos(a) * 80, b.y + Math.sin(a) * 80);
        }
      }
      this.audio.bruteKill();
    }
  }

  updateNodes(dt) {
    const p = this.player;
    this.activeNode = null;

    for (const node of this.nodes) {
      node.pulse = Math.max(0, node.pulse - dt * 1.6);
      node.recentFeed = Math.max(0, node.recentFeed - dt);
      node.recoil = Math.max(0, (node.recoil || 0) - dt * 9);

      // Pour carried gold in while the player stands on the pad.
      if (dist2(p.x, p.y, node.x, node.y) < node.padRadius * node.padRadius) {
        this.activeNode = node;
        if (p.gold >= 1 && !node.maxed) {
          const want = Math.min(p.gold, DEPOSIT_RATE * this.depositMul * dt);
          const spent = node.feed(want);
          p.gold -= spent;
          if (spent > 0) this.audio.deposit();
          if (node.pulse === 1) {
            if (node.lock) {
              this.freeAlly();
            } else {
              this.announce('NODE LV' + node.level, '#8fd8ff');
              this.burst(node.x, node.y, 18, '#8fd8ff', 220);
              this.rings.push({ x: node.x, y: node.y, r: 20, maxR: 160, life: 0.5, maxLife: 0.5, color: '143,216,255' });
              this.audio.upgrade();
            }
          }
        }
      }

      if (node.level === 0 || node.lock) continue;
      const st = node.stats;
      node.fireTimer -= dt;
      const target = this.acquire(node, node.x, node.y, st.range);
      if (!target) continue;

      const aim = Math.atan2(target.y - node.y, target.x - node.x);
      node.angle = aimTowards(node.angle, aim, dt * 7);
      if (node.fireTimer > 0) continue;

      node.fireTimer = st.interval * this.turretRateMul;
      node.recoil = 1;
      this.audio.turretShoot();
      for (let i = 0; i < st.barrels; i++) {
        const off = (i - (st.barrels - 1) / 2) * 0.16;
        const a = node.angle + off;
        this.spawnBullet(
          node.x + Math.cos(a) * 22, node.y + Math.sin(a) * 22,
          Math.cos(a), Math.sin(a), 580, st.damage * this.turretDamageMul,
          { life: st.range / 580 + 0.1, splash: st.splash, radius: 4.5, color: '#8fd8ff', z: 26 }
        );
      }
    }
  }

  updateBullets(dt) {
    const list = this.bullets;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;

      let consumed = b.life <= 0;
      if (!consumed) {
        this.grid.forEachNear(b.x, b.y, (e) => {
          if (consumed || !e.alive) return;
          if (b.hits && b.hits.indexOf(e) !== -1) return;
          const r = e.radius + b.radius;
          if (dist2(b.x, b.y, e.x, e.y) > r * r) return;

          if (b.splash > 0) {
            this.splash(b.x, b.y, b.splash, b.damage);
            consumed = true;
            return;
          }
          const bl = Math.hypot(b.vx, b.vy) || 1;
          this.damageEnemy(e, b.damage, b.vx / bl, b.vy / bl);
          if (b.pierce > 0 && b.hits.length < b.pierce) b.hits.push(e);
          else consumed = true;
        });
      }

      if (consumed) {
        b.alive = false;
        list[i] = list[list.length - 1];
        list.pop();
        this.bulletPool.push(b);
      }
    }
    this.compactEnemies();
  }

  compactEnemies() {
    const list = this.enemies;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].alive) continue;
      const e = list[i];
      if (e.type === 'boss') { list[i] = list[list.length - 1]; list.pop(); continue; }
      list[i] = list[list.length - 1];
      list.pop();
      this.enemyPool.push(e);
    }
  }

  updateCoins(dt) {
    const p = this.player;
    const list = this.coins;
    const magnet = p.magnetRadius, magnet2 = magnet * magnet;

    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      c.life -= dt;
      c.spin += dt * 6;
      c.vx = damp(c.vx, 0, 5, dt);
      c.vy = damp(c.vy, 0, 5, dt);

      const d2 = dist2(c.x, c.y, p.x, p.y);
      if (d2 < magnet2) {
        const d = Math.sqrt(d2) || 1;
        const pull = lerp(620, 180, d / magnet);
        c.vx += ((p.x - c.x) / d) * pull * dt * 4;
        c.vy += ((p.y - c.y) / d) * pull * dt * 4;
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      c.vz -= 460 * dt;
      if (c.z < 0) { c.z = 0; c.vz *= -0.4; }

      const grab = p.radius + 12;
      if (d2 < grab * grab) {
        if (c.pickup === 'health') {
          p.heal(c.value);
          this.burst(c.x, c.y, 8, '#7bf0a6', 120);
        } else {
          const worth = c.value * this.goldMul;
          p.gold += worth;
          this.goldBanked += worth;
          if (this.scavenger) p.heal(this.scavenger);
          this.audio.coin();
        }
        c.life = 0;
      }

      if (c.life <= 0) {
        c.alive = false;
        list[i] = list[list.length - 1];
        list.pop();
        this.coinPool.push(c);
      }
    }
  }

  updateParticles(dt) {
    const list = this.particles;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= 420 * dt;               // debris arcs instead of sliding
      if (p.z < 0) { p.z = 0; p.vz *= -0.35; }
      p.vx = damp(p.vx, 0, 4, dt);
      p.vy = damp(p.vy, 0, 4, dt);
      if (p.life <= 0) {
        p.alive = false;
        list[i] = list[list.length - 1];
        list.pop();
        this.particlePool.push(p);
      }
    }
  }

  /* Ground rings, the screen flash, and the arena's ambient motes. */
  updateEffects(dt) {
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
    this.flashScreen = Math.max(0, (this.flashScreen || 0) - dt * 2.2);

    // Torches breathe, and shed the odd ember.
    const now = performance.now() / 1000;
    for (const t of this.torches) {
      t.flicker = 0.86 + Math.sin(now * 9 + t.phase) * 0.07 + Math.sin(now * 23 + t.phase * 1.7) * 0.05;
      if (this.ambient.length < 90 && Math.random() < dt * 1.6 &&
          Math.abs(t.x - this.camera.x) < this.view.w && Math.abs(t.y - this.camera.y) < this.view.h / TILT) {
        this.ambient.push({ x: t.x + rand(-3, 3), y: t.y, z: 56 + rand(0, 6), vx: rand(-6, 6), vy: rand(-3, 3),
                            vz: rand(22, 40), life: rand(0.6, 1.3), maxLife: 1, kind: 'embers', size: rand(1.2, 2) });
        this.ambient[this.ambient.length - 1].maxLife = this.ambient[this.ambient.length - 1].life;
      }
    }

    const kind = this.arena.ambient;
    if (kind) {
      this.ambientTimer -= dt;
      if (this.ambientTimer <= 0 && this.ambient.length < (this.quality === 'high' ? 90 : 40)) {
        this.ambientTimer = 0.05;
        // Born just off the camera's window so drift carries them through it.
        const cx = this.camera.x, cy = this.camera.y;
        const m = { x: cx + rand(-this.view.w * 0.6, this.view.w * 0.6), y: cy + rand(-this.view.h * 0.7 / TILT, this.view.h * 0.7 / TILT),
                    z: kind === 'mist' ? rand(4, 22) : rand(0, 60), life: rand(2.5, 5), maxLife: 0, kind };
        m.maxLife = m.life;
        if (kind === 'dust') { m.vx = rand(30, 70); m.vy = rand(-8, 8); m.vz = rand(-4, 6); m.size = rand(1.2, 2.4); }
        else if (kind === 'embers') { m.vx = rand(-12, 12); m.vy = rand(-10, 10); m.vz = rand(18, 40); m.size = rand(1.4, 2.6); }
        else { m.vx = rand(8, 22); m.vy = rand(-3, 3); m.vz = rand(-1, 1); m.size = rand(22, 46); }
        this.ambient.push(m);
      }
      for (let i = this.ambient.length - 1; i >= 0; i--) {
        const m = this.ambient[i];
        m.life -= dt;
        m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
        if (m.kind === 'embers') m.vx += Math.sin(m.life * 5) * 18 * dt;
        if (m.life <= 0) this.ambient.splice(i, 1);
      }
    } else {
      for (let i = this.ambient.length - 1; i >= 0; i--) {
        const m = this.ambient[i];
        m.life -= dt;
        m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
        if (m.life <= 0) this.ambient.splice(i, 1);
      }
    }
  }

  updateDecals(dt) {
    const list = this.decals;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.life -= dt;
      if (d.life <= 0) {
        list[i] = list[list.length - 1];
        list.pop();
        this.decalPool.push(d);
      }
    }
  }

  updateNumbers(dt) {
    const list = this.numbers;
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      n.life -= dt;
      n.z += n.vz * dt;
      n.vz -= 120 * dt;
      if (n.life <= 0) {
        list[i] = list[list.length - 1];
        list.pop();
        this.numberPool.push(n);
      }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    this.camera.x = damp(this.camera.x, p.x, 9, dt);
    this.camera.y = damp(this.camera.y, p.y, 9, dt);
    this.clampCamera();
  }

  /* Vertical limits are in projected space, since screen Y is world Y * TILT. */
  clampCamera() {
    const halfW = this.view.w / 2;
    const halfH = (this.view.h / 2) / TILT;
    this.camera.x = clamp(this.camera.x,
      Math.min(halfW, WORLD_W / 2), Math.max(WORLD_W - halfW, WORLD_W / 2));
    this.camera.y = clamp(this.camera.y,
      Math.min(halfH, WORLD_H / 2), Math.max(WORLD_H - halfH, WORLD_H / 2));
  }
}

function aimTowards(current, target, step) {
  let diff = ((target - current + Math.PI) % TAU + TAU) % TAU - Math.PI;
  if (Math.abs(diff) <= step) return target;
  return current + Math.sign(diff) * step;
}

/* Ground pattern: a Blender-rendered tile when the arena names one and it
   loaded, else the procedural flecked dirt. One fill per frame either way. */
function makeGroundPattern(ctx, palette, tileKey) {
  const img = tileKey && Assets.ground[tileKey];
  if (img) {
    // The flagstone coursing is built to tile; the earth noise is not, so it
    // is laid as a 2x2 mirror so every edge meets its own reflection.
    if (tileKey === 'stone') return ctx.createPattern(img, 'repeat');
    const c = document.createElement('canvas');
    c.width = img.width * 2; c.height = img.height * 2;
    const g = c.getContext('2d');
    for (let i = 0; i < 4; i++) {
      g.save();
      g.translate(i & 1 ? img.width * 2 : 0, i & 2 ? img.height * 2 : 0);
      g.scale(i & 1 ? -1 : 1, i & 2 ? -1 : 1);
      g.drawImage(img, 0, 0);
      g.restore();
    }
    return ctx.createPattern(c, 'repeat');
  }
  const pal = palette || { base: '#2b2f26', fleck: [[40, 70], [44, 74], [34, 56]] };
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = pal.base;
  g.fillRect(0, 0, size, size);
  const [r, gr, b] = pal.fleck;
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(${randInt(r[0], r[1])},${randInt(gr[0], gr[1])},${randInt(b[0], b[1])},0.9)`;
    g.fillRect(rand(0, size), rand(0, size), rand(2, 7), rand(2, 7));
  }
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  g.strokeRect(0.5, 0.5, size - 1, size - 1);
  return ctx.createPattern(c, 'repeat');
}
