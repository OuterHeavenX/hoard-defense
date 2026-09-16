/* Rendered art, loaded up front. Everything here is optional: if an image
   fails to arrive, the renderer falls back to the procedural drawing it used
   before these existed, so a missing asset never blanks a node or a floor. */
'use strict';

const Assets = {
  towers: [],            // per level: HTMLImageElement or null
  ground: {},            // key -> HTMLImageElement
  golem: null,           // { walk: [img], slam: [img] } once loaded
  tintCache: {},         // bossType:anim:frame -> tinted canvas
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

    const golem = typeof GOLEM_MANIFEST !== 'undefined' ? GOLEM_MANIFEST : null;
    if (golem) {
      const set = { meta: golem, walk: [], slam: [] };
      golem.walk.forEach((file, i) => pending.push(this.image('assets/' + file).then((img) => { set.walk[i] = img; })));
      golem.slam.forEach((file, i) => pending.push(this.image('assets/' + file).then((img) => { set.slam[i] = img; })));
      pending.push(Promise.resolve().then(() => { this.golem = set; }));
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

/* Boss colourways. The golem renders once, grey and mossy; each boss gets a
   translucent wash so the three read apart at a glance. */
const BOSS_TINTS = {
  warden: null,
  foreman: 'rgba(190,110,50,0.38)',
  matriarch: 'rgba(180,70,120,0.38)',
  flash: 'rgba(255,255,255,0.85)'    // the damage wash, not a boss
};

/* A golem frame washed with a boss's colour, built once and cached. Returns
   the raw frame when the tint is null or the frame is missing. */
Assets.golemFrame = function (bossType, anim, index) {
  const set = this.golem;
  if (!set) return null;
  const frames = set[anim];
  const img = frames && frames[index];
  if (!img) return null;
  const tint = BOSS_TINTS[bossType];
  if (!tint) return img;
  const key = bossType + ':' + anim + ':' + index;
  let c = this.tintCache[key];
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  if (bossType === 'flash') {
    // The damage wash really is a flat wash.
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = tint;
    g.fillRect(0, 0, c.width, c.height);
  } else {
    // A colourway, not a coat of paint: 'color' keeps the stone's luminance
    // and takes only the hue, then the original alpha is restored so the
    // fill does not bleed outside the silhouette.
    g.globalCompositeOperation = 'color';
    g.fillStyle = tint;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
  }
  this.tintCache[key] = c;
  return c;
};
