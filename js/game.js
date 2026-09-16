/* Core simulation + renderer for the Hoard Defense mockup stage. */
'use strict';

const WORLD_W = 1900;
const WORLD_H = 1350;
const MAX_ENEMIES = 1400;
const MAX_COINS = 420;
const MAX_PARTICLES = 420;
const NEIGHBOUR_VISITS = 20;   // bodies examined per enemy per frame (hard cap)
const DEPOSIT_RATE = 420;      // gold/second - fast enough that a run-through pays

class Game {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.hud = hud;
    this.input = new Input(canvas);
    this.audio = new Audio();
    this.shakeEnabled = true;
    this.grid = new SpatialGrid(WORLD_W + 400, WORLD_H + 400, 48);
    this.ground = makeGroundPattern(this.ctx);
    this.screen = { w: 960, h: 600 };   // css pixels
    this.view = { w: 960, h: 600 };     // world units visible
    this.dpr = 1;
    this.scale = 1;
    this.state = 'menu';
    this.reset();
  }

  reset() {
    this.player = new Player(WORLD_W / 2, WORLD_H / 2);
    this.director = new WaveDirector();
    this.enemies = [];
    this.enemyPool = [];
    this.bullets = [];
    this.bulletPool = [];
    this.coins = [];
    this.coinPool = [];
    this.particles = [];
    this.particlePool = [];
    this.nodes = this.buildNodes();
    this.kills = 0;
    this.goldBanked = 0;
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

  buildNodes() {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const layout = [
      [cx, cy - 285], [cx, cy + 285],
      [cx - 355, cy - 115], [cx + 355, cy - 115],
      [cx - 355, cy + 115], [cx + 355, cy + 115]
    ];
    return layout.map(([x, y]) => new DefenseNode(x, y));
  }

  start() {
    this.reset();
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
    // Never zoom out past the arena itself, or the view shows empty void
    // beyond the world edges on tall phone screens.
    const fit = Math.max(cssW / WORLD_W, cssH / (WORLD_H * TILT));
    this.scale = clamp(Math.min(cssW / 1100, cssH / 760), Math.max(0.5, fit), 1.15);
    this.view.w = cssW / this.scale;
    this.view.h = cssH / this.scale;
  }

  // ---------------------------------------------------------------- spawning

  spawnEnemy(type, x, y) {
    if (this.enemies.length >= MAX_ENEMIES) return null;
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
    const p = this.edgePoint();
    this.spawnEnemy(type, p.x, p.y);
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

    this.input.update();
    this.focus.x = this.player.x;
    this.focus.y = this.player.y;
    this.director.update(dt, this);
    this.timeLeft -= dt;

    this.updatePlayer(dt);
    this.rebuildGrid();
    this.updateEnemies(dt);
    this.updateNodes(dt);
    this.updateBullets(dt);
    this.updateCoins(dt);
    this.updateParticles(dt);
    this.updateCamera(dt);

    if (this.banner) {
      this.banner.life -= dt;
      if (this.banner.life <= 0) this.banner = null;
    }
    this.shake = Math.max(0, this.shake - dt * 22);

    if (this.player.hp <= 0) this.state = 'lost';
    else if (this.timeLeft <= 0) { this.timeLeft = 0; this.state = 'won'; }
  }

  updatePlayer(dt) {
    const p = this.player;
    if (this.input.takeDash() && p.dash()) {
      this.burst(p.x, p.y, 10, '#8fd8ff', 180);
      this.audio.dash();
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
      e.x += e.vx * dt;
      e.y += e.vy * dt;

      // Stride speed follows actual movement so the crowd never moonwalks.
      e.anim += Math.hypot(e.vx, e.vy) * dt * 0.09;
      if (Math.abs(e.vx) > 6) e.flip = e.vx < 0;

      if (this.attract) continue;

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

  damageEnemy(e, amount) {
    if (!e.alive) return;
    e.hp -= amount;
    e.flash = 1;
    if (e.hp > 0) return;

    e.alive = false;
    this.kills++;
    this.audio.kill();
    const d = e.def;
    this.burst(e.x, e.y, e.type === 'brute' ? 24 : 5, d.dark, e.type === 'brute' ? 260 : 120);
    for (let i = 0; i < d.coins; i++) {
      this.spawnCoin(e.x + rand(-8, 8), e.y + rand(-8, 8), d.value);
    }
    if (e.type === 'brute') {
      this.spawnCoin(e.x, e.y, 18, 'health');
      this.shake = Math.min(16, this.shake + 6);
      this.audio.bruteKill();
    }
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

  updateNodes(dt) {
    const p = this.player;
    this.activeNode = null;

    for (const node of this.nodes) {
      node.pulse = Math.max(0, node.pulse - dt * 1.6);
      node.recentFeed = Math.max(0, node.recentFeed - dt);

      // Pour carried gold in while the player stands on the pad.
      if (dist2(p.x, p.y, node.x, node.y) < node.padRadius * node.padRadius) {
        this.activeNode = node;
        if (p.gold >= 1 && !node.maxed) {
          const want = Math.min(p.gold, DEPOSIT_RATE * dt);
          const spent = node.feed(want);
          p.gold -= spent;
          if (spent > 0) this.audio.deposit();
          if (node.pulse === 1) {
            this.announce('NODE LV' + node.level, '#8fd8ff');
            this.burst(node.x, node.y, 18, '#8fd8ff', 220);
            this.audio.upgrade();
          }
        }
      }

      if (node.level === 0) continue;
      const st = node.stats;
      node.fireTimer -= dt;
      const target = this.acquire(node, node.x, node.y, st.range);
      if (!target) continue;

      const aim = Math.atan2(target.y - node.y, target.x - node.x);
      node.angle = aimTowards(node.angle, aim, dt * 7);
      if (node.fireTimer > 0) continue;

      node.fireTimer = st.interval;
      this.audio.turretShoot();
      for (let i = 0; i < st.barrels; i++) {
        const off = (i - (st.barrels - 1) / 2) * 0.16;
        const a = node.angle + off;
        this.spawnBullet(
          node.x + Math.cos(a) * 22, node.y + Math.sin(a) * 22,
          Math.cos(a), Math.sin(a), 580, st.damage,
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
          this.damageEnemy(e, b.damage);
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
      list[i] = list[list.length - 1];
      list.pop();
      this.enemyPool.push(e);
    }
  }

  updateCoins(dt) {
    const p = this.player;
    const list = this.coins;
    const magnet = 110, magnet2 = magnet * magnet;

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
          p.gold += c.value;
          this.goldBanked += c.value;
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

/* Pre-rendered dirt tile so the ground costs one fill per frame. */
function makeGroundPattern(ctx) {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2f26';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 140; i++) {
    g.fillStyle = `rgba(${randInt(40, 70)},${randInt(44, 74)},${randInt(34, 56)},0.9)`;
    g.fillRect(rand(0, size), rand(0, size), rand(2, 7), rand(2, 7));
  }
  g.strokeStyle = 'rgba(0,0,0,0.22)';
  g.lineWidth = 2;
  g.strokeRect(0.5, 0.5, size - 1, size - 1);
  return ctx.createPattern(c, 'repeat');
}
