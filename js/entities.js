/* Every moving thing in the arena. Bullets, coins and particles are pooled by
   the Game and recycled through their reset() methods. */
'use strict';

const ENEMY_TYPES = {
  grunt: { hp: 4,   speed: 46,  radius: 8,  damage: 7,  coins: 1, value: 3,  color: '#7e9a5a', dark: '#4c6135' },
  runner:{ hp: 3,   speed: 104, radius: 7,  damage: 5,  coins: 1, value: 4,  color: '#d2703f', dark: '#8a4220' },
  tank:  { hp: 26,  speed: 34,  radius: 13, damage: 12, coins: 3, value: 5,  color: '#6f7fae', dark: '#3d4a72' },
  brute: { hp: 150, speed: 28,  radius: 26, damage: 22, coins: 9, value: 12, color: '#c8496a', dark: '#7d2340' }
};

const BOSS_TYPES = {
  matriarch: {
    name: 'THE MATRIARCH',
    hp: 5200, speed: 34, radius: 66, damage: 30,
    color: '#c8496a', dark: '#6d1c37', skin: '#e79ab0',
    attack: 'slam', attackInterval: 4.2, coins: 40, value: 14
  },
  warden: {
    name: 'THE WARDEN',
    hp: 6400, speed: 40, radius: 62, damage: 34,
    color: '#5f6f8f', dark: '#26304a', skin: '#b8c4de',
    attack: 'slam', attackInterval: 3.6, coins: 48, value: 16
  },
  foreman: {
    name: 'THE FOREMAN',
    hp: 4400, speed: 52, radius: 56, damage: 26,
    color: '#d98032', dark: '#7a3d10', skin: '#f0b97a',
    attack: 'charge', attackInterval: 3.4, coins: 36, value: 14
  }
};

/* The stage climax. Shares enough shape with Enemy that bullets, the spatial
   grid and the depth sort treat it like any other body. */
class Boss {
  constructor(type, x, y, hpScale) {
    const d = BOSS_TYPES[type];
    this.kind = 'enemy';
    this.type = 'boss';
    this.bossType = type;
    this.def = d;
    this.name = d.name;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = d.radius;
    this.maxHp = Math.round(d.hp * hpScale);
    this.hp = this.maxHp;
    this.speed = d.speed;
    this.damage = d.damage;
    this.touchTimer = 0;
    this.flash = 0;
    this.wobble = 0;
    this.scale = 1;
    this.anim = 0;
    this.flip = false;
    this.alive = true;
    this.attackTimer = d.attackInterval;
    this.charging = 0;
    this.telegraph = 0;
  }
}

/* The Juggernaut: a walking gun emplacement that follows the player.
   Expensive to unlock and never truly lost - when his health runs out he
   goes down for a spell and gets back up, because a purchase that size
   should not evaporate to one bad pocket. */
class Ally {
  constructor(x, y) {
    this.kind = 'ally';
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = 24;
    this.maxHp = 700;
    this.hp = this.maxHp;
    this.speed = 222;
    this.range = 460;
    this.fireInterval = 0.045;
    this.fireTimer = 0;
    this.damage = 5;
    this.spin = 0;              // gatling spin-up, 0..spinUp
    this.spinUp = 0.55;
    this.target = null;
    this.facing = -Math.PI / 2;
    this.anim = 0;
    this.flip = false;
    this.caged = false;         // on The Ascent, until the player reaches him
    this.downTimer = 0;         // >0 while knocked out
    this.downFor = 16;
    this.hurtTimer = 0;
    this.firing = false;
  }

  get down() { return this.downTimer > 0; }
  get active() { return !this.caged && !this.down; }
}

class Player {
  constructor(x, y) {
    this.kind = 'player';
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = 13;
    this.speed = 205;
    this.maxHp = 110;
    this.hp = this.maxHp;
    this.gold = 0;
    this.facing = -Math.PI / 2;
    this.anim = 0;
    this.flip = false;
    this.fireInterval = 0.12;
    this.fireTimer = 0;
    this.damage = 6;
    this.range = 340;
    this.pierce = 3;
    this.shots = 1;
    this.magnetRadius = 110;
    this.target = null;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.dashCooldownMax = 2.4;
    this.invuln = 0;
    this.hurtFlash = 0;
  }

  get dashReady() { return this.dashCooldown <= 0 && this.dashTimer <= 0; }

  dash() {
    if (!this.dashReady) return false;
    const len = Math.hypot(this.vx, this.vy);
    const dx = len > 1 ? this.vx / len : Math.cos(this.facing);
    const dy = len > 1 ? this.vy / len : Math.sin(this.facing);
    this.vx = dx * 900;
    this.vy = dy * 900;
    this.dashTimer = 0.18;
    this.dashCooldown = 2.4;
    this.invuln = Math.max(this.invuln, 0.35);
    return true;
  }

  hurt(amount) {
    if (this.invuln > 0) return false;
    this.hp -= amount;
    this.invuln = 0.45;
    this.hurtFlash = 0.35;
    return true;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }
}

class Enemy {
  constructor() { this.alive = false; }

  reset(type, x, y, hpScale) {
    const t = ENEMY_TYPES[type];
    this.kind = 'enemy';
    this.type = type;
    this.def = t;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.radius = t.radius;
    this.maxHp = Math.ceil(t.hp * hpScale);
    this.hp = this.maxHp;
    this.speed = t.speed * rand(0.88, 1.12);
    this.damage = t.damage;
    this.touchTimer = 0;
    this.flash = 0;
    this.wobble = rand(0, TAU);
    this.scale = rand(0.88, 1.16);
    this.anim = rand(0, WALK_FRAMES);
    this.flip = Math.random() < 0.5;
    this.z = 0;             // >0 while stepping down off a staircase
    this.alive = true;
    return this;
  }
}

class Bullet {
  constructor() { this.alive = false; }

  reset(x, y, dx, dy, speed, damage, opts = {}) {
    this.x = x; this.y = y;
    this.z = opts.z ?? 15;
    this.vx = dx * speed;
    this.vy = dy * speed;
    this.damage = damage;
    this.life = opts.life ?? 1.1;
    this.pierce = opts.pierce ?? 0;
    this.splash = opts.splash ?? 0;
    this.radius = opts.radius ?? 3.5;
    this.color = opts.color ?? '#ffe9a8';
    this.hits = null;
    this.alive = true;
    return this;
  }
}

class Coin {
  constructor() { this.alive = false; }

  reset(x, y, value) {
    this.kind = 'coin';
    this.x = x; this.y = y;
    this.vx = rand(-70, 70);
    this.vy = rand(-70, 70);
    this.z = 6;
    this.vz = rand(40, 110);
    this.value = value;
    this.life = 18;
    this.spin = rand(0, TAU);
    this.alive = true;
    return this;
  }
}

class Particle {
  constructor() { this.alive = false; }

  reset(x, y, vx, vy, life, color, size, z, vz) {
    this.x = x; this.y = y;
    this.z = z || 0;
    this.vz = vz || 0;
    this.vx = vx; this.vy = vy;
    this.life = this.maxLife = life;
    this.color = color;
    this.size = size;
    this.alive = true;
    return this;
  }
}

/* A gold-fed defense pylon. Standing on the pad drains carried gold into the
   node; each filled tier upgrades the turret bolted on top. */
class DefenseNode {
  static COSTS = [35, 80, 150, 260, 420];
  static MAX_LEVEL = DefenseNode.COSTS.length;

  constructor(x, y, opts = {}) {
    this.kind = 'node';
    this.x = x; this.y = y;
    this.costs = opts.costs || DefenseNode.COSTS;
    this.maxLevel = opts.maxLevel || DefenseNode.MAX_LEVEL;
    this.lock = !!opts.lock;    // the Juggernaut's cage: pays out a rescue, not a turret
    this.radius = 26;
    this.padRadius = 82;
    this.level = 0;
    this.invested = 0;
    this.angle = rand(0, TAU);
    this.target = null;
    this.fireTimer = 0;
    this.pulse = 0;
    this.recentFeed = 0;
  }

  get maxed() { return this.level >= this.maxLevel; }
  get nextCost() { return this.maxed ? 0 : this.costs[this.level]; }

  get stats() {
    const l = this.level;
    return {
      damage: 4 + l * 4,
      range: 210 + l * 26,
      interval: Math.max(0.12, 0.62 - l * 0.09),
      splash: l >= 2 ? 26 + (l - 2) * 13 : 0,
      barrels: l >= 5 ? 3 : 1
    };
  }

  /* Returns how much gold was actually consumed. */
  feed(amount) {
    if (this.maxed) return 0;
    const need = this.nextCost - this.invested;
    const spent = Math.min(amount, need);
    this.invested += spent;
    this.recentFeed = 0.25;
    if (this.invested >= this.nextCost) {
      this.invested = 0;
      this.level++;
      this.pulse = 1;
    }
    return spent;
  }
}

/* A buyable wall. Built the same way as a turret - stand on it and pour -
   but it spends itself on shaping where the horde walks instead of on
   shooting it. A line is made of short segments with their own health, so
   the horde chews holes in it rather than flipping it off in one go, and
   the hole is where the next wave funnels. */
class Barricade {
  static COSTS = [80, 190, 360];
  static MAX_LEVEL = Barricade.COSTS.length;
  // Health per segment per tier. A fence buys seconds, a rampart buys a
  // horde; neither buys the whole run.
  static SEG_HP = [0, 190, 460, 1000];

  constructor(x, y, len, vertical, segPx) {
    this.kind = 'barricade';
    this.x = x; this.y = y;            // centre of the run
    this.len = len;
    this.vertical = !!vertical;
    this.level = 0;
    this.invested = 0;
    this.pulse = 0;
    this.recentFeed = 0;
    // Building is done at one spot in the middle of the run, not anywhere
    // along it. A pad the length of the wall meant gold drained into it just
    // from crossing the line, which is not a decision anybody made.
    this.padRadius = 78;
    this.seg = segPx;
    this.count = Math.max(2, Math.round(len / segPx));
    this.span = this.count * this.seg;
    this.hp = new Float32Array(this.count);
    this.hit = new Float32Array(this.count);   // flash timer per segment
    // Half the wall's thickness, for the push-out. Kept narrow so a body
    // that is already past the line is not yanked back through it.
    this.half = 13;
  }

  get maxed() { return this.level >= Barricade.MAX_LEVEL; }
  get nextCost() { return this.maxed ? 0 : Barricade.COSTS[this.level]; }
  get segHp() { return Barricade.SEG_HP[this.level]; }
  get start() { return (this.vertical ? this.y : this.x) - this.span / 2; }
  /* Where the player stands to build. */
  get padX() { return this.x; }
  get padY() { return this.y; }

  /* Standing segments, for the HUD and for deciding whether a run still
     counts as a wall at all. */
  get standing() {
    let n = 0;
    for (let i = 0; i < this.count; i++) if (this.hp[i] > 0) n++;
    return n;
  }

  segCentre(i) {
    const at = this.start + (i + 0.5) * this.seg;
    return this.vertical ? { x: this.x, y: at } : { x: at, y: this.y };
  }

  /* Returns how much gold was actually consumed. A run that is standing but
     damaged takes gold as repair before it will take another tier, so the
     player is never forced to overbuild to patch a hole. */
  feed(amount) {
    this.recentFeed = 0.25;
    if (this.level > 0) {
      const full = this.segHp;
      for (let i = 0; i < this.count; i++) {
        if (this.hp[i] >= full) continue;
        // Repair is priced off the tier: a whole segment back for a fifth of
        // what the tier cost to raise.
        const rate = full / (Barricade.COSTS[this.level - 1] * 0.2);
        const need = (full - this.hp[i]) / rate;
        const spent = Math.min(amount, need);
        this.hp[i] += spent * rate;
        if (spent > 0) return spent;
      }
    }
    if (this.maxed) return 0;
    const need = this.nextCost - this.invested;
    const spent = Math.min(amount, need);
    this.invested += spent;
    if (this.invested >= this.nextCost) {
      this.invested = 0;
      this.level++;
      this.pulse = 1;
      this.hp.fill(this.segHp);
    }
    return spent;
  }

  /* Which segment covers this point, or -1. `slack` widens the run's ends so
     a body cannot squeeze around a corner it is standing on. */
  segmentAt(x, y, slack) {
    if (this.level === 0) return -1;
    const along = this.vertical ? y : x;
    const across = this.vertical ? x - this.x : y - this.y;
    if (Math.abs(across) > this.half + slack) return -1;
    const i = Math.floor((along - this.start) / this.seg);
    if (i < 0 || i >= this.count || this.hp[i] <= 0) return -1;
    return i;
  }

  damageSegment(i, amount) {
    if (this.hp[i] <= 0) return false;
    this.hp[i] -= amount;
    this.hit[i] = 1;
    if (this.hp[i] > 0) return false;
    this.hp[i] = 0;
    return true;      // this one just fell
  }
}
