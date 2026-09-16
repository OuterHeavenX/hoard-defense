/* Rendered art, loaded up front. Everything here is optional: if an image
   fails to arrive, the renderer falls back to the procedural drawing it used
   before these existed, so a missing asset never blanks a node or a floor. */
'use strict';

const Assets = {
  towers: [],            // per level: HTMLImageElement or null
  towerPacks: {},        // family -> { meta, levels: [null, img x5] }
  ground: {},            // key -> HTMLImageElement
  golem: null,           // { walk: [img], slam: [img] } once loaded
  chars: {},             // type -> { meta, frames: [[base, flip, flash, flipflash]] }
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
    // Per-arena tower families. Level 0, the bare foundation, is shared, so a
    // family only carries the five built tiers. A family is published only
    // once all five are in, the same rule the characters follow.
    const packs = typeof TOWER_PACK_MANIFEST !== 'undefined' ? TOWER_PACK_MANIFEST : null;
    const packSets = {};
    if (packs) {
      this.packMeta = packs;
      for (const family in packs.families) {
        const entries = packs.families[family].levels;
        const set = { entries, levels: [null] };
        entries.forEach((entry, i) => {
          if (!entry) return;
          pending.push(this.image('assets/' + entry.file).then((img) => { if (img) set.levels[i] = img; }));
        });
        packSets[family] = set;
      }
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

    // Character sets are assembled privately and published to this.chars only
    // once every frame is in, so the attract mode never sees a half-loaded set.
    const chars = typeof CHAR_MANIFEST !== 'undefined' ? CHAR_MANIFEST : null;
    const charSets = {};
    if (chars) {
      for (const type in chars.characters) {
        const meta = chars.characters[type];
        const set = { meta, unitPx: chars.unitPx, ss: chars.ss, frames: [] };
        meta.frames.forEach((file, i) => pending.push(this.image('assets/' + file).then((img) => {
          if (img) set.frames[i] = this.variants(img);
        })));
        charSets[type] = set;
      }
    }

    Promise.all(pending).then(() => {
      // A character with any missing frame falls back to the placeholder
      // rather than blinking between the two.
      for (const family in packSets) {
        const set = packSets[family];
        if (set.entries.every((entry, i) => !entry || set.levels[i])) this.towerPacks[family] = set;
      }
      for (const type in charSets) {
        const set = charSets[type];
        if (set.frames.length === set.meta.frames.length && set.frames.every((f) => !!f)) this.chars[type] = set;
      }
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

  /* A node draws from its arena's family when one is loaded, and from the
     shared set otherwise. Level 0 is the bare foundation in every arena, so
     it always comes from the shared set. */
  tower(level, family) {
    const set = family && this.towerPacks[family];
    if (set && set.levels[level]) return set.levels[level];
    return this.towers[level] || null;
  },

  towerMeta(level, family) {
    const set = family && this.towerPacks[family];
    if (set && set.levels[level]) return set.entries[level];
    return this.manifest ? this.manifest.levels[level] : null;
  },

  /* The sprite scale differs between the two sets, so the caller has to know
     which one answered. */
  towerScale(level, family) {
    const set = family && this.towerPacks[family];
    if (set && set.levels[level]) return this.packMeta.ss;
    return this.manifest ? this.manifest.ss : 2;
  },

  towerUnitPx(level, family) {
    const set = family && this.towerPacks[family];
    if (set && set.levels[level]) return this.packMeta.unitPx;
    return this.manifest ? this.manifest.unitPx : 10;
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

/* The four drawn forms of one frame, built once: base, mirrored, hit-flash,
   and mirrored hit-flash. A thousand bodies a frame cannot afford a
   save/scale/restore each to face left, so the mirror is pre-baked. */
Assets.variants = function (img) {
  const make = (flip, flash) => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    if (flip) { g.translate(img.width, 0); g.scale(-1, 1); }
    g.drawImage(img, 0, 0);
    if (flash) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  };
  return [img, make(true, false), make(false, true), make(true, true)];
};
