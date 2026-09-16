/* Uniform grid used for enemy separation and bullet hit queries.
   Rebuilt from scratch every frame - cheaper than incremental updates at
   the crowd sizes this game runs (up to ~1000 bodies). */
'use strict';

class SpatialGrid {
  constructor(width, height, cell) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(height / cell);
    this.buckets = new Array(this.cols * this.rows);
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i] = [];
  }

  clear() {
    for (let i = 0; i < this.buckets.length; i++) {
      if (this.buckets[i].length) this.buckets[i].length = 0;
    }
  }

  indexOf(x, y) {
    const cx = clamp(x / this.cell | 0, 0, this.cols - 1);
    const cy = clamp(y / this.cell | 0, 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  insert(item) {
    this.buckets[this.indexOf(item.x, item.y)].push(item);
  }

  /* Calls fn for every item in the 3x3 cell block around (x, y).
     fn may return false to stop the walk early - crowds get dense enough that
     visiting every body in a bucket is the difference between 2ms and 30ms. */
  forEachNear(x, y, fn) {
    const cx = clamp(x / this.cell | 0, 0, this.cols - 1);
    const cy = clamp(y / this.cell | 0, 0, this.rows - 1);
    this.forEachInCells(cx - 1, cy - 1, cx + 1, cy + 1, fn);
  }

  /* Walks every bucket overlapping a world-space rectangle. */
  forEachInRect(x0, y0, x1, y1, fn) {
    const c = this.cell;
    this.forEachInCells(x0 / c | 0, y0 / c | 0, x1 / c | 0, y1 / c | 0, fn);
  }

  forEachInCells(cx0, cy0, cx1, cy1, fn) {
    const x0 = Math.max(0, cx0), x1 = Math.min(this.cols - 1, cx1);
    const y0 = Math.max(0, cy0), y1 = Math.min(this.rows - 1, cy1);
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * this.cols;
      for (let gx = x0; gx <= x1; gx++) {
        const bucket = this.buckets[row + gx];
        for (let i = 0; i < bucket.length; i++) {
          if (fn(bucket[i]) === false) return;
        }
      }
    }
  }
}
