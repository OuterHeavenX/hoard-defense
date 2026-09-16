/* Keyboard + touch input. Aim is automatic, so touch only needs one stick. */
'use strict';

class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.moveX = 0;
    this.moveY = 0;
    this.dashQueued = false;
    this.pausePressed = false;
    this.stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
    this.canvas = canvas;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.keys.add(k);
      if (k === ' ' || k === 'shift') this.dashQueued = true;
      if (k === 'p' || k === 'escape') this.pausePressed = true;
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    const onStart = (e) => {
      for (const t of e.changedTouches) {
        if (this.stick.active) continue;
        this.stick.active = true;
        this.stick.id = t.identifier;
        this.stick.ox = this.stick.x = t.clientX;
        this.stick.oy = this.stick.y = t.clientY;
      }
      e.preventDefault();
    };
    const onMove = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.stick.id) continue;
        this.stick.x = t.clientX;
        this.stick.y = t.clientY;
      }
      e.preventDefault();
    };
    const onEnd = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.stick.id) continue;
        this.stick.active = false;
        this.stick.id = -1;
      }
      e.preventDefault();
    };
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', onMove, { passive: false });
    canvas.addEventListener('touchend', onEnd, { passive: false });
    canvas.addEventListener('touchcancel', onEnd, { passive: false });
  }

  has(...names) {
    for (const n of names) if (this.keys.has(n)) return true;
    return false;
  }

  /* Resolve held keys / touch drag into a unit-ish movement vector. */
  update() {
    let x = 0, y = 0;
    if (this.has('a', 'arrowleft')) x -= 1;
    if (this.has('d', 'arrowright')) x += 1;
    if (this.has('w', 'arrowup')) y -= 1;
    if (this.has('s', 'arrowdown')) y += 1;

    if (this.stick.active) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const len = Math.hypot(dx, dy);
      const dead = 12, max = 70;
      if (len > dead) {
        const scale = Math.min(1, (len - dead) / (max - dead)) / len;
        x += dx * scale;
        y += dy * scale;
      }
    }

    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.moveX = x;
    this.moveY = y;
  }

  takeDash() {
    const d = this.dashQueued;
    this.dashQueued = false;
    return d;
  }

  takePause() {
    const p = this.pausePressed;
    this.pausePressed = false;
    return p;
  }
}
