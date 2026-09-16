/* Rendering layer. Kept apart from the simulation in game.js.
   The crowd is drawn with one batched path per enemy type, which is what keeps
   ~1000 bodies on screen affordable in canvas 2D. */
'use strict';

const VIEW_MARGIN = 48;

Game.prototype.draw = function () {
  const ctx = this.ctx;
  const { w, h } = this.view;          // world units currently visible
  const screen = this.screen;          // css pixels
  const dpr = this.dpr;
  const zoom = this.dpr * this.scale;

  ctx.setTransform(zoom, 0, 0, zoom, 0, 0);
  ctx.fillStyle = '#15170f';
  ctx.fillRect(0, 0, w, h);

  const shakeX = this.shake ? rand(-this.shake, this.shake) : 0;
  const shakeY = this.shake ? rand(-this.shake, this.shake) : 0;
  const camX = this.camera.x - w / 2 + shakeX;
  const camY = this.camera.y - h / 2 + shakeY;

  ctx.save();
  ctx.translate(-camX, -camY);

  this.drawGround(ctx, camX, camY, w, h);
  this.drawNodePads(ctx);
  this.drawCoins(ctx, camX, camY, w, h);
  this.drawEnemies(ctx, camX, camY, w, h);
  this.drawParticles(ctx);
  this.drawBullets(ctx);
  this.drawTurrets(ctx);
  this.drawPlayer(ctx);

  ctx.restore();

  // Screen-space overlays are drawn in css pixels, independent of world zoom.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  this.drawVignette(ctx, screen.w, screen.h);
  this.drawBanner(ctx, screen.w, screen.h);
  this.drawMinimap(ctx, screen.w, screen.h);
  this.drawNodeMarkers(ctx, screen.w, screen.h);
  this.drawTouchStick(ctx);
};

Game.prototype.drawGround = function (ctx, camX, camY, w, h) {
  ctx.fillStyle = this.ground;
  ctx.fillRect(camX, camY, w, h);

  // Arena floor plate, so the playfield edge reads clearly against the void.
  ctx.fillStyle = 'rgba(120,130,96,0.06)';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.strokeStyle = 'rgba(210,225,180,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
};

Game.prototype.drawNodePads = function (ctx) {
  for (const node of this.nodes) {
    const active = this.activeNode === node;

    ctx.fillStyle = node.level > 0 ? 'rgba(80,170,210,0.13)' : 'rgba(255,214,122,0.10)';
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.padRadius, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = active ? '#ffe9a8' : node.level > 0 ? 'rgba(143,216,255,0.6)' : 'rgba(255,214,122,0.45)';
    ctx.lineWidth = active ? 3 : 2;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.padRadius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Upgrade progress ring.
    if (!node.maxed && node.invested > 0) {
      ctx.strokeStyle = '#ffd67a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.padRadius - 7, -Math.PI / 2,
        -Math.PI / 2 + TAU * (node.invested / node.nextCost));
      ctx.stroke();
    }

    if (node.pulse > 0) {
      ctx.strokeStyle = `rgba(143,216,255,${node.pulse})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.padRadius + (1 - node.pulse) * 90, 0, TAU);
      ctx.stroke();
    }

    if (active) {
      ctx.fillStyle = '#ffe9a8';
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const label = node.maxed ? 'MAX LEVEL'
        : this.player.gold >= 1 ? 'DEPOSITING  ' + Math.ceil(node.nextCost - node.invested) + 'g LEFT'
        : 'NEEDS ' + Math.ceil(node.nextCost - node.invested) + 'g';
      ctx.fillText(label, node.x, node.y - node.padRadius - 14);
    }
  }
};

Game.prototype.drawCoins = function (ctx, camX, camY, w, h) {
  const list = this.coins;
  ctx.beginPath();
  let health = null;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.x < camX - VIEW_MARGIN || c.x > camX + w + VIEW_MARGIN ||
        c.y < camY - VIEW_MARGIN || c.y > camY + h + VIEW_MARGIN) continue;
    if (c.kind === 'health') { (health || (health = [])).push(c); continue; }
    const squash = 1 + Math.sin(c.spin) * 0.35;
    ctx.moveTo(c.x + 5, c.y);
    ctx.ellipse(c.x, c.y, 5, 5 * Math.abs(squash) * 0.6 + 2, 0, 0, TAU);
  }
  ctx.fillStyle = '#ffd34d';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,10,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();

  if (health) {
    ctx.fillStyle = '#7bf0a6';
    for (const c of health) {
      ctx.fillRect(c.x - 8, c.y - 3, 16, 6);
      ctx.fillRect(c.x - 3, c.y - 8, 6, 16);
    }
  }
};

/* Each enemy type is baked once into a small offscreen sprite and blitted.
   Batching them as one giant path instead makes a software rasterizer
   scan-convert a screen-sized bounding box per pass, which measured ~20ms a
   frame; blitting is a fixed, tiny cost per body. */
const SPRITE_SS = 2;   // supersample so the sprites stay crisp on hidpi
const enemySprites = {};

function enemySprite(type, flash) {
  const key = flash ? type + ':flash' : type;
  const cached = enemySprites[key];
  if (cached) return cached;

  const def = ENEMY_TYPES[type];
  const r = def.radius;
  const pad = 3;
  const w = (r + pad) * 2, h = (r + pad) * 2 + 4;
  const c = document.createElement('canvas');
  c.width = w * SPRITE_SS;
  c.height = h * SPRITE_SS;
  const g = c.getContext('2d');
  g.scale(SPRITE_SS, SPRITE_SS);

  const cx = w / 2, cy = r + pad;
  g.fillStyle = 'rgba(0,0,0,0.3)';
  g.beginPath();
  g.ellipse(cx, cy + r * 0.55, r, r * 0.45, 0, 0, TAU);
  g.fill();

  g.fillStyle = flash ? '#fff4f4' : def.color;
  g.beginPath();
  g.arc(cx, cy, r, 0, TAU);
  g.fill();

  g.fillStyle = flash ? '#ffd9d9' : def.dark;
  g.beginPath();
  g.arc(cx, cy - r * 0.35, r * 0.45, 0, TAU);
  g.fill();

  const sprite = { canvas: c, w, h, ox: cx, oy: cy };
  enemySprites[key] = sprite;
  return sprite;
}

Game.prototype.drawEnemies = function (ctx, camX, camY, w, h) {
  const list = this.enemies;
  const brutes = this._brutes || (this._brutes = []);
  brutes.length = 0;

  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.x < camX - VIEW_MARGIN || e.x > camX + w + VIEW_MARGIN ||
        e.y < camY - VIEW_MARGIN || e.y > camY + h + VIEW_MARGIN) continue;
    if (e.type === 'brute') { brutes.push(e); continue; }
    const s = enemySprite(e.type, e.flash > 0.35);
    const k = e.scale;
    ctx.drawImage(s.canvas, e.x - s.ox * k, e.y - s.oy * k, s.w * k, s.h * k);
  }

  // Brutes are few and large, so they get individual treatment.
  for (const e of brutes) this.drawBrute(ctx, e);
};

Game.prototype.drawBrute = function (ctx, e) {
  const def = e.def;
  ctx.fillStyle = def.color;
  ctx.beginPath();
  ctx.arc(e.x, e.y, e.radius, 0, TAU);
  ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (let i = 0; i < 5; i++) {
    const a = e.wobble + i * 1.25;
    ctx.beginPath();
    ctx.arc(e.x + Math.cos(a) * e.radius * 0.5, e.y + Math.sin(a) * e.radius * 0.5, 3.5, 0, TAU);
    ctx.fill();
  }

  ctx.fillStyle = def.dark;
  ctx.beginPath();
  ctx.arc(e.x, e.y - e.radius * 0.55, e.radius * 0.45, 0, TAU);
  ctx.fill();

  const pct = clamp(e.hp / e.maxHp, 0, 1);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(e.x - e.radius, e.y - e.radius - 12, e.radius * 2, 5);
  ctx.fillStyle = '#ff6b6b';
  ctx.fillRect(e.x - e.radius, e.y - e.radius - 12, e.radius * 2 * pct, 5);
};

Game.prototype.drawParticles = function (ctx) {
  for (const p of this.particles) {
    ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
};

Game.prototype.drawBullets = function (ctx) {
  const list = this.bullets;
  ctx.lineCap = 'round';
  ctx.lineWidth = 3;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    ctx.strokeStyle = b.color;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.018, b.y - b.vy * 0.018);
    ctx.stroke();
  }
};

Game.prototype.drawPlayer = function (ctx) {
  const p = this.player;

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(p.x, p.y + 8, 14, 6, 0, 0, TAU);
  ctx.fill();

  if (p.dashTimer > 0) {
    ctx.strokeStyle = 'rgba(143,216,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius + 8, 0, TAU);
    ctx.stroke();
  }

  ctx.strokeStyle = '#8fd8ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius + 4, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = p.invuln > 0 && Math.floor(p.invuln * 20) % 2 ? '#ffffff' : '#3d7fd0';
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, TAU);
  ctx.fill();

  ctx.fillStyle = '#d8e8ff';
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius * 0.5, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = '#1b2436';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.cos(p.facing) * 22, p.y + Math.sin(p.facing) * 22);
  ctx.stroke();
};

Game.prototype.drawTurrets = function (ctx) {
  for (const node of this.nodes) {
    ctx.fillStyle = node.level > 0 ? '#5a6472' : '#4a4a42';
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, TAU);
    ctx.fill();

    ctx.fillStyle = node.level > 0 ? '#8fd8ff' : '#77715c';
    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius * 0.55, 0, TAU);
    ctx.fill();

    if (node.level > 0) {
      const st = node.stats;
      ctx.strokeStyle = '#3d4550';
      ctx.lineWidth = 7;
      for (let i = 0; i < st.barrels; i++) {
        const a = node.angle + (i - (st.barrels - 1) / 2) * 0.16;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(node.x + Math.cos(a) * (node.radius + 8), node.y + Math.sin(a) * (node.radius + 8));
        ctx.stroke();
      }
    }

    // Level pips around the base.
    for (let i = 0; i < DefenseNode.MAX_LEVEL; i++) {
      const a = -Math.PI / 2 + (i - (DefenseNode.MAX_LEVEL - 1) / 2) * 0.42;
      const px = node.x + Math.cos(a) * (node.radius + 14);
      const py = node.y + Math.sin(a) * (node.radius + 14);
      ctx.fillStyle = i < node.level ? '#ffd34d' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, TAU);
      ctx.fill();
    }
  }
};

Game.prototype.drawVignette = function (ctx, w, h) {
  const flash = this.player.hurtFlash;
  if (flash > 0) {
    ctx.fillStyle = `rgba(190,40,40,${flash * 0.5})`;
    ctx.fillRect(0, 0, w, h);
  }
  const hpPct = clamp(this.player.hp / this.player.maxHp, 0, 1);
  if (hpPct < 0.35) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.65);
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(1, `rgba(120,0,0,${(0.35 - hpPct) * 1.6})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
};

Game.prototype.drawBanner = function (ctx, w, h) {
  if (!this.banner) return;
  const t = this.banner.life;
  ctx.globalAlpha = clamp(t > 1.8 ? (2.2 - t) / 0.4 : Math.min(1, t / 0.6), 0, 1);
  ctx.fillStyle = this.banner.color;
  ctx.font = 'bold 42px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 6;
  ctx.strokeText(this.banner.text, w / 2, h * 0.22);
  ctx.fillText(this.banner.text, w / 2, h * 0.22);
  ctx.globalAlpha = 1;
};

Game.prototype.drawMinimap = function (ctx, w, h) {
  const size = 150;
  const pad = 16;
  const x = w - size - pad;
  const y = h - size * (WORLD_H / WORLD_W) - pad;
  const mh = size * (WORLD_H / WORLD_W);
  const sx = size / WORLD_W, sy = mh / WORLD_H;

  ctx.fillStyle = 'rgba(10,12,8,0.65)';
  ctx.fillRect(x, y, size, mh);
  ctx.strokeStyle = 'rgba(210,225,180,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, mh - 1);

  ctx.fillStyle = '#c8496a';
  const list = this.enemies;
  for (let i = 0; i < list.length; i += 2) {
    const e = list[i];
    ctx.fillRect(x + e.x * sx, y + e.y * sy, 1.6, 1.6);
  }

  for (const node of this.nodes) {
    ctx.fillStyle = node.level > 0 ? '#8fd8ff' : '#ffd34d';
    ctx.fillRect(x + node.x * sx - 2, y + node.y * sy - 2, 4, 4);
  }

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x + this.player.x * sx - 2.5, y + this.player.y * sy - 2.5, 5, 5);
};

/* Edge chevrons pointing at nodes that are off screen, so a player carrying
   gold always knows which way to run to spend it. */
Game.prototype.drawNodeMarkers = function (ctx, w, h) {
  const pad = 34;
  for (const node of this.nodes) {
    if (node.maxed) continue;
    const sx = (node.x - this.camera.x) * this.scale + w / 2;
    const sy = (node.y - this.camera.y) * this.scale + h / 2;
    if (sx > pad && sx < w - pad && sy > pad && sy < h - pad) continue;

    const a = Math.atan2(sy - h / 2, sx - w / 2);
    const rx = (w / 2 - pad) / Math.abs(Math.cos(a));
    const ry = (h / 2 - pad) / Math.abs(Math.sin(a));
    const r = Math.min(rx, ry);
    const x = w / 2 + Math.cos(a) * r;
    const y = h / 2 + Math.sin(a) * r;

    const hot = this.player.gold >= node.nextCost - node.invested;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.globalAlpha = hot ? 1 : 0.5;
    ctx.fillStyle = node.level > 0 ? '#8fd8ff' : '#ffd34d';
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-8, -8);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  }
};

Game.prototype.drawTouchStick = function (ctx) {
  const s = this.input.stick;
  if (!s.active) return;
  const dx = s.x - s.ox, dy = s.y - s.oy;
  const len = Math.hypot(dx, dy);
  const max = 70;
  const k = len > max ? max / len : 1;

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(s.ox, s.oy, max, 0, TAU);
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(s.ox + dx * k, s.oy + dy * k, 26, 0, TAU);
  ctx.fill();
};
