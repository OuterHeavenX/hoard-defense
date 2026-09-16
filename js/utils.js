/* Small math / helper grab-bag shared by every system. */
'use strict';

const TAU = Math.PI * 2;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return (a + Math.random() * (b - a + 1)) | 0; }
function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function dist2(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}

/* Approach `target` at a fixed rate, framerate independent. */
function damp(current, target, rate, dt) {
  return lerp(target, current, Math.exp(-rate * dt));
}

function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0');
}
