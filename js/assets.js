/* Rendered art, loaded up front. Everything here is optional: if an image
   fails to arrive, the renderer falls back to the procedural drawing it used
   before these existed, so a missing asset never blanks a node or a floor. */
'use strict';

const Assets = {
  towers: [],            // per level: HTMLImageElement or null
  ground: {},            // key -> HTMLImageElement
  ready: false,

  load(onDone) {
    const pending = [];
    const manifest = typeof TOWER_MANIFEST !== 'undefined' ? TOWER_MANIFEST : null;

    if (manifest) {
      this.manifest = manifest;
      manifest.levels.forEach((entry, i) => {
        pending.push(this.image('assets/' + entry.file).then((img) => { this.towers[i] = img; }));
      });
    }
    for (const key of ['stone', 'earth', 'ash']) {
      pending.push(this.image('assets/ground_' + key + '.png').then((img) => { this.ground[key] = img; }));
    }

    Promise.all(pending).then(() => {
      this.ready = true;
      if (onDone) onDone();
    });
  },

  /* Resolves to the image, or to null on failure - never rejects, so one bad
     file cannot hold up the rest. */
  image(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  },

  tower(level) {
    return this.towers[level] || null;
  },

  towerMeta(level) {
    return this.manifest ? this.manifest.levels[level] : null;
  }
};
