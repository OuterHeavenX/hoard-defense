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

  constructor(x, y) {
    this.kind = 'node';
    this.x = x; this.y = y;
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

  get maxed() { return this.level >= DefenseNode.MAX_LEVEL; }
  get nextCost() { return this.maxed ? 0 : DefenseNode.COSTS[this.level]; }

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
